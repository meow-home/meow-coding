import { describe, expect, it } from 'vitest'
import { countWords } from '../../src/renderer/src/components/chat/reasoning'

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('collapses runs of whitespace, newlines and tabs', () => {
    expect(countWords('one\n\n  two\tthree ')).toBe(3)
  })

  it('returns 0 for empty and whitespace-only text', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })
})

describe('countWords (streaming)', () => {
  it('is stable when a buffer grows token by token', () => {
    let buffer = ''
    const counts: number[] = []
    for (const chunk of ['The', ' user', ' wants', ' a', ' redesign']) {
      buffer += chunk
      counts.push(countWords(buffer))
    }
    expect(counts).toEqual([1, 2, 3, 4, 5])
  })

  it('does not count a trailing space as a word', () => {
    expect(countWords('done ')).toBe(1)
  })
})
