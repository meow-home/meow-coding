import { createHash } from 'node:crypto'

/**
 * Tandem-repeat guard for one streamed channel (text or reasoning).
 *
 * A degenerate model re-emits the same span back to back — "counselorcounselor…"
 * or one paragraph over and over. Only such consecutive repeats at the tail are
 * flagged, compared per character so any script works and no word boundaries are
 * needed. Content that merely looks alike (test cases differing in one name) is
 * not a tandem repeat and passes.
 */
const REPEAT_ANCHOR = 32
const REPEAT_CHECK_EVERY = 64
const REPEAT_MAX_PERIOD = 1024
// Paraphrased openers that share an ending make the nearest anchor occurrence a
// sub-period; walking back a few occurrences finds the real period.
const REPEAT_MAX_CANDIDATES = 16
const REPEAT_TAIL = 8192
const REPEAT_SHORT_PERIOD = 16
const REPEAT_SHORT_MIN_SPAN = 256
const REPEAT_LONG_MIN_COPIES = 3
const REPEAT_LONG_MIN_SPAN = 200
const MEANINGFUL = /[\p{L}\p{N}]/u
const WHITESPACE = /\s/u

export interface RepeatHit {
  /** Raw length to keep: everything before the repeat plus one copy of it. */
  keepChars: number
}

export interface RepeatDetector {
  push(delta: string): RepeatHit | null
}

export function repeatDetector(): RepeatDetector {
  let rawLength = 0
  let norm = ''
  // norm index → raw index, so a hit found on normalized text maps back.
  const rawIndex: number[] = []
  let prevSpace = false
  let lastCheck = 0

  const copiesAt = (p: number, end: number, floor: number): number => {
    const unit = norm.slice(end - p, end)
    let copies = 1
    while (end - (copies + 1) * p >= floor && norm.slice(end - (copies + 1) * p, end - copies * p) === unit) copies++
    return copies
  }

  const check = (): RepeatHit | null => {
    const end = norm.length
    const floor = Math.max(0, end - REPEAT_TAIL)
    if (end - floor < REPEAT_ANCHOR * 2) return null
    const anchor = norm.slice(end - REPEAT_ANCHOR)
    let from = end - REPEAT_ANCHOR - 1
    for (let c = 0; c < REPEAT_MAX_CANDIDATES && from >= floor; c++) {
      const idx = norm.lastIndexOf(anchor, from)
      if (idx < floor) break
      const p = end - REPEAT_ANCHOR - idx
      if (p > REPEAT_MAX_PERIOD) break
      if (MEANINGFUL.test(norm.slice(end - p, end))) {
        const copies = copiesAt(p, end, floor)
        const span = copies * p
        const hit = p <= REPEAT_SHORT_PERIOD
          ? span >= REPEAT_SHORT_MIN_SPAN
          : copies >= REPEAT_LONG_MIN_COPIES && span >= REPEAT_LONG_MIN_SPAN
        if (hit) {
          const keepNorm = end - span + p
          return { keepChars: keepNorm < rawIndex.length ? rawIndex[keepNorm] : rawLength }
        }
      }
      from = idx - 1
    }
    return null
  }

  return {
    push(delta: string): RepeatHit | null {
      for (const ch of delta) {
        const at = rawLength
        rawLength += ch.length
        if (WHITESPACE.test(ch)) {
          if (prevSpace) continue
          prevSpace = true
          norm += ' '
          rawIndex.push(at)
          continue
        }
        prevSpace = false
        const low = ch.toLowerCase()
        norm += low
        for (let k = 0; k < low.length; k++) rawIndex.push(at)
      }
      if (norm.length - lastCheck < REPEAT_CHECK_EVERY) return null
      lastCheck = norm.length
      return check()
    }
  }
}

/**
 * Degenerate "tool loop" guard.
 *
 * Complements {@link repeatDetector}, which only watches the model's own words:
 * a model can also get stuck calling the *same tool with the same input* over
 * and over (re-read one file, re-run one command) with genuinely varied text
 * in between, so the phrase-repetition detector never fires. This tracks a
 * short history of `toolName + input` fingerprints across steps and flags the
 * loop once the same fingerprint repeats too many times.
 */

const DEFAULT_TOOL_HISTORY = 8
const DEFAULT_TOOL_MIN_REPEATS = 3

export interface ToolObservation {
  tool: string
  input: unknown
  output?: string
  error?: string
  mutationDigest?: string
}

export type ToolLoopVerdict = { kind: 'ok' } | { kind: 'poll' | 'repeat'; tool: string; count: number }

export interface ToolLoopDetector {
  /** Record one completed call; reports when it repeats with the same result. */
  observe(call: ToolObservation): ToolLoopVerdict
  reset(): void
}

/** A background shell checked while still running with nothing new to show. */
export function isIdlePoll(call: ToolObservation): boolean {
  return call.tool === 'bash_output' && !call.error && typeof call.output === 'string' &&
    call.output.includes('status="running"') && call.output.includes('(no new output)')
}

export function toolLoopDetector(opts?: {
  history?: number
  minRepeats?: number
}): ToolLoopDetector {
  const history = opts?.history ?? DEFAULT_TOOL_HISTORY
  const minRepeats = opts?.minRepeats ?? DEFAULT_TOOL_MIN_REPEATS
  const recent: string[] = []
  const stableJson = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16)
  const fingerprint = (call: ToolObservation): string => {
    let inputJson: string
    try {
      inputJson = stableJson(call.input ?? {})
    } catch {
      inputJson = String(call.input)
    }
    return digest(`${call.tool}:${inputJson}:output=${call.output ?? ''}:error=${call.error ?? ''}:mutation=${call.mutationDigest ?? ''}`)
  }
  return {
    observe(call): ToolLoopVerdict {
      const key = fingerprint(call)
      recent.push(key)
      if (recent.length > history) recent.shift()
      const count = recent.filter(k => k === key).length
      if (count < minRepeats) return { kind: 'ok' }
      return { kind: isIdlePoll(call) ? 'poll' : 'repeat', tool: call.tool, count }
    },
    reset(): void {
      recent.length = 0
    }
  }
}
