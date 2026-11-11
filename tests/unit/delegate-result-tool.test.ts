import { describe, expect, it } from 'vitest'
import { createDelegateResultTool } from '../../src/main/agent/tools/delegate-result'
import type { SessionDelegation } from '../../src/shared/types'
import type { ToolContext } from '../../src/main/agent/tools/types'

function makeDelegation(overrides: Partial<SessionDelegation> = {}): SessionDelegation {
  return {
    id: 'del-1',
    projectPath: '/proj',
    sourceAgentId: 'agent-alpha',
    sourceSessionId: 'session-alpha',
    targetAgentId: 'agent-beta',
    targetSessionId: 'session-beta',
    targetName: 'Widget work',
    task: 'implement the widget',
    status: 'completed',
    revision: 4,
    targetBusyAtCreation: false,
    createdAt: 1,
    updatedAt: 2,
    result: 'widget done',
    touchedFiles: ['src/widget.ts'],
    ...overrides
  }
}

function ctx(agentId = 'agent-alpha'): ToolContext {
  return { cwd: '/proj', agentId, ask: async () => null }
}

function toolFor(record: SessionDelegation | undefined): ReturnType<typeof createDelegateResultTool> {
  return createDelegateResultTool({ getDelegation: (id) => (record && record.id === id ? record : undefined) })
}

describe('delegate_result tool', () => {
  it('returns the stored result and touched files as tool output', async () => {
    const res = await toolFor(makeDelegation()).run({ id: 'del-1' }, ctx())
    expect(res.error).toBeUndefined()
    expect(res.output).toContain('widget done')
    expect(res.output).toContain('completed')
    expect(res.output).toContain('src/widget.ts')
    expect(res.metadata).toMatchObject({ delegationId: 'del-1', status: 'completed' })
  })

  it('reports a still-running delegation without failing', async () => {
    const res = await toolFor(makeDelegation({ status: 'running', result: undefined })).run({ id: 'del-1' }, ctx())
    expect(res.error).toBeUndefined()
    expect(res.output).toContain('running')
    expect(res.output).toContain('no result yet')
  })

  it('surfaces the error of a failed delegation', async () => {
    const res = await toolFor(makeDelegation({ status: 'failed', result: undefined, error: 'boom' }))
      .run({ id: 'del-1' }, ctx())
    expect(res.output).toContain('failed')
    expect(res.output).toContain('boom')
  })

  it('rejects an unknown id and a delegation owned by another session', async () => {
    expect((await toolFor(makeDelegation()).run({ id: 'nope' }, ctx())).error).toContain('unknown delegation id')
    expect((await toolFor(makeDelegation()).run({ id: 'del-1' }, ctx('other-agent'))).error)
      .toContain('belongs to another session')
  })
})
