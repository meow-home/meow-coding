import { describe, expect, it, vi } from 'vitest'
import { createDelegateSessionTool } from '../../src/main/agent/tools/delegate-session'
import { createTaskTool } from '../../src/main/agent/tools/task'
import { computePeerTargets } from '../../src/main/peer-roster'
import { DEFAULT_MEOW_CONFIG } from '../../src/main/agent/config'
import { PLAN_RULES } from '../../src/main/agent/permission'
import { buildTurnReminder } from '../../src/main/agent/prompt'
import type { AgentRunContext } from '../../src/main/agent/run-context'
import type { SessionDelegation } from '../../src/shared/types'
import type { ToolContext, ToolDefinition } from '../../src/main/agent/tools/types'
import type { Workspace } from '../../src/shared/types'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'

const userRun: AgentRunContext = {
  runId: 'run-1',
  agentId: 'agent-alpha',
  sessionId: 'session-alpha',
  origin: 'user'
}

const delegatedRun: AgentRunContext = { ...userRun, origin: 'delegation' }

function makeDelegation(overrides: Partial<SessionDelegation> = {}): SessionDelegation {
  return {
    id: 'delegation-1',
    projectPath: '/proj',
    sourceAgentId: 'agent-alpha',
    sourceSessionId: 'session-alpha',
    targetAgentId: 'agent-beta',
    targetSessionId: 'session-beta',
    task: 'implement the widget',
    status: 'queued',
    revision: 1,
    targetBusyAtCreation: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function baseContext(): ToolContext {
  return { cwd: '/proj', ask: async () => null }
}

describe('delegate_session tool', () => {
  it('requires both target_session_id and task (empty task is rejected)', async () => {
    const tool = createDelegateSessionTool({
      createDelegation: async (input) => {
        if (!input.task?.trim()) throw new Error('Delegation task must not be empty.')
        return makeDelegation()
      },
      runContext: () => userRun
    })
    const r = await tool.run({ target_session_id: 'agent-beta', task: '' }, baseContext())
    expect(r.output).toBeUndefined()
    expect(r.error).toContain('task must not be empty')
  })

  it('passes only the allowed args to createDelegation (extra keys are ignored)', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateSessionTool({ createDelegation, runContext: () => userRun })
    const r = await tool.run(
      { target_session_id: 'agent-beta', task: 'x', extra: 1 },
      baseContext()
    )
    expect(r.error).toBeUndefined()
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetAgentId: 'agent-beta',
      task: 'x'
    })
  })

  it('creates a delegation for a user-origin run and returns its id as metadata', async () => {
    const createDelegation = vi.fn(async () => makeDelegation({ id: 'delegation-abc' }))
    const tool = createDelegateSessionTool({ createDelegation, runContext: () => userRun })
    const r = await tool.run(
      { target_session_id: 'agent-beta', task: 'implement the widget' },
      baseContext()
    )
    expect(createDelegation).toHaveBeenCalledWith({
      sourceRun: userRun,
      targetAgentId: 'agent-beta',
      task: 'implement the widget'
    })
    expect(r.error).toBeUndefined()
    expect(r.output).toContain('Delegation delegation-abc queued for session agent-beta')
    // The renderer must recover the id from metadata, never by parsing prose.
    expect(r.metadata).toEqual({ delegationId: 'delegation-abc' })
  })

  it('rejects a nested (delegation-origin) run', async () => {
    const createDelegation = vi.fn(async () => makeDelegation())
    const tool = createDelegateSessionTool({ createDelegation, runContext: () => delegatedRun })
    const r = await tool.run(
      { target_session_id: 'agent-beta', task: 'x' },
      baseContext()
    )
    expect(r.output).toBeUndefined()
    expect(r.error).toContain('only a user-origin run may delegate')
    expect(createDelegation).not.toHaveBeenCalled()
  })

  it('fails closed when no run context is available', async () => {
    const tool = createDelegateSessionTool({ createDelegation: async () => makeDelegation() })
    const r = await tool.run(
      { target_session_id: 'agent-beta', task: 'x' },
      baseContext()
    )
    expect(r.error).toContain('no run context')
  })

  it('surfaces createDelegation validation failures as a tool error', async () => {
    const tool = createDelegateSessionTool({
      createDelegation: async () => { throw new Error('A session cannot delegate to itself.') },
      runContext: () => userRun
    })
    const r = await tool.run(
      { target_session_id: 'agent-beta', task: 'x' },
      baseContext()
    )
    expect(r.error).toBe('delegate_session: A session cannot delegate to itself.')
  })
})

describe('delegate_session permission rules', () => {
  it('is allowed by default in build mode', () => {
    expect(DEFAULT_MEOW_CONFIG.permission['delegate_session']).toBe('allow')
  })

  it('is an ask in plan mode', () => {
    expect(PLAN_RULES['delegate_session']).toBe('ask')
  })
})

class StubLlm implements LlmClient {
  calls: LlmStreamOptions[] = []
  async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
    this.calls.push(opts)
    yield { kind: 'text', text: 'ok' }
    yield { kind: 'finish' }
  }
}

describe('task vs delegate_session guidance', () => {
  it('distinguishes persistent session delegation from ephemeral task subagents in tool descriptions', () => {
    const llm = new StubLlm()
    const tools = new Map<string, ToolDefinition>([['read', { name: 'read', description: 'read', schema: { parse: () => ({}) } as never, run: async () => ({}) }]])
    const taskDef = createTaskTool({ llm, model: 'm', tools })
    const delegateDef = createDelegateSessionTool({ createDelegation: async () => makeDelegation() })

    expect(taskDef.description).toContain('subagent')
    expect(delegateDef.description).toContain('existing persistent session')
    expect(delegateDef.description).not.toBe(taskDef.description)
  })
})

describe('buildTurnReminder peer guidance', () => {
  it('mentions a delegatable peer list once peers are supplied', () => {
    const reminder = buildTurnReminder(
      {
        platform: 'win32',
        shell: 'cmd.exe',
        cwd: 'C:\\proj',
        date: '2026-01-01',
        git: { branch: 'master', dirtyCount: 0 },
        peers: [{ agentId: 'agent-beta', name: 'Beta', mode: 'build', state: 'idle' }]
      },
      { path: '', lines: [], truncated: false }
    )
    expect(reminder).toContain('agent-beta')
    expect(reminder).toContain('Beta')
  })
})

describe('computePeerTargets', () => {
  const workspaces: Workspace[] = [
    {
      projectPath: 'C:\\proj',
      name: 'proj',
      agents: [
        { id: 'agent-alpha', name: 'Alpha', templateId: 'meow', cwd: 'C:\\proj', kind: 'native' },
        { id: 'agent-beta', name: 'Beta', templateId: 'meow', cwd: 'C:\\proj', kind: 'native' },
        { id: 'agent-gamma', name: 'Gamma', templateId: 'meow', cwd: 'C:\\other', kind: 'native' }
      ]
    }
  ]

  const lookup = {
    requestingAgentId: 'agent-alpha',
    requestingProjectPath: 'C:\\proj',
    modeOf: (id: string) => (id === 'agent-beta' ? 'plan' as const : 'build' as const),
    stateOf: (id: string) => (id === 'agent-beta' ? 'running' as const : 'idle' as const)
  }

  it('returns only same-project peers excluding the current agent', () => {
    const peers = computePeerTargets(workspaces, lookup)
    expect(peers).toHaveLength(1)
    expect(peers[0]).toMatchObject({ agentId: 'agent-beta', name: 'Beta', mode: 'plan', state: 'running' })
  })

  it('excludes the requesting agent itself', () => {
    const peers = computePeerTargets(workspaces, lookup)
    expect(peers.some(p => p.agentId === 'agent-alpha')).toBe(false)
  })

  it('returns no peers for an unrelated project', () => {
    expect(computePeerTargets(workspaces, {
      requestingAgentId: 'agent-gamma',
      requestingProjectPath: 'C:\\other'
    })).toHaveLength(0)
  })
})
