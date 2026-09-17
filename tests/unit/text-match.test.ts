import { describe, expect, it } from 'vitest'
import { findUniqueText } from '../../src/main/agent/tools/text-match'

describe('findUniqueText', () => {
  it('finds an exact match', () => expect(findUniqueText('one\ntwo', 'two')).toEqual({ start: 4, end: 7, newline: 'lf' }))
  it('maps an LF search onto a CRLF file', () => {
    expect(findUniqueText('one\r\ntwo\r\nthree', 'two\n')).toEqual({ start: 5, end: 10, newline: 'crlf' })
  })
  it('rejects ambiguous matches and empty searches', () => {
    expect(findUniqueText('x\r\nx\r\n', 'x')).toEqual({ error: 'ambiguous', count: 2 })
    expect(findUniqueText('x', '')).toEqual({ error: 'empty' })
  })
  it('rejects mixed newline fallback', () => expect(findUniqueText('a\r\nb\nc', 'a\nb')).toEqual({ error: 'mixed-newlines' }))
})
