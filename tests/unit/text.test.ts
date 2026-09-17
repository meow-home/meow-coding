import { describe, expect, it } from 'vitest'
import { appendStreamDelta } from '../../src/shared/text'

describe('appendStreamDelta', () => {
  it('appends disjoint deltas unchanged', () => {
    let buf = appendStreamDelta('', 'Tất')
    buf = appendStreamDelta(buf, ' nhiên')
    buf = appendStreamDelta(buf, '!!')
    expect(buf).toBe('Tất nhiên!!')
  })

  it('preserves incremental chunks that share characters at the boundary', () => {
    let buf = appendStreamDelta('', 'hel')
    buf = appendStreamDelta(buf, 'lo')
    expect(buf).toBe('hello')
  })

  it('preserves repeated letters from incremental chunks', () => {
    let buf = appendStreamDelta('', 'hello')
    buf = appendStreamDelta(buf, 'hello')
    expect(buf).toBe('hellohello')
  })

  it('handles empty buffer and empty delta', () => {
    expect(appendStreamDelta('', 'x')).toBe('x')
    expect(appendStreamDelta('abc', '')).toBe('abc')
  })
})
