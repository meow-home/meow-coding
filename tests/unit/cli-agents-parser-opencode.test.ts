import { describe, expect, it } from 'vitest'
import {
  createOpenCodeParser,
  parseOpenCodeLine
} from '../../src/main/cli-agents/parsers/opencode'

describe('createOpenCodeParser', () => {
  it('parses init event and tracks session id without emitting transcript notice', () => {
    const parser = createOpenCodeParser()
    const line = JSON.stringify({
      type: 'init',
      session_id: 'ses_abc123'
    })

    const res = parser.parseLine(line)
    expect(parser.getState().conversationId).toBe('ses_abc123')
    expect(res.conversationId).toBe('ses_abc123')
    expect(res.items).toEqual([])
  })

  it('parses assistant text from delta, text, and content fields', () => {
    const parser = createOpenCodeParser()

    const r1 = parser.parseLine(JSON.stringify({ type: 'message', delta: 'Let me inspect ' }))
    expect(r1.items).toHaveLength(1)
    expect(r1.items[0]).toMatchObject({ kind: 'assistant', text: 'Let me inspect ' })

    const r2 = parser.parseLine(JSON.stringify({ type: 'text', text: 'the project files.' }))
    expect(r2.items).toHaveLength(1)
    expect(r2.items[0]).toMatchObject({ kind: 'assistant', text: 'the project files.' })

    const r3 = parser.parseLine(JSON.stringify({ content: 'Here is the summary.' }))
    expect(r3.items).toHaveLength(1)
    expect(r3.items[0]).toMatchObject({ kind: 'assistant', text: 'Here is the summary.' })
  })

  it('handles tool start followed by tool result without duplicating', () => {
    const parser = createOpenCodeParser()

    // Tool start (use)
    const startLine = JSON.stringify({
      type: 'tool_use',
      id: 'call_1',
      tool: 'bash',
      input: { command: 'npm test' }
    })
    const r1 = parser.parseLine(startLine)
    expect(r1.items).toEqual([])

    // Tool result
    const resultLine = JSON.stringify({
      type: 'tool_result',
      id: 'call_1',
      tool: 'bash',
      output: 'Tests passed!'
    })
    const r2 = parser.parseLine(resultLine)
    expect(r2.items).toHaveLength(1)
    expect(r2.items[0]).toMatchObject({
      kind: 'tool',
      tool: 'bash',
      input: { command: 'npm test' },
      output: 'Tests passed!'
    })

    // Duplicate result line should emit nothing
    const r3 = parser.parseLine(resultLine)
    expect(r3.items).toEqual([])
  })

  it('parses self-contained tool call line with input and output', () => {
    const parser = createOpenCodeParser()
    const line = JSON.stringify({
      type: 'tool',
      id: 'call_read_1',
      tool_name: 'read_file',
      input: { path: 'package.json' },
      output: '{"name": "meow-coding"}'
    })

    const res = parser.parseLine(line)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]).toMatchObject({
      kind: 'tool',
      tool: 'read_file',
      input: { path: 'package.json' },
      output: '{"name": "meow-coding"}'
    })
  })

  it('tracks token usage events and reflects them in state', () => {
    const parser = createOpenCodeParser()
    const usageLine = JSON.stringify({
      type: 'usage',
      usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 }
    })

    const res = parser.parseLine(usageLine)
    expect(res.usage).toEqual({ input: 50, output: 25, total: 75 })
    expect(parser.getState().lastUsage).toEqual({ input: 50, output: 25, total: 75 })
  })

  it('parses error events into error notices', () => {
    const parser = createOpenCodeParser()
    const errLine = JSON.stringify({
      type: 'error',
      error: 'Model provider quota exceeded'
    })

    const res = parser.parseLine(errLine)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]).toMatchObject({
      kind: 'notice',
      level: 'error',
      text: 'Model provider quota exceeded'
    })
  })

  it('parses completed terminal result', () => {
    const parser = createOpenCodeParser()
    // Give it prior usage
    parser.parseLine(JSON.stringify({ usage: { input: 100, output: 50 } }))

    const resultLine = JSON.stringify({
      type: 'result',
      status: 'completed',
      text: 'All tasks completed successfully'
    })

    const res = parser.parseLine(resultLine)
    expect(res.terminal).toEqual({
      status: 'completed',
      text: 'All tasks completed successfully',
      usage: { input: 100, output: 50, total: 150 },
      error: undefined
    })

    const resultItem = res.items.find(i => i.kind === 'result')
    expect(resultItem).toBeDefined()
    expect(resultItem).toMatchObject({
      kind: 'result',
      status: 'completed',
      text: 'All tasks completed successfully'
    })
  })

  it('parses failed, cancelled, and timeout terminal results', () => {
    const p1 = createOpenCodeParser()
    const r1 = p1.parseLine(JSON.stringify({ status: 'failed', error: 'Build error', text: 'Failed' }))
    expect(r1.terminal?.status).toBe('failed')
    expect(r1.terminal?.error).toBe('Build error')

    const p2 = createOpenCodeParser()
    const r2 = p2.parseLine(JSON.stringify({ status: 'cancelled', text: 'Cancelled by user' }))
    expect(r2.terminal?.status).toBe('cancelled')

    const p3 = createOpenCodeParser()
    const r3 = p3.parseLine(JSON.stringify({ status: 'timeout', text: 'Task timed out' }))
    expect(r3.terminal?.status).toBe('timeout')
  })

  it('flushes pending tools when terminal result arrives', () => {
    const parser = createOpenCodeParser()
    parser.parseLine(
      JSON.stringify({
        type: 'tool_use',
        id: 'c_pending',
        tool: 'bash',
        input: { command: 'long_task' }
      })
    )

    const res = parser.parseLine(
      JSON.stringify({
        type: 'result',
        status: 'completed',
        text: 'Finished'
      })
    )

    const flushedTool = res.items.find(i => i.kind === 'tool')
    expect(flushedTool).toBeDefined()
    expect(flushedTool).toMatchObject({
      kind: 'tool',
      tool: 'bash',
      input: { command: 'long_task' }
    })
  })

  it('tolerates malformed lines, partial JSON, non-JSON, and empty inputs without throwing', () => {
    const parser = createOpenCodeParser()

    expect(parser.parseLine('').items).toEqual([])
    expect(parser.parseLine('   \t\n').items).toEqual([])
    expect(parser.parseLine('{"type": "message", "delta').items).toEqual([])
    expect(parser.parseLine('random non-json log line').items).toEqual([])
    expect(parser.parseLine('9999').items).toEqual([])
    expect(parser.parseLine('true').items).toEqual([])
    expect(parser.parseLine('null').items).toEqual([])
    expect(parser.parseLine('{"unknown_prop": 123}').items).toEqual([])
  })
})
