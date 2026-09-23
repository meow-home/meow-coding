/**
 * Degenerate "thinking loop" guard.
 *
 * Small/cheap reasoning models occasionally fall into an output loop: they
 * re-emit the same phrasing forever without ever calling a tool or producing an
 * answer. Left alone, the stream burns the whole output budget, and the
 * length-resume path then tells the model to "continue from where you stopped"
 * — which re-triggers the exact same loop, three more full budgets later ending
 * in a misleading "hit the output limit" message.
 *
 * This detector flags the repetition as soon as a short verbatim phrase has
 * repeated a few times in the recent tail, so the runner can cut the stream off
 * early and nudge the model back on track instead of paying for the loop.
 */

const DEFAULT_PHRASE_LEN = 12
const DEFAULT_MIN_REPEATS = 4
// Scan only the most recent words: a live loop always lives in the newest
// tokens, and bounding the scan keeps every push cheap as the stream grows.
const DEFAULT_TAIL_WORDS = 360

export interface LoopDetector {
  /**
   * Feed the next streamed chunk (a text or reasoning delta). Returns true once
   * the stream has begun repeating itself.
   */
  next(text: string): boolean
}

export function loopDetector(opts?: {
  phraseLen?: number
  minRepeats?: number
  tailWords?: number
}): LoopDetector {
  const phraseLen = opts?.phraseLen ?? DEFAULT_PHRASE_LEN
  const minRepeats = opts?.minRepeats ?? DEFAULT_MIN_REPEATS
  const tailWords = opts?.tailWords ?? DEFAULT_TAIL_WORDS
  // Raw tail characters (≈7 chars/word upper bound) so the word window stays
  // bounded without splitting words across pushes; the phrase scan then runs
  // over the last `tailWords` words only.
  let rawTail = ''
  return {
    next(text: string): boolean {
      if (!text) return false
      rawTail = (rawTail + text).slice(-(tailWords * 7))
      const words = rawTail.toLowerCase().match(/[a-z0-9]+/g)
      if (!words || words.length < phraseLen * minRepeats) return false
      const tail = words.slice(-tailWords)
      const seen = new Map<string, number>()
      for (let i = 0; i + phraseLen <= tail.length; i++) {
        const phrase = tail.slice(i, i + phraseLen).join(' ')
        const n = (seen.get(phrase) ?? 0) + 1
        seen.set(phrase, n)
        if (n >= minRepeats) return true
      }
      return false
    }
  }
}

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
 * Complements {@link loopDetector}, which only watches the model's own words:
 * a model can also get stuck calling the *same tool with the same input* over
 * and over (re-read one file, re-run one command) with genuinely varied text
 * in between, so the phrase-repetition detector never fires. This tracks a
 * short history of `toolName + input` fingerprints across steps and flags the
 * loop once the same fingerprint repeats too many times.
 */
import { createHash } from 'node:crypto'

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
