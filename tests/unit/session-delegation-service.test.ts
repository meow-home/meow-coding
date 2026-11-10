import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SessionDelegationStore } from '../../src/main/session-delegation-store'
import { SessionDelegationService } from '../../src/main/session-delegation-service'
import type {
  DelegationAgent,
  DelegationRuntime,
  CreateDelegationInput,
  CreateCliDelegationInput
} from '../../src/main/session-delegation-service'
import type { AgentRunContext, DelegatedTurnInput, DelegationResultInput, AgentTurnResult } from '../../src/main/agent/run-context'

const run = (over: Partial<AgentRunContext> = {}): AgentRunContext => ({
  runId: 'r1', agentId: 'alpha', sessionId: 'alpha-s', origin: 'user', ...over
})

class FakeRuntime implements DelegationRuntime {
  agents = new Map<string, DelegationAgent>()
  busy = new Set<string>()
  turns: DelegatedTurnInput[] = []
  results: DelegationResultInput[] = []
  wakes: DelegationResultInput[] = []
  /** Holds runDelegatedTurn for the given delegation until released. */
  gates = new Map<string, { release: () => void; promise: Promise<void> }>()
  /** Deterministic run results keyed by delegationId. */
  runResults = new Map<string, AgentTurnResult>()
  stopped: string[] = []
  cancelledRuns = new Set<string>()

  cliAgents = new Map<string, { id: string; label: string }>()
  cliSessions = new Map<string, { id: string; title: string; projectPath: string; agentId: string; delegatedBy?: boolean }>()
  cliBusySessions = new Set<string>()
  cliTasks: { delegationId: string; sourceAgentId: string; sourceName: string; targetCliAgentId: string; cliSessionId: string; task: string }[] = []
  cliStopped: string[] = []
  cliRunResults = new Map<string, AgentTurnResult>()
  cliCancelledRuns = new Set<string>()

  stopRun(agentId: string): void {
    this.stopped.push(agentId)
    for (const turn of this.turns.filter(t => t.targetAgentId === agentId)) {
      this.cancelledRuns.add(turn.delegationId)
      this.gates.get(turn.delegationId)?.release()
    }
  }

  add(agentId: string, projectPath = '/p', name?: string) {
    this.agents.set(agentId, { agentId, name: name ?? `Agent ${agentId}`, projectPath, sessionId: `${agentId}-s` })
  }
  addCliAgent(id: string, label = `CLI ${id}`) {
    this.cliAgents.set(id, { id, label })
  }
  addCliSession(id: string, agentId: string, projectPath = '/p', title = 'CLI Session', delegatedBy = false) {
    this.cliSessions.set(id, { id, title, projectPath, agentId, delegatedBy })
  }
  gate(id: string): { release: () => void; promise: Promise<void> } {
    const existing = this.gates.get(id)
    if (existing) return existing
    let release!: () => void
    const promise = new Promise<void>(r => { release = r })
    const entry = { release, promise }
    this.gates.set(id, entry)
    return entry
  }
  resolveAgent(agentId: string): DelegationAgent | undefined { return this.agents.get(agentId) }
  isBusy(agentId: string): boolean { return this.busy.has(agentId) }
  async runDelegatedTurn(input: DelegatedTurnInput): Promise<AgentTurnResult> {
    this.turns.push(input)
    const preset = this.runResults.get(input.delegationId)
    if (preset) {
      await this.gates.get(input.delegationId)?.promise
      return preset
    }
    await this.gates.get(input.delegationId)?.promise
    if (this.cancelledRuns.has(input.delegationId)) {
      return { runId: input.delegationId, reason: 'cancelled', touchedFiles: [] }
    }
    return { runId: input.delegationId, reason: 'completed', finalText: `done-${input.task}`, touchedFiles: ['/p/a.ts'] }
  }
  async appendResult(input: DelegationResultInput): Promise<void> { this.results.push(input) }
  async wakeSource(input: DelegationResultInput): Promise<void> { this.wakes.push(input) }

  resolveCliAgent(agentId: string): { id: string; label: string } | undefined {
    return this.cliAgents.get(agentId)
  }
  resolveOrCreateCliSession(input: { projectPath: string; agentId: string; cliSessionId?: string }): { id: string; title: string } {
    if (input.cliSessionId) {
      const s = this.cliSessions.get(input.cliSessionId)
      if (!s) throw new Error(`[meow] CLI session not found: ${input.cliSessionId}`)
      if (s.projectPath !== input.projectPath) throw new Error('[meow] CLI session belongs to a different project.')
      return { id: s.id, title: s.title }
    }
    const matching = [...this.cliSessions.values()].filter(s => s.projectPath === input.projectPath && s.agentId === input.agentId)
    if (matching.length > 0) {
      matching.sort((a, b) => (b.delegatedBy ? 1 : 0) - (a.delegatedBy ? 1 : 0))
      return { id: matching[0].id, title: matching[0].title }
    }
    const created = { id: `clis-${this.cliSessions.size + 1}`, title: 'New CLI session', projectPath: input.projectPath, agentId: input.agentId }
    this.cliSessions.set(created.id, created)
    return { id: created.id, title: created.title }
  }
  async runCliTask(input: {
    delegationId: string
    sourceAgentId: string
    sourceName: string
    targetCliAgentId: string
    cliSessionId: string
    task: string
  }): Promise<AgentTurnResult> {
    this.cliTasks.push(input)
    const preset = this.cliRunResults.get(input.delegationId)
    if (preset) {
      await this.gates.get(input.delegationId)?.promise
      return preset
    }
    await this.gates.get(input.delegationId)?.promise
    if (this.cliCancelledRuns.has(input.cliSessionId) || this.cliCancelledRuns.has(input.delegationId)) {
      return { runId: input.delegationId, reason: 'cancelled', touchedFiles: [] }
    }
    return { runId: input.delegationId, reason: 'completed', finalText: `cli-done-${input.task}`, touchedFiles: [] }
  }
  stopCliTask(cliSessionId: string): void {
    this.cliStopped.push(cliSessionId)
    this.cliCancelledRuns.add(cliSessionId)
    for (const task of this.cliTasks.filter(t => t.cliSessionId === cliSessionId)) {
      this.gates.get(task.delegationId)?.release()
    }
  }
  isCliBusy(cliSessionId: string): boolean {
    return this.cliBusySessions.has(cliSessionId)
  }
}

interface Env {
  dir: string
  service: SessionDelegationService
  store: SessionDelegationStore
  runtime: FakeRuntime
}

function setup(overrides: { source?: string; target?: string; projectPath?: string } = {}): Env {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-deleg-svc-'))
  const file = path.join(dir, 'delegations.json')
  const runtime = new FakeRuntime()
  runtime.add(overrides.source ?? 'alpha', overrides.projectPath ?? '/p')
  runtime.add(overrides.target ?? 'beta', overrides.projectPath ?? '/p')
  runtime.addCliAgent('agy_personal', 'Antigravity · Personal')
  runtime.addCliAgent('oc_work', 'OpenCode · Anthropic Work')
  // Monotonic clock so created-at ordering is deterministic (two records never
  // share a timestamp, so the store's FIFO tie-break is not exercised by UUID).
  let clock = 1_000_000
  const now = () => { clock += 1; return clock }
  const store = new SessionDelegationStore(createJsonStore(file), now)
  const service = new SessionDelegationService({ store, runtime, now })
  return { dir, service, store, runtime }
}

const input = (over: Partial<CreateDelegationInput> = {}): CreateDelegationInput => ({
  sourceRun: run(),
  targetAgentId: 'beta',
  task: 'do the thing',
  ...over
})

const cliInput = (over: Partial<CreateCliDelegationInput> = {}): CreateCliDelegationInput => ({
  sourceRun: run(),
  targetCliAgentId: 'agy_personal',
  task: 'do the cli thing',
  ...over
})

async function ticks(n = 8) {
  for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0))
}

/** Polls `pred` until it returns true or `timeout` ms elapse. */
async function until(pred: () => boolean, timeout = 1000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (pred()) return true
    await new Promise(r => setTimeout(r, 2))
  }
  return pred()
}

describe('SessionDelegationService', () => {
  let env: Env
  beforeEach(() => { env = setup() })
  afterEach(() => rmSync(env.dir, { recursive: true, force: true }))

  describe('validation', () => {
    it('rejects a non-user-origin run', async () => {
      await env.service.start()
      expect(() => env.service.create(input({ sourceRun: run({ origin: 'delegation' }) }))).toThrow(/user/i)
    })
    it('rejects self-delegation', async () => {
      await env.service.start()
      expect(() => env.service.create(input({ targetAgentId: 'alpha' }))).toThrow(/self/i)
    })
    it('rejects a missing target', async () => {
      await env.service.start()
      expect(() => env.service.create(input({ targetAgentId: 'nobody' }))).toThrow(/target/i)
    })
    it('rejects cross-project delegation', async () => {
      await env.service.start()
      env.runtime.add('other', '/q')
      expect(() => env.service.create(input({ targetAgentId: 'other' }))).toThrow(/project/i)
    })
    it('rejects blank task and >32 KiB task', async () => {
      await env.service.start()
      expect(() => env.service.create(input({ task: '   ' }))).toThrow(/empty/i)
      expect(() => env.service.create(input({ task: 'x'.repeat(32 * 1024 + 1) }))).toThrow(/KiB/i)
    })
  })

  describe('limits', () => {
    it('caps nonterminal delegations per target at five', async () => {
      await env.service.start()
      env.runtime.busy.add('beta')
      for (let i = 0; i < 5; i++) env.service.create(input({ task: `t${i}` }))
      expect(() => env.service.create(input({ task: 'overflow' }))).toThrow(/5/)
    })
  })

  describe('scheduling', () => {
    it('runs immediately when the target is idle', async () => {
      await env.service.start()
      env.service.create(input())
      await env.service.flush()
      expect(env.runtime.turns.map(t => t.task)).toEqual(['do the thing'])
      expect(env.service.getStatus(env.runtime.turns[0].delegationId)?.status).toBe('completed')
      expect(env.runtime.results).toHaveLength(1)
    })

    it('runs multiple queued delegations FIFO in creation order', async () => {
      await env.service.start()
      // Deterministic FIFO: seed two queued records (via a busy target to get
      // them queued) but create them in-order, then drain.
      env.runtime.busy.add('beta')
      const a = env.service.create(input({ task: 'a' }))
      const b = env.service.create(input({ task: 'b' }))
      expect(env.service.getStatus(a.id)?.status).toBe('queued')
      expect(env.service.getStatus(b.id)?.status).toBe('queued')
      expect(env.runtime.turns).toHaveLength(0)
      // Drain: notify availability; pump runs a then b, in creation order.
      env.runtime.busy.delete('beta')
      env.service.notifyAgentAvailable('beta')
      await until(() => env.service.getStatus(a.id)?.status === 'completed' && env.service.getStatus(b.id)?.status === 'completed')
      expect(env.runtime.turns.map(t => t.delegationId)).toEqual([a.id, b.id])
      expect(env.runtime.turns.map(t => t.task)).toEqual(['a', 'b'])
    })
  })

  describe('prompt state', () => {
    it('transitions to waiting_for_input on prompt open and resumes on answer', async () => {
      // Seed a queued record with a known id so we can hold its run.
      env.store.create({
        id: 'd-prompt', projectPath: '/p', sourceAgentId: 'alpha', sourceSessionId: 'alpha-s',
        targetAgentId: 'beta', targetSessionId: 'beta-s', targetBusyAtCreation: false, task: 'prompt'
      })
      const gate = env.runtime.gate('d-prompt')
      await env.service.start() // pump picks up d-prompt and blocks on its gate
      await ticks()
      expect(env.service.getStatus('d-prompt')?.status).toBe('running')
      await env.service.notifyPromptState('d-prompt', true)
      expect(env.service.getStatus('d-prompt')?.status).toBe('waiting_for_input')
      gate.release()
      await env.service.flush()
      expect(env.service.getStatus('d-prompt')?.status).toBe('completed')
    })
  })

  describe('delivery', () => {
    it('persists terminal, appends result, marks delivered, then wakes', async () => {
      await env.service.start()
      const d = env.service.create(input())
      await env.service.flush()
      const rec = env.service.getStatus(d.id)
      expect(rec?.status).toBe('completed')
      expect(rec?.deliveredAt).toBeTypeOf('number')
      expect(env.runtime.results).toHaveLength(1)
      expect(env.runtime.wakes).toHaveLength(1)
    })

    it('truncates UTF-8 result above 64 KiB and flags resultTruncated', async () => {
      env.runtime.runResults.set('d-trunc', {
        runId: 'd-trunc', reason: 'completed', finalText: 'éx'.repeat(40 * 1024), touchedFiles: []
      })
      env.runtime.busy.add('beta')
      const service = env.service
      const store = env.store
      const created = store.create({
        id: 'd-trunc', projectPath: '/p', sourceAgentId: 'alpha', sourceSessionId: 'alpha-s',
        targetAgentId: 'beta', targetSessionId: 'beta-s', targetBusyAtCreation: true, task: 'trunc'
      })
      void created
      await service.start()
      env.runtime.busy.delete('beta')
      service.notifyAgentAvailable('beta')
      await service.flush()
      const rec = service.getStatus('d-trunc')
      expect(rec?.status).toBe('completed')
      expect(rec?.resultTruncated).toBe(true)
      expect((rec?.result?.length ?? 0)).toBeLessThan(65 * 1024)
    })
  })

  describe('recovery and lifecycle', () => {
    it('interrupts an in-flight run on restart without retrying, delivering once', async () => {
      const store = env.store
      store.create({
        id: 'd2', projectPath: '/p', sourceAgentId: 'alpha', sourceSessionId: 'alpha-s',
        targetAgentId: 'beta', targetSessionId: 'beta-s', targetBusyAtCreation: false, task: 'x'
      })
      store.transition('d2', 1, 'running', { startedAt: 1_000_000 })
      await env.service.start()
      expect(env.runtime.turns).toHaveLength(0) // never reruns the target task
      expect(env.service.getStatus('d2')?.status).toBe('interrupted')
      expect(env.runtime.results).toHaveLength(1)
      expect(env.runtime.results[0].status).toBe('interrupted')
      await env.service.start()
      expect(env.runtime.results).toHaveLength(1) // no duplicate delivery
    })

    it('resumes queued work on start', async () => {
      const store = env.store
      const created = store.create({
        id: 'q1', projectPath: '/p', sourceAgentId: 'alpha', sourceSessionId: 'alpha-s',
        targetAgentId: 'beta', targetSessionId: 'beta-s', targetBusyAtCreation: false, task: 'resume'
      })
      void created
      await env.service.start()
      await env.service.flush()
      expect(env.runtime.turns.map(t => t.delegationId)).toEqual(['q1'])
    })

    it('cancels queued only', async () => {
      await env.service.start()
      env.runtime.busy.add('beta')
      const d = env.service.create(input())
      const cancelled = await env.service.cancelQueued(d.id)
      expect(cancelled.status).toBe('cancelled')
      expect(env.runtime.turns).toHaveLength(0)
      await expect(env.service.cancelQueued('nope')).rejects.toThrow(/unknown/i)
    })

    it('fails queued work when the target agent is removed', async () => {
      await env.service.start()
      env.runtime.busy.add('beta')
      const d = env.service.create(input())
      await env.service.handleAgentRemoved('beta')
      expect(env.service.getStatus(d.id)?.status).toBe('failed')
    })

    it('suspends shutdown without scheduling further', async () => {
      await env.service.start()
      env.runtime.busy.add('beta')
      const d = env.service.create(input())
      env.service.suspend()
      env.runtime.busy.delete('beta')
      env.service.notifyAgentAvailable('beta')
      await env.service.flush()
      expect(env.runtime.turns).toHaveLength(0)
      expect(env.service.getStatus(d.id)?.status).toBe('queued')
    })
  })

  describe('claimSourceWake', () => {
    it('claims a wake once and rejects a second claim', async () => {
      await env.service.start()
      const d = env.service.create(input())
      await env.service.flush()
      expect(await env.service.claimSourceWake(d.id, 2_000_000)).toBe(true)
      expect(env.service.getStatus(d.id)?.wakeAt).toBe(2_000_000)
      expect(await env.service.claimSourceWake(d.id, 3_000_000)).toBe(false)
      expect(env.service.getStatus(d.id)?.wakeAt).toBe(2_000_000)
    })
  })

  describe('external delegations', () => {
    const ext = (over: Partial<{ projectPath: string; targetAgentId: string; task: string; planKey: string }> = {}) => ({
      projectPath: '/p', targetAgentId: 'beta', task: 'ext task', planKey: '/p/plan.md', ...over
    })

    it('creates a queued external record with the sentinel source', async () => {
      await env.service.start()
      env.runtime.gate('x')
      const rec = env.service.createExternal(ext())
      expect(rec.sourceKind).toBe('external')
      expect(rec.externalClient).toBe('claude')
      expect(rec.sourceAgentId).toBe('external:claude')
      expect(rec.sourceSessionId).toBe('external:claude')
      expect(rec.planKey).toBe('/p/plan.md')
    })

    it('runs without a resolvable source and passes the external display name', async () => {
      await env.service.start()
      const rec = env.service.createExternal(ext())
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect(env.runtime.turns[0].sourceName).toBe('Claude (external)')
      expect(env.runtime.turns[0].sourceAgentId).toBe('external:claude')
    })

    it('records the turn end reason on the terminal record', async () => {
      await env.service.start()
      env.runtime.busy.add('beta')
      const rec = env.service.createExternal(ext())
      env.runtime.runResults.set(rec.id, {
        runId: rec.id, reason: 'completed', endReason: 'max-steps', finalText: 'partial', touchedFiles: []
      })
      env.runtime.busy.delete('beta')
      env.service.notifyAgentAvailable('beta')
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect(env.service.getStatus(rec.id)?.endReason).toBe('max-steps')
      expect(env.service.getStatus(rec.id)?.result).toBe('partial')
    })

    it('leaves endReason unset for a normal finish', async () => {
      await env.service.start()
      const rec = env.service.createExternal(ext())
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect('endReason' in env.service.getStatus(rec.id)!).toBe(false)
    })

    it('never appends a result or wakes a source, but marks delivered', async () => {
      await env.service.start()
      const rec = env.service.createExternal(ext())
      expect(await until(() => env.service.getStatus(rec.id)?.deliveredAt !== undefined)).toBe(true)
      expect(env.runtime.results).toHaveLength(0)
      expect(env.runtime.wakes).toHaveLength(0)
    })

    it('rejects an unknown target, a cross-project target, an empty task and an oversized task', async () => {
      await env.service.start()
      expect(() => env.service.createExternal(ext({ targetAgentId: 'nope' }))).toThrow(/does not exist/)
      expect(() => env.service.createExternal(ext({ projectPath: '/other' }))).toThrow(/project/)
      expect(() => env.service.createExternal(ext({ task: '  ' }))).toThrow(/empty/)
      expect(() => env.service.createExternal(ext({ task: 'x'.repeat(32 * 1024 + 1) }))).toThrow(/KiB/)
    })

    it('enforces the per-target nonterminal cap', async () => {
      env.runtime.busy.add('beta')
      await env.service.start()
      for (let i = 0; i < 5; i++) env.service.createExternal(ext({ task: `t${i}` }))
      expect(() => env.service.createExternal(ext({ task: 't5' }))).toThrow(/max 5/)
    })
  })

  describe('cancel', () => {
    it('cancels a queued delegation', async () => {
      env.runtime.busy.add('beta')
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      const out = await env.service.cancel(rec.id)
      expect(out.status).toBe('cancelled')
    })

    it('stops a running delegation through the runtime', async () => {
      env.runtime.busy.add('beta')
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      env.runtime.gate(rec.id)
      env.runtime.busy.delete('beta')
      env.service.notifyAgentAvailable('beta')
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'running')).toBe(true)
      const out = await env.service.cancel(rec.id)
      expect(env.runtime.stopped).toEqual(['beta'])
      expect(out.status).toBe('cancelled')
    })

    it('returns a terminal record unchanged and throws for an unknown id', async () => {
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect((await env.service.cancel(rec.id)).status).toBe('completed')
      await expect(env.service.cancel('missing')).rejects.toThrow(/Unknown delegation/)
    })
  })

  describe('cli delegations', () => {
    describe('createCli validation and records', () => {
      it('rejects non-user-origin run', async () => {
        await env.service.start()
        expect(() => env.service.createCli(cliInput({ sourceRun: run({ origin: 'delegation' }) }))).toThrow(/user/i)
      })

      it('rejects unknown source session', async () => {
        await env.service.start()
        expect(() => env.service.createCli(cliInput({ sourceRun: run({ agentId: 'nonexistent' }) }))).toThrow(/source session does not exist/i)
      })

      it('rejects unknown CLI agent', async () => {
        await env.service.start()
        expect(() => env.service.createCli(cliInput({ targetCliAgentId: 'nonexistent' }))).toThrow(/cli agent does not exist/i)
      })

      it('rejects blank task and oversized task (>32 KiB)', async () => {
        await env.service.start()
        expect(() => env.service.createCli(cliInput({ task: '   ' }))).toThrow(/empty/i)
        expect(() => env.service.createCli(cliInput({ task: 'x'.repeat(32 * 1024 + 1) }))).toThrow(/KiB/i)
      })

      it('enforces 5 nonterminal delegations cap per CLI agent', async () => {
        await env.service.start()
        env.runtime.cliBusySessions.add('busy-s')
        env.runtime.addCliSession('busy-s', 'agy_personal', '/p')
        for (let i = 0; i < 5; i++) {
          env.service.createCli(cliInput({ task: `t${i}`, cliSessionId: 'busy-s' }))
        }
        expect(() => env.service.createCli(cliInput({ task: 'overflow', cliSessionId: 'busy-s' }))).toThrow(/Too many queued delegations/i)
      })

      it('creates record with targetKind cli and correct fields', async () => {
        await env.service.start()
        env.runtime.addCliSession('s1', 'agy_personal', '/p')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's1' }))
        expect(rec.sourceKind).toBe('session')
        expect(rec.targetKind).toBe('cli')
        expect(rec.targetCliAgentId).toBe('agy_personal')
        expect(rec.targetCliSessionId).toBe('s1')
        expect(rec.targetAgentId).toBe('agy_personal')
        expect(rec.targetSessionId).toBe('s1')
        expect(rec.targetBusyAtCreation).toBe(false)
        expect(rec.status).toBe('queued')
      })
    })

    describe('session resolution and project mismatch', () => {
      it('reuses cliSessionId when specified', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-existing', 'agy_personal', '/p')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-existing' }))
        expect(rec.targetCliSessionId).toBe('s-existing')
      })

      it('creates or reuses a session when cliSessionId is omitted', async () => {
        await env.service.start()
        const rec = env.service.createCli(cliInput())
        expect(rec.targetCliSessionId).toBeDefined()
        expect(env.runtime.cliSessions.has(rec.targetCliSessionId!)).toBe(true)

        // Second creation reuses existing session
        const rec2 = env.service.createCli(cliInput({ task: 'second task' }))
        expect(rec2.targetCliSessionId).toBe(rec.targetCliSessionId)
      })

      it('prefers session with delegatedBy if multiple exist', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-regular', 'agy_personal', '/p', 'Regular', false)
        env.runtime.addCliSession('s-delegated', 'agy_personal', '/p', 'Delegated', true)
        const rec = env.service.createCli(cliInput())
        expect(rec.targetCliSessionId).toBe('s-delegated')
      })

      it('throws when specified cliSessionId belongs to a different project', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-other-project', 'agy_personal', '/other')
        expect(() => env.service.createCli(cliInput({ cliSessionId: 's-other-project' }))).toThrow(/different project/i)
      })
    })

    describe('queued execution and result delivery', () => {
      it('runs queued CLI task and delivers result to source Meow session', async () => {
        await env.service.start()
        env.runtime.addCliSession('s1', 'agy_personal', '/p')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's1', task: 'refactor code' }))
        await env.service.flush()

        expect(env.runtime.cliTasks).toHaveLength(1)
        expect(env.runtime.cliTasks[0]).toEqual({
          delegationId: rec.id,
          sourceAgentId: 'alpha',
          sourceName: 'Agent alpha',
          targetCliAgentId: 'agy_personal',
          cliSessionId: 's1',
          task: 'refactor code'
        })

        const terminal = env.service.getStatus(rec.id)
        expect(terminal?.status).toBe('completed')
        expect(terminal?.result).toBe('cli-done-refactor code')
        expect(terminal?.deliveredAt).toBeTypeOf('number')

        // Appends result to source session with target CLI agent name and ID
        expect(env.runtime.results).toHaveLength(1)
        expect(env.runtime.results[0]).toEqual({
          delegationId: rec.id,
          sourceAgentId: 'alpha',
          sourceSessionId: 'alpha-s',
          targetAgentId: 'agy_personal',
          targetName: 'Antigravity · Personal',
          status: 'completed',
          result: 'cli-done-refactor code',
          touchedFiles: [],
          targetKind: 'cli',
          cliSessionId: 's1'
        })

        // Wakes the source session
        expect(env.runtime.wakes).toHaveLength(1)
        expect(env.runtime.wakes[0].delegationId).toBe(rec.id)
      })

      it('FIFO executes queued CLI delegations', async () => {
        await env.service.start()
        env.runtime.addCliSession('s1', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s1')

        const d1 = env.service.createCli(cliInput({ cliSessionId: 's1', task: 'first' }))
        const d2 = env.service.createCli(cliInput({ cliSessionId: 's1', task: 'second' }))
        expect(env.service.getStatus(d1.id)?.status).toBe('queued')
        expect(env.service.getStatus(d2.id)?.status).toBe('queued')
        expect(env.runtime.cliTasks).toHaveLength(0)

        // Mark available and pump
        env.runtime.cliBusySessions.delete('s1')
        env.service.notifyAgentAvailable('agy_personal')

        await until(() => env.service.getStatus(d1.id)?.status === 'completed' && env.service.getStatus(d2.id)?.status === 'completed')
        expect(env.runtime.cliTasks.map(t => t.task)).toEqual(['first', 'second'])
      })
    })

    describe('busy waiting', () => {
      it('records targetBusyAtCreation true when CLI session is busy', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-busy', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s-busy')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-busy' }))
        expect(rec.targetBusyAtCreation).toBe(true)
      })

      it('waits when CLI session is busy and runs when notified', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-busy', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s-busy')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-busy' }))
        await ticks()
        expect(env.service.getStatus(rec.id)?.status).toBe('queued')
        expect(env.runtime.cliTasks).toHaveLength(0)

        env.runtime.cliBusySessions.delete('s-busy')
        env.service.notifyAgentAvailable('agy_personal')
        await until(() => env.service.getStatus(rec.id)?.status === 'completed')
        expect(env.runtime.cliTasks).toHaveLength(1)
      })
    })

    describe('cancel', () => {
      it('cancels a queued CLI delegation', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-busy', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s-busy')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-busy' }))
        const cancelled = await env.service.cancel(rec.id)
        expect(cancelled.status).toBe('cancelled')
        expect(env.runtime.cliTasks).toHaveLength(0)
      })

      it('cancels a running CLI delegation by calling stopCliTask', async () => {
        await env.service.start()
        env.runtime.addCliSession('s1', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s1')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's1' }))
        env.runtime.gate(rec.id)
        env.runtime.cliBusySessions.delete('s1')
        env.service.notifyAgentAvailable('agy_personal')
        expect(await until(() => env.service.getStatus(rec.id)?.status === 'running')).toBe(true)

        const cancelled = await env.service.cancel(rec.id)
        expect(env.runtime.cliStopped).toContain('s1')
        expect(cancelled.status).toBe('cancelled')
      })
    })

    describe('recovery and participant removal', () => {
      it('interrupts an in-flight CLI run on restart and delivers to source', async () => {
        env.store.create({
          id: 'cli-inflight',
          projectPath: '/p',
          sourceAgentId: 'alpha',
          sourceSessionId: 'alpha-s',
          targetAgentId: 'agy_personal',
          targetSessionId: 's1',
          targetBusyAtCreation: false,
          task: 'inflight task',
          sourceKind: 'session',
          targetKind: 'cli',
          targetCliAgentId: 'agy_personal',
          targetCliSessionId: 's1'
        })
        env.store.transition('cli-inflight', 1, 'running', { startedAt: 1_000_000 })

        await env.service.start()
        expect(env.runtime.cliTasks).toHaveLength(0)
        expect(env.service.getStatus('cli-inflight')?.status).toBe('interrupted')
        expect(env.runtime.results).toHaveLength(1)
        expect(env.runtime.results[0].targetAgentId).toBe('agy_personal')
        expect(env.runtime.results[0].status).toBe('interrupted')
        expect(env.runtime.wakes).toHaveLength(1)
      })

      it('resumes queued CLI work on start', async () => {
        env.runtime.addCliSession('s1', 'agy_personal', '/p')
        env.store.create({
          id: 'cli-q1',
          projectPath: '/p',
          sourceAgentId: 'alpha',
          sourceSessionId: 'alpha-s',
          targetAgentId: 'agy_personal',
          targetSessionId: 's1',
          targetBusyAtCreation: false,
          task: 'resumed cli task',
          sourceKind: 'session',
          targetKind: 'cli',
          targetCliAgentId: 'agy_personal',
          targetCliSessionId: 's1'
        })

        await env.service.start()
        await env.service.flush()
        expect(env.runtime.cliTasks.map(t => t.delegationId)).toEqual(['cli-q1'])
        expect(env.service.getStatus('cli-q1')?.status).toBe('completed')
      })

      it('fails queued CLI delegation if source session is removed before run', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-busy', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s-busy')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-busy' }))

        // Remove source session
        env.runtime.agents.delete('alpha')
        env.runtime.cliBusySessions.delete('s-busy')
        env.service.notifyAgentAvailable('agy_personal')
        await until(() => env.service.getStatus(rec.id)?.status === 'failed')
        expect(env.service.getStatus(rec.id)?.error).toMatch(/participant session is no longer available/)
      })

      it('fails queued CLI delegations when handleCliAgentRemoved is called', async () => {
        await env.service.start()
        env.runtime.addCliSession('s-busy', 'agy_personal', '/p')
        env.runtime.cliBusySessions.add('s-busy')
        const rec = env.service.createCli(cliInput({ cliSessionId: 's-busy' }))
        await env.service.handleCliAgentRemoved('agy_personal')
        expect(env.service.getStatus(rec.id)?.status).toBe('failed')
        expect(env.service.getStatus(rec.id)?.error).toMatch(/CLI agent was removed/)
      })
    })
  })
})
