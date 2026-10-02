import type { JSONSchema7, LanguageModelV3ToolCall } from '@ai-sdk/provider'

// Open models served over the OpenAI-compatible wire (DeepSeek, MiniMax, …)
// stream `function.arguments` as a raw string and the SDK only parses it when
// the whole text is one valid JSON object. Two malformations recur often enough
// to be worth repairing instead of failing the call:
//
//   1. A field that should be an array arrives as a JSON-encoded *string*, and
//      the model keeps writing into that string after the array closes:
//        {"header":"…","options":"[{…}], \"question\": \"…\"}"}
//      Here `options` is a string and `question` is swallowed inside it, so the
//      schema rejects the call (missing `question`, `options` not an array).
//   2. The model concatenates several argument objects into one call:
//        {"name":"a"}{"name":"b"}{"file_path":"…"}
//      which is not valid JSON at all and used to lose the whole input.
//
// Repairing here — in `experimental_repairToolCall`, which runs before the SDK
// validates the arguments — is the only place that can help: by the time the
// loop sees the call it is already marked invalid and never executed. The
// per-tool normalizers (`normalizeOptions`, the `todos` guard) only run after
// validation and therefore never see these shapes.

const BACKSLASH = '\\'
const QUOTE = '"'

/** Index just past the first complete JSON value starting at `i`, or -1. */
function endOfValue(text: string, i: number): number {
  const c = text[i]
  if (c === QUOTE) {
    let j = i + 1
    while (j < text.length) {
      if (text[j] === BACKSLASH) {
        j += 2
        continue
      }
      if (text[j] === QUOTE) return j + 1
      j++
    }
    return -1
  }
  if (c === '[' || c === '{') {
    const close = c === '[' ? ']' : '}'
    let depth = 0
    let j = i
    while (j < text.length) {
      const ch = text[j]
      if (ch === QUOTE) {
        j = endOfValue(text, j)
        if (j < 0) return -1
        continue
      }
      if (ch === c) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) return j + 1
      }
      j++
    }
    return -1
  }
  let j = i
  while (j < text.length && !/[,}\]\s]/.test(text[j])) j++
  return j > i ? j : -1
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Unwrap string fields that actually hold JSON. A field whose text parses as
 * `{"<field>": <value>}` is replaced by `<value>`; anything left over after the
 * value (the swallowed `"question": "…"` above) is parsed as a trailing object
 * and merged in, so keys the model pushed inside the string come back to the
 * top level.
 */
function unwrapStringFields(input: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...input }
  let changed = false
  for (const key of Object.keys(input)) {
    const value = input[key]
    if (typeof value !== 'string') continue
    const wrapped = `{${QUOTE}${key}${QUOTE}: ${value}`
    const end = endOfValue(wrapped, wrapped.indexOf(':') + 2)
    if (end < 0) continue
    let head: Record<string, unknown>
    try {
      head = JSON.parse(`${wrapped.slice(0, end)}}`) as Record<string, unknown>
    } catch {
      continue
    }
    out[key] = head[key]
    changed = true
    const rest = wrapped.slice(end).replace(/^[\s,]+/, '')
    if (!rest.startsWith(QUOTE)) continue
    // The trailing text is the model's own JSON, but the closing brace may have
    // been dropped or doubled — trim a few characters until it parses.
    for (let cut = 0; cut < 8 && rest.length > cut; cut++) {
      try {
        const extra = JSON.parse(`{${rest.slice(0, rest.length - cut)}}`) as Record<string, unknown>
        for (const k of Object.keys(extra)) if (out[k] === undefined) out[k] = extra[k]
        break
      } catch {
        // keep trimming
      }
    }
  }
  return changed ? out : null
}

/** Merge `{"a":1}{"b":2}` into one object; null when the text is not that shape. */
function mergeConcatenatedObjects(text: string): Record<string, unknown> | null {
  const parts: Record<string, unknown>[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    const end = endOfValue(text, i)
    if (end < 0) return null
    try {
      const part = JSON.parse(text.slice(i, end)) as unknown
      if (!isPlainObject(part)) return null
      parts.push(part)
    } catch {
      return null
    }
    i = end
  }
  return parts.length > 1 ? Object.assign({}, ...parts) : null
}

/**
 * Last resort for a field the schema declares as an array but the model sent as
 * a single value (a bare string, or one object instead of a list of them).
 */
function coerceToSchema(value: Record<string, unknown>, schema: JSONSchema7 | undefined): Record<string, unknown> {
  const properties = schema?.properties
  if (!properties) return value
  const out: Record<string, unknown> = { ...value }
  for (const key of Object.keys(out)) {
    const prop = properties[key]
    const type = isPlainObject(prop) ? prop.type : undefined
    if (type === 'array' && !Array.isArray(out[key])) out[key] = [out[key]]
  }
  return out
}

/**
 * Rewrite the raw arguments of a tool call into valid JSON for its schema.
 * Returns null when nothing could be repaired, which leaves the SDK's own
 * invalid-call path (and the model's retry) untouched.
 */
export function repairToolCallInput(
  rawInput: string,
  schema: JSONSchema7 | undefined
): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    parsed = undefined
  }
  let candidate: Record<string, unknown> | null = isPlainObject(parsed) ? parsed : null
  if (candidate) candidate = unwrapStringFields(candidate) ?? candidate
  else candidate = mergeConcatenatedObjects(rawInput)
  if (!candidate) return null
  const coerced = coerceToSchema(candidate, schema)
  // Only claim a repair when the arguments actually changed: an already-valid
  // call must not be re-serialized (key order, numbers) for no reason.
  return JSON.stringify(coerced) === rawInput ? null : coerced
}

/**
 * `experimental_repairToolCall` for `streamText`. The SDK hands over the raw
 * tool call plus a resolver for the tool's JSON schema; a repaired call is
 * re-validated by the SDK, so returning a wrong shape is safe — it just falls
 * back to the invalid path.
 */
export async function repairToolCall(options: {
  toolCall: LanguageModelV3ToolCall
  inputSchema: (options: { toolName: string }) => PromiseLike<JSONSchema7>
}): Promise<LanguageModelV3ToolCall | null> {
  let schema: JSONSchema7 | undefined
  try {
    schema = await options.inputSchema({ toolName: options.toolCall.toolName })
  } catch {
    schema = undefined
  }
  const repaired = repairToolCallInput(options.toolCall.input, schema)
  if (!repaired) return null
  return { ...options.toolCall, input: JSON.stringify(repaired) }
}
