import { describe, expect, it } from 'vitest'
import { createResponseGuard, MAX_TOOL_CALLS_PER_RESPONSE } from '../../src/main/agent/response-guard'

describe('createResponseGuard', () => {
  it('accepts 32 tool calls and flags the 33rd as a flood', () => {
    expect(MAX_TOOL_CALLS_PER_RESPONSE).toBe(32)
    const g = createResponseGuard()
    for (let i = 0; i < 32; i++) expect(g.toolCall()).toEqual({ kind: 'ok' })
    expect(g.toolCall()).toEqual({ kind: 'tool-flood' })
  })

  it('flags call → text → call as interleaved', () => {
    const g = createResponseGuard()
    expect(g.text('Checking the file. ').kind).toBe('ok')
    expect(g.toolCall().kind).toBe('ok')
    expect(g.text('Now the result shows the getter is missing. ').kind).toBe('ok')
    expect(g.toolCall()).toEqual({ kind: 'interleaved' })
  })

  it('allows text before calls and whitespace between calls', () => {
    const g = createResponseGuard()
    g.text('I will read both files. ')
    expect(g.toolCall().kind).toBe('ok')
    g.text('\n ')
    expect(g.toolCall().kind).toBe('ok')
  })

  it('reports the raw length of text streamed before the first call', () => {
    const g = createResponseGuard()
    g.text('abc ')
    g.text('def')
    g.toolCall()
    g.text(' tail that must be dropped')
    expect(g.textBeforeFirstCall()).toBe(7)
  })

  it('flags repetition on the text channel with a keep offset', () => {
    const g = createResponseGuard()
    let verdict = g.text('Intro. ')
    for (let i = 0; i < 200 && verdict.kind === 'ok'; i++) verdict = g.text('counselor')
    expect(verdict.kind).toBe('repetition')
    if (verdict.kind === 'repetition') {
      expect(verdict.channel).toBe('text')
      expect(verdict.keepChars).toBeGreaterThanOrEqual('Intro. '.length)
    }
  })

  it('tracks reasoning separately from text', () => {
    const g = createResponseGuard()
    let verdict = g.reasoning('Thinking. ')
    for (let i = 0; i < 200 && verdict.kind === 'ok'; i++) verdict = g.reasoning('loop ')
    expect(verdict).toMatchObject({ kind: 'repetition', channel: 'reasoning' })
    expect(g.text('A normal answer.').kind).toBe('ok')
  })

  it('honors a custom tool-call cap', () => {
    const g = createResponseGuard({ maxToolCalls: 2 })
    g.toolCall()
    g.toolCall()
    expect(g.toolCall().kind).toBe('tool-flood')
  })
})
