import { describe, expect, it, vi } from 'vitest'
import { createDelegateCliTool } from '../../src/main/agent/tools/delegate-cli'
import { DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'
import { PLAN_RULES } from '../../src/main/agent/permission'
import type { AgentRunContext } from '../../src/main/agent/run-context'
import type { SessionDelegation } from '../../src/shared/types'
import type { ToolContext } from '../../src/main/agent/tools/types'

const userRun: AgentRunContext = {
  runId: 'run-1',
  agentId: 'agent-alpha',
  sessionId: 'session-alpha',
  origin: 'user'
}

const delegatedRun: AgentRunContext = { ...userRun, origin: 'delegation' }

function makeDelegation(overrides: Partial<SessionDelegation> = {}): SessionDelegation {
  return {
    id: 'delegation-cli-1',
    projectPath: '/proj',
    sourceAgentId: 'agent-alpha',
    sourceSessionId: 'session-alpha',
    targetAgentId: 'antigravity',
    targetSessionId: 'antigravity',
    task: 'investigate performance bottleneck',
    status: 'queued',
    revision: 1,
    targetBusyAtCreation: false,
    createdAt: 1,
    updatedAt: 1,
    targetKind: 'cli',
    ...overrides
  }
}

function baseContext(): ToolContext {
  return { cwd: '/proj', ask: async () => null }
}

describe('delegate_cli tool', () => {
  it('takes only a task', () => {
    const tool = createDelegateCliTool({ createDelegation: async () => makeDelegation() })
    expect(() => tool.schema.parse({ task: 'do it' })).not.toThrow()
    expect(() => tool.schema.parse({ task: 'do it', agent: 'agy' })).toThrow()
    expect(() => tool.schema.parse({})).toThrow()
  })

  it('rejects a delegated-origin run', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateCliTool({ createDelegation, runContext: () => delegatedRun })

    const r = await tool.run({ task: 'refactor code' }, baseContext())

    expect(r.output).toBeUndefined()
    expect(r.error).toBe('delegate_cli: only a user-origin run may delegate work.')
    expect(createDelegation).not.toHaveBeenCalled()
  })

  it('fails closed when no run context is available', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateCliTool({ createDelegation })

    const r = await tool.run({ task: 'refactor code' }, baseContext())

    expect(r.error).toBe('delegate_cli: no run context is available for this invocation.')
    expect(createDelegation).not.toHaveBeenCalled()
  })

  it('refuses to queue when the Antigravity CLI is not ready and points at Settings', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateCliTool({
      createDelegation,
      checkCli: async () => ({ ready: false, error: 'agy was not found' }),
      runContext: () => userRun
    })

    const r = await tool.run({ task: 'refactor code' }, baseContext())

    expect(r.error).toContain('not ready (agy was not found)')
    expect(r.error).toContain('Settings > Antigravity CLI')
    expect(createDelegation).not.toHaveBeenCalled()
  })

  it('queues the task and returns the delegation id in metadata', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-1' }))
    const tool = createDelegateCliTool({
      createDelegation,
      checkCli: async () => ({ ready: true }),
      runContext: () => userRun
    })

    const r = await tool.run({ task: 'refactor code' }, baseContext())

    expect(createDelegation).toHaveBeenCalledWith({ sourceRun: userRun, task: 'refactor code' })
    expect(r.error).toBeUndefined()
    expect(r.output).toBe('Delegation del-1 queued for Antigravity.')
    expect(r.metadata).toEqual({ delegationId: 'del-1', cliAgentId: 'antigravity' })
  })

  it('queues without a readiness check when none is wired', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => makeDelegation({ id: 'del-2' }),
      runContext: () => userRun
    })

    const r = await tool.run({ task: 'refactor code' }, baseContext())
    expect(r.metadata).toEqual({ delegationId: 'del-2', cliAgentId: 'antigravity' })
  })

  it('falls back to the tool context run context', async () => {
    const tool = createDelegateCliTool({ createDelegation: async () => makeDelegation({ id: 'del-3' }) })
    const r = await tool.run({ task: 'refactor code' }, { ...baseContext(), runContext: userRun })
    expect(r.output).toContain('del-3')
  })

  it('returns thrown createDelegation errors as { error }', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => { throw new Error('[meow] Too many queued delegations') },
      runContext: () => userRun
    })

    const r = await tool.run({ task: 'refactor code' }, baseContext())
    expect(r.error).toBe('delegate_cli: [meow] Too many queued delegations')
  })

  it('is allowed by default in build mode', () => {
    expect(DEFAULT_MEOW_CONFIG.permission['delegate_cli']).toBe('allow')
  })

  it('is an ask in plan mode', () => {
    expect(PLAN_RULES['delegate_cli']).toBe('ask')
  })
})
