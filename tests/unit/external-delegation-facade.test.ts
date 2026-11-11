import { describe, expect, it, beforeEach } from 'vitest'
import path from 'node:path'
import { ExternalDelegationFacade, toTaskDto, type ExternalDelegationFacadeDeps } from '../../src/main/external-api/facade'
import { ExternalApiError } from '../../src/main/external-api/errors'
import type { AgentConfig, ModelRef, NewAgentInput, SessionDelegation, Workspace } from '../../src/shared/types'

const ROOT = path.resolve('/repo')

class FakeDelegations {
  records: SessionDelegation[] = []
  n = 0
  notified: string[] = []
  notifyAgentAvailable(agentId: string): void { this.notified.push(agentId) }
  createExternal(input: { projectPath: string; targetAgentId: string; task: string; planKey: string }): SessionDelegation {
    if (input.task.includes('bad')) throw new Error('[meow] Delegation task must not be empty.')
    const rec: SessionDelegation = {
      id: `d${++this.n}`, projectPath: input.projectPath, sourceAgentId: 'external:claude', sourceSessionId: 'external:claude',
      targetAgentId: input.targetAgentId, targetSessionId: `${input.targetAgentId}-s`, task: input.task, status: 'queued',
      revision: 1, targetBusyAtCreation: false, createdAt: this.n, updatedAt: this.n,
      sourceKind: 'external', externalClient: 'claude', planKey: input.planKey
    }
    this.records.push(rec)
    return rec
  }
  async cancel(id: string) { const r = this.records.find(x => x.id === id)!; r.status = 'cancelled'; return { ...r } }
  getStatus(id: string) { return this.records.find(r => r.id === id) }
  getStore() { return { list: (f?: { projectPath?: string }) => this.records.filter(r => !f?.projectPath || r.projectPath === f.projectPath) } }
}

function setup(
  existing: Workspace[] = [],
  defaultModel: () => ModelRef | null = () => null,
  available: ModelRef[] = []
) {
  const workspaces = [...existing]
  const ensured: string[] = []
  const changed: string[] = []
  const applied: { agentId: string; model: ModelRef }[] = []
  const delegations = new FakeDelegations()
  let agentN = 0
  const deps: ExternalDelegationFacadeDeps = {
    workspaces: {
      load: () => workspaces,
      add: (projectPath, name) => { const ws = { projectPath, name, agents: [] as AgentConfig[] }; workspaces.push(ws); return ws },
      addAgent: (projectPath, input: NewAgentInput) => {
        const ws = workspaces.find(w => w.projectPath === projectPath)!
        ws.agents.push({ id: `a${++agentN}`, ...input })
        return ws
      }
    },
    ensureAgent: async (a) => { ensured.push(a.id) },
    delegations: delegations as unknown as ExternalDelegationFacadeDeps['delegations'],
    isDirectory: (p) => p !== path.resolve('/missing'),
    onWorkspaceChanged: (ws) => { changed.push(ws.projectPath) },
    version: '1.2.3',
    defaultModel,
    availableModels: async () => available,
    applyModel: (agentId, model) => { applied.push({ agentId, model }) }
  }
  return { facade: new ExternalDelegationFacade(deps), workspaces, ensured, changed, applied, delegations }
}

describe('ExternalDelegationFacade', () => {
  let env: ReturnType<typeof setup>
  beforeEach(() => { env = setup() })

  it('auto-adds the project and creates a [claude] session named after the plan', async () => {
    const task = await env.facade.createTask({ cwd: ROOT, planKey: 'docs/plans/2026-x-feature.md', task: 'T1' })
    expect(env.workspaces).toHaveLength(1)
    expect(env.workspaces[0].agents[0].name).toBe('[claude] 2026-x-feature')
    expect(env.ensured).toEqual(['a1'])
    expect(env.changed.length).toBeGreaterThanOrEqual(1)
    expect(task.sessionId).toBe('a1')
    expect(task.status).toBe('queued')
  })

  it('creates a new session on the last used model, including its account', async () => {
    const e = setup([], () => ({ provider: 'codex', model: 'gpt-5', accountId: 'acc-1' }))
    await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    expect(e.workspaces[0].agents[0]).toMatchObject({ model: 'codex/gpt-5', accountId: 'acc-1' })
  })

  it('leaves the model unset when no default model resolves', async () => {
    await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    expect('model' in env.workspaces[0].agents[0]).toBe(false)
    expect('accountId' in env.workspaces[0].agents[0]).toBe(false)
  })

  it('keeps the model of a reused session', async () => {
    let model: ModelRef | null = { provider: 'openai', model: 'gpt-4o' }
    const e = setup([], () => model)
    const a = await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    model = { provider: 'anthropic', model: 'claude' }
    const b = await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T2' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(e.workspaces[0].agents).toHaveLength(1)
    expect(e.workspaces[0].agents[0].model).toBe('openai/gpt-4o')
  })

  it('creates the session on the requested model, fuzzy name resolved', async () => {
    const e = setup([], () => ({ provider: 'codex', model: 'gpt-5' }), [
      { provider: 'anthropic', model: 'claude-opus-4-5' },
      { provider: 'codex', model: 'gpt-5' }
    ])
    await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1', model: 'opus' })
    expect(e.workspaces[0].agents[0].model).toBe('anthropic/claude-opus-4-5')
    expect(e.applied).toEqual([])
  })

  it('switches a reused session onto a requested model', async () => {
    const e = setup([], () => ({ provider: 'codex', model: 'gpt-5' }), [
      { provider: 'anthropic', model: 'claude-opus-4-5' },
      { provider: 'codex', model: 'gpt-5', accountId: 'acc-1' }
    ])
    const a = await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const b = await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T2', model: 'anthropic/claude-opus-4-5' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(e.applied).toEqual([{ agentId: a.sessionId, model: { provider: 'anthropic', model: 'claude-opus-4-5' } }])
  })

  it('does not reapply a model the session already runs', async () => {
    const e = setup([], () => ({ provider: 'codex', model: 'gpt-5' }), [{ provider: 'codex', model: 'gpt-5' }])
    const a = await e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    await e.facade.createTask({ cwd: ROOT, planKey: '', sessionId: a.sessionId, task: 'T2', model: 'codex/gpt-5' })
    expect(e.applied).toEqual([])
  })

  it('rejects an unknown or ambiguous model with the candidates and creates nothing', async () => {
    const e = setup([], () => null, [
      { provider: 'anthropic', model: 'claude-opus-4-5' },
      { provider: 'anthropic', model: 'claude-opus-4-1' }
    ])
    await expect(e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1', model: 'nope' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('Available: anthropic/claude-opus-4-5') })
    await expect(e.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1', model: 'opus' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('is ambiguous') })
    expect(e.workspaces.flatMap(w => w.agents)).toHaveLength(0)
    expect(e.ensured).toEqual([])
  })

  it('lists models with the fallback one marked', async () => {
    const e = setup([], () => ({ provider: 'codex', model: 'gpt-5', accountId: 'acc-1' }), [
      { provider: 'anthropic', model: 'claude-opus-4-5' },
      { provider: 'codex', model: 'gpt-5', accountId: 'acc-1', accountLabel: 'work' }
    ])
    expect(await e.facade.listModels()).toEqual([
      { id: 'anthropic/claude-opus-4-5', provider: 'anthropic', model: 'claude-opus-4-5' },
      {
        id: 'codex/gpt-5',
        provider: 'codex',
        model: 'gpt-5',
        accountId: 'acc-1',
        accountLabel: 'work',
        default: true
      }
    ])
  })

  it('uses the title when given', async () => {
    await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', title: 'My plan', task: 'T1' })
    expect(env.workspaces[0].agents[0].name).toBe('[claude] My plan')
  })

  it('reuses the session for the same plan and creates a new one for another plan', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const b = await env.facade.createTask({ cwd: ROOT, planKey: './p.md', task: 'T2' })
    const c = await env.facade.createTask({ cwd: ROOT, planKey: 'q.md', task: 'T3' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(c.sessionId).not.toBe(a.sessionId)
  })

  it('creates a new session when the previous one was removed', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    env.workspaces[0].agents = []
    const b = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T2' })
    expect(b.sessionId).not.toBe(a.sessionId)
  })

  it('matches an existing workspace regardless of path style', async () => {
    const e = setup([{ projectPath: ROOT, name: 'repo', agents: [] }])
    await e.facade.createTask({ cwd: ROOT + path.sep, planKey: 'p.md', task: 'T1' })
    expect(e.workspaces).toHaveLength(1)
  })

  it('send queues into the same session with the same plan key', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const b = await env.facade.createTask({ cwd: ROOT, planKey: '', sessionId: a.sessionId, task: 'fix it' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(b.planKey).toBe(a.planKey)
  })

  it('send to an unknown session is a 404', async () => {
    await expect(env.facade.createTask({ cwd: ROOT, planKey: '', sessionId: 'zzz', task: 'x' }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('a missing cwd is a 400', async () => {
    await expect(env.facade.createTask({ cwd: '/missing', planKey: 'p.md', task: 'x' }))
      .rejects.toBeInstanceOf(ExternalApiError)
  })

  it('maps service validation errors to 400', async () => {
    await expect(env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'bad' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('getTask and cancelTask only expose external records', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    env.delegations.records.push({ ...env.delegations.records[0], id: 'internal', sourceKind: undefined })
    expect(env.facade.getTask(a.id)?.id).toBe(a.id)
    expect(env.facade.getTask('internal')).toBeUndefined()
    await expect(env.facade.cancelTask('internal')).rejects.toMatchObject({ status: 404 })
    expect((await env.facade.cancelTask(a.id)).status).toBe('cancelled')
  })

  it('rejects an empty or oversized task before creating a session', async () => {
    await expect(env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: '   ' }))
      .rejects.toMatchObject({ status: 400, message: '[meow] Delegation task must not be empty.' })
    await expect(env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'x'.repeat(32 * 1024 + 1) }))
      .rejects.toMatchObject({ status: 400, message: '[meow] Delegation task exceeds the 32 KiB limit.' })
    expect(env.workspaces.flatMap(w => w.agents)).toHaveLength(0)
    expect(env.ensured).toEqual([])
  })

  it('resumeQueued registers each queued external target and wakes its pump', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T2' })
    const c = await env.facade.createTask({ cwd: ROOT, planKey: 'q.md', task: 'T3' })
    env.delegations.records.find(r => r.targetAgentId === c.sessionId)!.status = 'completed'
    env.delegations.records.push({ ...env.delegations.records[0], id: 'gone', targetAgentId: 'missing' })
    env.ensured.length = 0
    await env.facade.resumeQueued()
    expect(env.ensured).toEqual([a.sessionId])
    expect(env.delegations.notified).toEqual([a.sessionId])
  })

  it('exposes endReason on the task DTO only when set', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const rec = env.delegations.records.find(r => r.id === a.id)!
    expect('endReason' in toTaskDto(rec)).toBe(false)
    expect(toTaskDto({ ...rec, status: 'completed', endReason: 'max-steps' }).endReason).toBe('max-steps')
  })

  it('reports the version', () => {
    expect(env.facade.version()).toBe('1.2.3')
  })
})
