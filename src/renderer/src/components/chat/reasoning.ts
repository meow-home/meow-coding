/**
 * Word count for the thinking header. Deliberately not a token estimate: the
 * renderer has no tokenizer, and a made-up "≈N tokens" figure would be a lie
 * about a number the user can see in the context readout. Words are honest and
 * cheap — it answers "is this worth opening?" without a model round-trip.
 *
 * Counted with a scan rather than `split(/\s+/)`: this runs on every streamed
 * frame over a growing buffer, so it must not allocate an array per call.
 */
export function countWords(text: string): number {
  let count = 0
  let inWord = false
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 32) {
      inWord = false
    } else if (!inWord) {
      inWord = true
      count++
    }
  }
  return count
}
