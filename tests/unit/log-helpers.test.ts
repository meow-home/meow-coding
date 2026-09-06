import { describe, expect, it } from 'vitest'
import { formatConsoleArgs, formatLogArg, safeJson } from '../../src/shared/log-helpers'

// Regression suite for the console logging path. Before the printf
// interpolation was added, React's dev error logs (which call
// console.error('%s\n\n%s', message, stack)) were flattened into literal
// "%s" placeholders, hiding the actual exception behind "An error occurred
// in the <X> component". This test pins the formatting that must survive the
// system-log channel so the next black-screen error is fully reported.
describe('formatConsoleArgs', () => {
  it('interpolates %s placeholders with the string args', () => {
    const msg = 'boom: Cannot read properties of undefined'
    const stack = 'at foo (a.ts:1:1)'
    expect(formatConsoleArgs(['An error occurred in the <%s> component.\n\n%s', 'ChatPanel', msg, stack]))
      .toBe(`An error occurred in the <ChatPanel> component.\n\nboom: Cannot read properties of undefined at foo (a.ts:1:1)`)
  })

  it('interpolates %d/%i as integers', () => {
    expect(formatConsoleArgs(['attempt %i of %d', 2.9, 4])).toBe('attempt 2 of 4')
  })

  it('treats %% as a literal percent', () => {
    expect(formatConsoleArgs(['progress %d%%', 80])).toBe('progress 80%')
  })

  it('drops %c (CSS) styling args from the text log', () => {
    expect(formatConsoleArgs(['color: %c%s', 'font-weight: bold', 'red'])).toBe('color: red')
  })

  it('renders Error args via their stack', () => {
    const err = new Error('kaboom')
    const out = formatConsoleArgs(['failed: %s', err])
    expect(out).toContain('kaboom')
    expect(out).toContain('at ')
  })

  it('appends leftover args not consumed by placeholders', () => {
    expect(formatConsoleArgs(['%s!', 'hi', 'extra'])).toBe('hi! extra')
  })

  it('falls back to a space-joined dump when there is no format string', () => {
    expect(formatConsoleArgs(['plain', 'message', 42])).toBe('plain message 42')
    expect(formatConsoleArgs([{ a: 1 }])).toBe('{"a":1}')
    expect(formatConsoleArgs([])).toBe('')
  })
})

describe('formatLogArg / safeJson', () => {
  it('keeps strings as-is and JSON-serializes everything else', () => {
    expect(formatLogArg('x')).toBe('x')
    expect(formatLogArg(1)).toBe('1')
    expect(formatLogArg({ a: 1 })).toBe('{"a":1}')
    expect(safeJson(Symbol('s'))).toBe('Symbol(s)')
  })
  it('degrades gracefully on structures JSON.stringify rejects', () => {
    const c: Record<string, unknown> = { ok: true }
    c.self = c
    expect(safeJson(c)).toBe('[object Object]')
  })
})
