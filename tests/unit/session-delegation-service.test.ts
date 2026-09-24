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
  CreateDelegationInput
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
      await env.service.cancel(rec.id)
      expect(env.runtime.stopped).toEqual(['beta'])
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'cancelled')).toBe(true)
    })

    it('returns a terminal record unchanged and throws for an unknown id', async () => {
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect((await env.service.cancel(rec.id)).status).toBe('completed')
      await expect(env.service.cancel('missing')).rejects.toThrow(/Unknown delegation/)
    })
  })
})
