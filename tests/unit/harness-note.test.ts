import { describe, expect, it } from 'vitest'
import { attachNote, cutNote, harnessNote, toolLoopNote } from '../../src/main/agent/harness-note'
import type { ToolCallData } from '../../src/shared/types'

const call = (over: Partial<ToolCallData> = {}): ToolCallData => ({ id: 'c', tool: 'read', input: {}, permission: 'allowed', ...over })

describe('harness notes', () => {
  it('wraps text as a [meow] system reminder', () => {
    expect(harnessNote('hello')).toBe('<system-reminder>\n[meow] hello\n</system-reminder>')
  })

  it('appends to output, to error, or stands alone', () => {
    const withOutput = call({ output: 'data' })
    attachNote(withOutput, 'N')
    expect(withOutput.output).toBe('data\nN')

    const withError = call({ error: 'boom', output: 'partial' })
    attachNote(withError, 'N')
    expect(withError.error).toBe('boom\nN')
    expect(withError.output).toBe('partial')

    const empty = call()
    attachNote(empty, 'N')
    expect(empty.output).toBe('N')
  })

  it('explains each cut reason', () => {
    expect(cutNote('tool-flood', 32)).toContain('after 32 tool calls')
    expect(cutNote('interleaved', 32)).toContain('kept writing after calling tools')
    expect(cutNote('repetition', 32)).toContain('started repeating itself')
    for (const r of ['tool-flood', 'interleaved', 'repetition'] as const) {
      expect(cutNote(r, 32).startsWith('<system-reminder>\n[meow] ')).toBe(true)
    }
  })

  it('tells a polling model to wait and a repeating model to change course', () => {
    expect(toolLoopNote({ kind: 'poll', tool: 'bash_output', count: 3 })).toContain('wait_s')
    const repeat = toolLoopNote({ kind: 'repeat', tool: 'read', count: 3 })
    expect(repeat).toContain('read')
    expect(repeat).toContain('3 times')
  })
})
