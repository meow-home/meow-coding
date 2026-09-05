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
