import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAntigravityParser,
  formatDeniedAction,
  parseAntigravityLine,
  parseTokenUsage
} from '../../src/main/cli-agents/parsers/antigravity'

describe('parseTokenUsage', () => {
  it('parses token usage from snake_case, camelCase, and short fields', () => {
    expect(parseTokenUsage({ input_tokens: 10, output_tokens: 20, total_tokens: 30 })).toEqual({
      input: 10,
      output: 20,
      total: 30
    })

    expect(parseTokenUsage({ inputTokens: 5, outputTokens: 15, totalTokens: 20 })).toEqual({
      input: 5,
      output: 15,
      total: 20
    })

    expect(parseTokenUsage({ input: 2, output: 8 })).toEqual({
      input: 2,
      output: 8,
      total: 10
    })
  })

  it('returns undefined for invalid or empty inputs', () => {
    expect(parseTokenUsage(null)).toBeUndefined()
    expect(parseTokenUsage(undefined)).toBeUndefined()
    expect(parseTokenUsage({})).toBeUndefined()
    expect(parseTokenUsage('tokens')).toBeUndefined()
  })
})

describe('formatDeniedAction', () => {
  it('formats denied actions into string representations', () => {
    expect(formatDeniedAction({ action: 'command', parameters: { CommandLine: 'git push' } })).toBe(
      'command(git push)'
    )
    expect(formatDeniedAction({ action: 'command', target: 'rm -rf /' })).toBe('command(rm -rf /)')
    // display_name is not a target, falls back to action(*)
    expect(formatDeniedAction({ action: 'command', display_name: 'RunCommand' })).toBe('command(*)')
    expect(formatDeniedAction({ action: 'write_file', parameters: { path: 'a.txt' } })).toBe('write_file(a.txt)')
    expect(formatDeniedAction({ action: 'command' })).toBe('command(*)')
    expect(formatDeniedAction('command(git checkout)')).toBe('command(git checkout)')
  })
})

describe('createAntigravityParser with fixture stream', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/cli-agents/agy-stream.ndjson')
  const fixtureLines = readFileSync(fixturePath, 'utf-8')
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)

  it('parses the entire stream line by line correctly', () => {
    const parser = createAntigravityParser()
    const allItems = []
    let finalTerminal

    for (const line of fixtureLines) {
      const res = parser.parseLine(line)
      if (res.items.length > 0) {
        allItems.push(...res.items)
      }
      if (res.terminal) {
        finalTerminal = res.terminal
      }
    }

    expect(parser.getState().conversationId).toBe('c-agy-12345')

    // 2 assistant deltas, 1 tool item (DONE), 1 warn notice (denied actions), 1 result item (no init notice)
    expect(allItems).toHaveLength(5)

    expect(allItems[0]).toMatchObject({
      kind: 'assistant',
      text: 'I will check the '
    })
    expect(allItems[1]).toMatchObject({
      kind: 'assistant',
      text: 'git status for you.'
    })

    expect(allItems[2]).toMatchObject({
      kind: 'tool',
      tool: 'run_command',
      input: { CommandLine: 'git status' },
      output: expect.stringContaining('working tree clean')
    })

    expect(allItems[3]).toMatchObject({
      kind: 'notice',
      level: 'warn',
      text: expect.stringContaining('command(git push)')
    })

    expect(allItems[4]).toMatchObject({
      kind: 'result',
      status: 'completed',
      text: 'Working directory is clean.',
      deniedActions: ['command(git push)'],
      usage: { input: 120, output: 45, total: 165 }
    })

    expect(finalTerminal).toBeDefined()
    expect(finalTerminal).toEqual({
      status: 'completed',
      text: 'Working directory is clean.',
      usage: { input: 120, output: 45, total: 165 },
      deniedActions: ['command(git push)'],
      error: undefined
    })
  })
})

describe('AntigravityParser unit edge cases', () => {
  it('deduplicates tool steps when DONE is delivered twice', () => {
    const parser = createAntigravityParser()

    const active = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 10,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'read_file',
        tool_info: { parameters: { Path: 'foo.ts' } }
      }
    })
    const done = JSON.stringify({
      event: 'step_update',
      step_update: {
        step_index: 10,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'read_file',
        tool_info: { output: 'content' }
      }
    })

    const res1 = parser.parseLine(active)
    expect(res1.items).toEqual([])

    const res2 = parser.parseLine(done)
    expect(res2.items).toHaveLength(1)
    expect(res2.items[0]).toMatchObject({
      kind: 'tool',
      tool: 'read_file',
      input: { Path: 'foo.ts' },
      output: 'content'
    })

    // Duplicate DONE line: must emit nothing
    const res3 = parser.parseLine(done)
    expect(res3.items).toEqual([])
  })

  it('captures conversationId on init without emitting transcript notice', () => {
    const parser = createAntigravityParser()
    const res = parser.parseLine(
      JSON.stringify({
        event: 'init',
        conversation_id: 'c-test-init',
        init: { cwd: '/proj' }
      })
    )
    expect(res.items).toEqual([])
    expect(res.conversationId).toBe('c-test-init')
    expect(parser.getState().conversationId).toBe('c-test-init')
  })

  it('maps every Antigravity result status correctly', () => {
    const parser1 = createAntigravityParser()
    const resCanceled = parser1.parseLine(
      JSON.stringify({ event: 'result', result: { status: 'CANCELED', response: 'Stopped' } })
    )
    expect(resCanceled.terminal?.status).toBe('cancelled')

    const parser2 = createAntigravityParser()
    const resInterrupted = parser2.parseLine(
      JSON.stringify({ event: 'result', result: { status: 'INTERRUPTED', response: 'Cut short' } })
    )
    expect(resInterrupted.terminal?.status).toBe('interrupted')

    const parser3 = createAntigravityParser()
    const resRunning = parser3.parseLine(
      JSON.stringify({ event: 'result', result: { status: 'RUNNING', response: 'Still running' } })
    )
    expect(resRunning.terminal?.status).toBe('timeout')
    expect(resRunning.items.some(i => i.kind === 'notice' && i.level === 'warn' && i.text.includes('RUNNING'))).toBe(true)

    const parser4 = createAntigravityParser()
    const resInvalid = parser4.parseLine(
      JSON.stringify({ event: 'result', result: { status: 'INVALID', response: 'Bad args' } })
    )
    expect(resInvalid.terminal?.status).toBe('failed')
    expect(resInvalid.items.some(i => i.kind === 'notice' && i.level === 'warn' && i.text.includes('INVALID'))).toBe(true)

    const parser5 = createAntigravityParser()
    const resWaiting = parser5.parseLine(
      JSON.stringify({ event: 'result', result: { status: 'WAITING', response: 'Waiting on user' } })
    )
    expect(resWaiting.terminal?.status).toBe('failed')
    expect(resWaiting.items.some(i => i.kind === 'notice' && i.level === 'warn' && i.text.includes('WAITING'))).toBe(true)
  })

  it('maps ERROR status to failed', () => {
    const parser = createAntigravityParser()
    const errorResult = JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'c-err',
        status: 'ERROR',
        error: 'Execution failed',
        response: 'Could not complete task'
      }
    })

    const res = parser.parseLine(errorResult)
    expect(res.terminal?.status).toBe('failed')
    expect(res.terminal?.error).toBe('Execution failed')
    expect(res.terminal?.text).toBe('Could not complete task')
    expect(res.items.some(i => i.kind === 'result' && i.status === 'failed')).toBe(true)
  })

  it('maps unknown status to failed and produces a warning notice with raw status', () => {
    const parser = createAntigravityParser()
    const unknownResult = JSON.stringify({
      event: 'result',
      result: {
        status: 'BLOCKED_BY_USER',
        response: 'Turn interrupted'
      }
    })

    const res = parser.parseLine(unknownResult)
    expect(res.terminal?.status).toBe('failed')
    const warnNotice = res.items.find(i => i.kind === 'notice' && i.level === 'warn')
    expect(warnNotice).toBeDefined()
    expect(warnNotice?.text).toContain('BLOCKED_BY_USER')
  })

  it('flushes leftover ACTIVE tools if result arrives before DONE', () => {
    const parser = createAntigravityParser()
    parser.parseLine(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 99,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'bash',
          tool_info: { parameters: { command: 'sleep 10' } }
        }
      })
    )

    const res = parser.parseLine(
      JSON.stringify({
        event: 'result',
        result: { status: 'SUCCESS', response: 'Done' }
      })
    )

    const leftoverTool = res.items.find(i => i.kind === 'tool')
    expect(leftoverTool).toBeDefined()
    expect(leftoverTool).toMatchObject({
      kind: 'tool',
      tool: 'bash',
      input: { command: 'sleep 10' }
    })
  })

  it('ignores checkpoint, unknown step types, and empty deltas', () => {
    const parser = createAntigravityParser()

    const checkpoint = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'checkpoint' }
    })
    const unknownStep = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'unknown' }
    })
    const emptyDelta = JSON.stringify({
      event: 'step_update',
      step_update: { step_type: 'agent_response', text_delta: '' }
    })

    expect(parser.parseLine(checkpoint).items).toEqual([])
    expect(parser.parseLine(unknownStep).items).toEqual([])
    expect(parser.parseLine(emptyDelta).items).toEqual([])
  })

  it('tolerates malformed lines, partial JSON, non-JSON and empty input without throwing', () => {
    const parser = createAntigravityParser()

    expect(parser.parseLine('').items).toEqual([])
    expect(parser.parseLine('   \n  ').items).toEqual([])
    expect(parser.parseLine('{"event": "step_update", "step_up').items).toEqual([])
    expect(parser.parseLine('not json at all').items).toEqual([])
    expect(parser.parseLine('12345').items).toEqual([])
    expect(parser.parseLine('"string json"').items).toEqual([])
    expect(parser.parseLine('null').items).toEqual([])
    expect(parser.parseLine('{"event": "custom_metric", "val": 42}').items).toEqual([])
  })
})
