import { repeatDetector } from './repetition'

/**
 * Per-step guard over one model response. Native APIs stop after a tool call
 * and always bound output; OpenAI-compatible translation layers (Ollama /v1,
 * gateways) do not guarantee either, so a degenerate model can emit hundreds
 * of calls, keep writing "results" it never received, or loop on one span.
 */
export const MAX_TOOL_CALLS_PER_RESPONSE = 32

export type GuardVerdict =
  | { kind: 'ok' }
  | { kind: 'tool-flood' }
  | { kind: 'interleaved' }
  | { kind: 'repetition'; channel: 'text' | 'reasoning'; keepChars: number }

export interface ResponseGuard {
  text(delta: string): GuardVerdict
  reasoning(delta: string): GuardVerdict
  /** Ask before accepting a streamed tool call; 'ok' means accept it. */
  toolCall(): GuardVerdict
  /** Raw length of the text streamed before the first accepted tool call. */
  textBeforeFirstCall(): number
}

const OK: GuardVerdict = { kind: 'ok' }

export function createResponseGuard(opts?: { maxToolCalls?: number }): ResponseGuard {
  const maxToolCalls = opts?.maxToolCalls ?? MAX_TOOL_CALLS_PER_RESPONSE
  const textRepeat = repeatDetector()
  const reasoningRepeat = repeatDetector()
  let calls = 0
  let textLength = 0
  let preCallText = 0
  let textAfterCall = false
  return {
    text(delta: string): GuardVerdict {
      textLength += delta.length
      if (calls === 0) preCallText = textLength
      else if (/\S/.test(delta)) textAfterCall = true
      const hit = textRepeat.push(delta)
      return hit ? { kind: 'repetition', channel: 'text', keepChars: hit.keepChars } : OK
    },
    reasoning(delta: string): GuardVerdict {
      const hit = reasoningRepeat.push(delta)
      return hit ? { kind: 'repetition', channel: 'reasoning', keepChars: hit.keepChars } : OK
    },
    toolCall(): GuardVerdict {
      if (textAfterCall) return { kind: 'interleaved' }
      if (calls >= maxToolCalls) return { kind: 'tool-flood' }
      calls++
      return OK
    },
    textBeforeFirstCall: () => preCallText
  }
}
