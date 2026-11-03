import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { OutputBatcher, ScrollbackBuffer } from '../../src/main/terminal-buffer'

describe('ScrollbackBuffer', () => {
  it('appends and snapshots within capacity', () => {
    const buf = new ScrollbackBuffer(100)
    buf.append('hello ')
    buf.append('world')
    expect(buf.snapshot()).toBe('hello world')
  })

  it('drops older data to respect maxBytes while keeping newest bytes', () => {
    const buf = new ScrollbackBuffer(10)
    buf.append('12345')
    buf.append('67890')
    buf.append('abc')
    expect(buf.snapshot()).toBe('4567890abc')
    expect(buf.snapshot().length).toBe(10)
  })

  it('drops whole chunks from the head when they fall completely outside the window', () => {
    const buf = new ScrollbackBuffer(8)
    buf.append('chunk1-') // 7
    buf.append('chunk2-') // 7
    buf.append('chunk3') // 6
    // Total 20 chars, max 8. Should keep last 8: '2-chunk3'
    expect(buf.snapshot()).toBe('2-chunk3')
    expect(buf.snapshot().length).toBe(8)
  })

  it('handles a single chunk larger than maxBytes', () => {
    const buf = new ScrollbackBuffer(5)
    buf.append('0123456789')
    expect(buf.snapshot()).toBe('56789')
  })

  it('preserves UTF-16 surrogate pairs safely when cutting at boundary', () => {
    // '𠮷' is surrogate pair \uD842\uDFB7 (length 2)
    // String: 'abc' + '𠮷' -> length 5
    // If maxBytes is 3, dropCount = 5 - 3 = 2.
    // Index 2 is 'c'. Slice starts at 'c𠮷' (length 3, valid surrogate pair).
    const buf = new ScrollbackBuffer(3)
    buf.append('abc\uD842\uDFB7')
    expect(buf.snapshot()).toBe('c\uD842\uDFB7')

    // If maxBytes is 2, dropCount = 5 - 2 = 3.
    // Index 3 is \uD842 (high surrogate). Not low surrogate.
    // Slice starts at '\uD842\uDFB7' (length 2, valid surrogate pair).
    const buf2 = new ScrollbackBuffer(2)
    buf2.append('abc\uD842\uDFB7')
    expect(buf2.snapshot()).toBe('\uD842\uDFB7')

    // If maxBytes is 1, dropCount = 5 - 1 = 4.
    // Index 4 is \uDFB7 (low surrogate).
    // Should drop one more char to avoid leading orphaned low surrogate!
    // Result dropCount = 5 -> slice is empty.
    const buf3 = new ScrollbackBuffer(1)
    buf3.append('abc\uD842\uDFB7')
    expect(buf3.snapshot()).toBe('')
  })

  it('clears buffer content and resets length', () => {
    const buf = new ScrollbackBuffer(100)
    buf.append('some text')
    expect(buf.snapshot()).toBe('some text')
    buf.clear()
    expect(buf.snapshot()).toBe('')
    buf.append('new text')
    expect(buf.snapshot()).toBe('new text')
  })

  it('ignores empty appends or zero maxBytes', () => {
    const buf0 = new ScrollbackBuffer(0)
    buf0.append('hello')
    expect(buf0.snapshot()).toBe('')

    const buf = new ScrollbackBuffer(10)
    buf.append('')
    expect(buf.snapshot()).toBe('')
  })
})

describe('OutputBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('coalesces multiple pushes within the interval', () => {
    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 1024)

    batcher.push('a')
    batcher.push('b')
    batcher.push('c')

    expect(flush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(15)
    expect(flush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('abc')
  })

  it('arms timer only on first push and allows subsequent pushes to coalesce', () => {
    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 1024)

    batcher.push('first')
    vi.advanceTimersByTime(10)
    batcher.push('-second')
    vi.advanceTimersByTime(6) // 16 ms total from first push

    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('first-second')
  })

  it('flushes synchronously when maxBytes is reached', () => {
    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 10)

    batcher.push('12345')
    expect(flush).not.toHaveBeenCalled()

    batcher.push('67890')
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('1234567890')

    // Timer should have been cleared; advancing timer should not trigger second flush
    vi.advanceTimersByTime(20)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushNow emits pending data immediately and cancels the timer', () => {
    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 1024)

    batcher.push('urgent')
    expect(flush).not.toHaveBeenCalled()

    batcher.flushNow()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('urgent')

    // Advancing time does not flush again
    vi.advanceTimersByTime(20)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('dispose clears timer and drops pending data without flushing', () => {
    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 1024)

    batcher.push('dropped')
    batcher.dispose()

    vi.advanceTimersByTime(20)
    expect(flush).not.toHaveBeenCalled()

    // Subsequent push and flushNow should be no-ops
    batcher.push('ignored')
    batcher.flushNow()
    expect(flush).not.toHaveBeenCalled()
  })

  it('supports custom timers injection', () => {
    let timerCallback: (() => void) | null = null
    let clearedId: any = null
    const customTimers = {
      setTimeout: (fn: () => void, _ms: number) => {
        timerCallback = fn
        return 123
      },
      clearTimeout: (id: any) => {
        clearedId = id
      }
    }

    const flush = vi.fn()
    const batcher = new OutputBatcher(flush, 16, 1024, customTimers)

    batcher.push('custom')
    expect(timerCallback).not.toBeNull()

    timerCallback!()
    expect(flush).toHaveBeenCalledWith('custom')

    batcher.push('custom2')
    batcher.dispose()
    expect(clearedId).toBe(123)
  })
})
