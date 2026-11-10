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
    targetAgentId: 'cli-agent-1',
    targetSessionId: 'cli-sess-1',
    task: 'investigate performance bottleneck',
    status: 'queued',
    revision: 1,
    targetBusyAtCreation: false,
    createdAt: 1,
    updatedAt: 1,
    targetKind: 'cli',
    targetCliAgentId: 'cli-agent-1',
    ...overrides
  }
}

function baseContext(): ToolContext {
  return { cwd: '/proj', ask: async () => null }
}

const sampleAgents = [
  { id: 'agy-google', label: 'Antigravity Google', status: 'ready' },
  { id: 'oc-default', label: 'OpenCode Default', status: 'ready' },
  { id: 'oc-needs-login', label: 'OpenCode Custom', status: 'needs-login' }
]

describe('delegate_cli tool', () => {
  it('requires a user-origin run context and rejects a delegated-origin run', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateCliTool({
      createDelegation,
      listCliAgents: () => sampleAgents,
      runContext: () => delegatedRun
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'refactor code' },
      baseContext()
    )

    expect(r.output).toBeUndefined()
    expect(r.error).toBe('delegate_cli: only a user-origin run may delegate work.')
    expect(createDelegation).not.toHaveBeenCalled()
  })

  it('fails closed when no run context is available', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => makeDelegation(),
      listCliAgents: () => sampleAgents
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'refactor code' },
      baseContext()
    )

    expect(r.output).toBeUndefined()
    expect(r.error).toBe('delegate_cli: no run context is available for this invocation.')
  })

  it('lists available agents in id — label format when the requested agent is unknown', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => makeDelegation(),
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'non-existent', task: 'check logs' },
      baseContext()
    )

    expect(r.output).toBeUndefined()
    expect(r.error).toContain('unknown CLI agent "non-existent"')
    expect(r.error).toContain('Available agents:')
    expect(r.error).toContain('agy-google — Antigravity Google')
    expect(r.error).toContain('oc-default — OpenCode Default')
    expect(r.error).toContain('oc-needs-login — OpenCode Custom')
  })

  it('handles unknown agent when no CLI agents are available', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => makeDelegation(),
      listCliAgents: () => [],
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'check logs' },
      baseContext()
    )

    expect(r.error).toContain('unknown CLI agent "agy-google"')
    expect(r.error).toContain('No CLI agents are available')
  })

  it('errors when the target CLI agent is not ready', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => makeDelegation(),
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'oc-needs-login', task: 'run diagnostics' },
      baseContext()
    )

    expect(r.output).toBeUndefined()
    expect(r.error).toBe('delegate_cli: CLI agent "OpenCode Custom" is not ready (needs-login).')
  })

  it('resolves agent by exact id', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-1' }))
    const tool = createDelegateCliTool({
      createDelegation,
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'run audit' },
      baseContext()
    )

    expect(r.error).toBeUndefined()
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetCliAgentId: 'agy-google',
      task: 'run audit',
      cliSessionId: undefined
    })
    expect(r.output).toBe('Delegation del-1 queued for Antigravity Google.')
    expect(r.metadata).toEqual({ delegationId: 'del-1', cliAgentId: 'agy-google' })
  })

  it('resolves agent by case-insensitive label', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-2' }))
    const tool = createDelegateCliTool({
      createDelegation,
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'antigravity google', task: 'run benchmark' },
      baseContext()
    )

    expect(r.error).toBeUndefined()
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetCliAgentId: 'agy-google',
      task: 'run benchmark',
      cliSessionId: undefined
    })
    expect(r.output).toBe('Delegation del-2 queued for Antigravity Google.')
    expect(r.metadata).toEqual({ delegationId: 'del-2', cliAgentId: 'agy-google' })
  })

  it('passes session_id for feedback rounds into the same conversation', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-3' }))
    const tool = createDelegateCliTool({
      createDelegation,
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'oc-default', task: 'fix remaining errors', session_id: 'cli-session-42' },
      baseContext()
    )

    expect(r.error).toBeUndefined()
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetCliAgentId: 'oc-default',
      task: 'fix remaining errors',
      cliSessionId: 'cli-session-42'
    })
    expect(r.output).toBe('Delegation del-3 queued for OpenCode Default.')
    expect(r.metadata).toEqual({ delegationId: 'del-3', cliAgentId: 'oc-default' })
  })

  it('returns metadata with delegationId and cliAgentId', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-meta-123' }))
    const tool = createDelegateCliTool({
      createDelegation,
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'run tests' },
      baseContext()
    )

    expect(r.metadata).toEqual({
      delegationId: 'del-meta-123',
      cliAgentId: 'agy-google'
    })
  })

  it('catches thrown errors from createDelegation and returns { error }', async () => {
    const tool = createDelegateCliTool({
      createDelegation: async () => {
        throw new Error('Concurrent task quota reached for antigravity')
      },
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'agy-google', task: 'do work' },
      baseContext()
    )

    expect(r.output).toBeUndefined()
    expect(r.error).toBe('delegate_cli: Concurrent task quota reached for antigravity')
  })

  it('uses custom resolveCliAgent when supplied', async () => {
    const resolveCliAgent = vi.fn((query: string) => {
      if (query === 'custom-alias') {
        return { id: 'agy-google', label: 'Antigravity Google', status: 'ready' }
      }
      return undefined
    })
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'del-custom' }))
    const tool = createDelegateCliTool({
      createDelegation,
      resolveCliAgent,
      listCliAgents: () => sampleAgents,
      runContext: () => userRun
    })

    const r = await tool.run(
      { agent: 'custom-alias', task: 'custom task' },
      baseContext()
    )

    expect(resolveCliAgent).toHaveBeenCalledWith('custom-alias')
    expect(r.error).toBeUndefined()
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetCliAgentId: 'agy-google',
      task: 'custom task',
      cliSessionId: undefined
    })
  })
})

describe('delegate_cli permission rules', () => {
  it('is allowed by default in build mode', () => {
    expect(DEFAULT_MEOW_CONFIG.permission['delegate_cli']).toBe('allow')
  })

  it('is an ask in plan mode', () => {
    expect(PLAN_RULES['delegate_cli']).toBe('ask')
  })
})
