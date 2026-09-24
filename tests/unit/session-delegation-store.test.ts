import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SessionDelegationStore } from '../../src/main/session-delegation-store'
import { SessionStore } from '../../src/main/agent/session'
import { SessionFileStore } from '../../src/main/agent/session-file-store'

const DAY = 86_400_000

describe('SessionDelegationStore', () => {
  let dir: string
  let file: string

  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-deleg-'))
    file = path.join(dir, 'delegations.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const make = (now?: () => number) => new SessionDelegationStore(createJsonStore(file), now)
  const seed = (store: SessionDelegationStore, id: string, overrides: Partial<{ projectPath: string; source: string; target: string }> = {}) => store.create({
    id,
    projectPath: overrides.projectPath ?? '/proj',
    sourceAgentId: overrides.source ?? 'src',
    sourceSessionId: `${overrides.source ?? 'src'}-s`,
    targetAgentId: overrides.target ?? 'tgt',
    targetSessionId: `${overrides.target ?? 'tgt'}-t`,
    targetBusyAtCreation: false,
    task: id
  })

  it('creates a queued delegation at revision 1 (project path normalized)', () => {
    const store = make()
    const d = seed(store, 'd1')
    expect(d.status).toBe('queued')
    expect(d.revision).toBe(1)
    expect(d.projectPath).toBe('/proj')
    expect(store.get('d1')?.task).toBe('d1')
  })

  it('reloads persisted records from disk', () => {
    seed(make(), 'd2')
    const d = make().get('d2')
    expect(d?.status).toBe('queued')
    expect(d?.task).toBe('d2')
  })

  it('enforces allowed transitions and ignores disallowed ones', () => {
    const store = make()
    seed(store, 'd3')
    expect(store.transition('d3', 1, 'running')?.status).toBe('running')
    expect(store.transition('d3', 2, 'completed')?.status).toBe('completed')
    // Terminal is immutable — transition to running must not happen now.
    expect(store.transition('d3', 3, 'running')).toBeUndefined()
    expect(store.get('d3')?.status).toBe('completed')
    // Direct queued -> completed is not in the table either.
    seed(store, 'd3b')
    expect(store.transition('d3b', 1, 'completed')).toBeUndefined()
  })

  it('rejects transitions on a stale revision', () => {
    const store = make()
    seed(store, 'd4')
    expect(store.transition('d4', 1, 'running')).toBeDefined()
    expect(store.transition('d4', 1, 'failed')).toBeUndefined()
  })

  it('filters lists by source, target, and project', () => {
    const store = make()
    seed(store, 'a', { source: 'alpha', target: 'beta' })
    seed(store, 'b', { source: 'alpha', target: 'gamma' })
    seed(store, 'c', { source: 'zeta', target: 'beta', projectPath: '/q' })
    expect(store.list({ sourceAgentId: 'alpha' }).map(x => x.id).sort()).toEqual(['a', 'b'])
    expect(store.list({ targetAgentId: 'beta' }).map(x => x.id).sort()).toEqual(['a', 'c'])
    expect(store.list({ projectPath: '/proj' }).map(x => x.id).sort()).toEqual(['a', 'b'])
    expect(store.list({ sourceAgentId: 'alpha', targetAgentId: 'beta' }).map(x => x.id)).toEqual(['a'])
  })

  it('recovers in-flight (running / waiting_for_input) records as interruptible', async () => {
    const store = make()
    seed(store, 'i1')
    store.transition('i1', 1, 'running')
    seed(store, 'i2')
    store.transition('i2', 1, 'running')
    store.transition('i2', 2, 'waiting_for_input')
    const recovered = await store.recoverInterrupted()
    expect(recovered.map(x => x.id).sort()).toEqual(['i1', 'i2'])
  })

  it('markDelivered and markWoken are revision-checked and idempotent', () => {
    const store = make()
    seed(store, 'd5')
    store.transition('d5', 1, 'running')
    store.transition('d5', 2, 'completed', { result: 'done' })
    const after = store.markDelivered('d5', 3, 1000)
    expect(after?.deliveredAt).toBe(1000)
    expect(after?.revision).toBe(4)
    // stale revision -> no-op
    expect(store.markDelivered('d5', 3, 2000)).toBeUndefined()
    expect(store.get('d5')?.deliveredAt).toBe(1000)
    const woken = store.markWoken('d5', 4, 3000)
    expect(woken?.wakeAt).toBe(3000)
  })

  it('returns clones so callers cannot mutate state outside a transition', () => {
    const store = make()
    const d = seed(store, 'd6')
    expect(store.get('d6')).not.toBe(d)
    expect(store.list()[0]).not.toBe(d)
  })

  it('purging removes terminal records older than the cutoff (30 days)', async () => {
    const now = () => 3_100_000_000
    const store = make(now)
    seed(store, 'old1')
    store.transition('old1', 1, 'running', { startedAt: 1_000_000 })
    store.transition('old1', 2, 'completed', { finishedAt: 1_000_000, result: 'old' })
    seed(store, 'fresh1')
    store.transition('fresh1', 1, 'running', { startedAt: 3_000_000_000 })
    store.transition('fresh1', 2, 'completed', { finishedAt: 3_000_000_000, result: 'fresh' })
    const cutoff = 2_000_000_000
    await store.purgeTerminalBefore(cutoff)
    expect(store.get('old1')).toBeUndefined()
    expect(store.get('fresh1')).toBeDefined()
  })

  it('persists external source fields and round-trips them through load()', async () => {
    const store = make()
    const created = store.create({
      id: 'x1',
      projectPath: 'E:\\Repo',
      sourceAgentId: 'external:claude',
      sourceSessionId: 'external:claude',
      targetAgentId: 'beta',
      targetSessionId: 'beta-s',
      targetBusyAtCreation: false,
      task: 't',
      sourceKind: 'external',
      externalClient: 'claude',
      planKey: 'e:/repo/docs/plan.md'
    })
    expect(created.sourceKind).toBe('external')
    expect(created.externalClient).toBe('claude')
    expect(created.planKey).toBe('e:/repo/docs/plan.md')
    await store.load()
    expect(store.get('x1')?.planKey).toBe('e:/repo/docs/plan.md')
  })

  it('omits external fields for ordinary session delegations', () => {
    const store = make()
    const created = store.create({
      id: 's1', projectPath: '/p', sourceAgentId: 'a', sourceSessionId: 'a-s',
      targetAgentId: 'b', targetSessionId: 'b-s', targetBusyAtCreation: false, task: 't'
    })
    expect('sourceKind' in created).toBe(false)
    expect('planKey' in created).toBe(false)
  })
})

describe('SessionStore idempotency helpers', () => {
  let dir: string
  let file: string

  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-deleg-sess-'))
    file = path.join(dir, 'sessions.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('hasMessage reports whether a message id exists', () => {
    const store = new SessionStore(new SessionFileStore(dir))
    const s = store.create('alpha', '/proj')
    expect(store.hasMessage(s.id, 'm1')).toBe(false)
    store.appendMessage(s.id, { id: 'm1', role: 'user', text: 'hi', createdAt: 1 })
    expect(store.hasMessage(s.id, 'm1')).toBe(true)
    expect(store.hasMessage(s.id, 'm2')).toBe(false)
  })

  it('appendMessageIfMissing writes once and returns false on duplicates', async () => {
    const store = new SessionStore(new SessionFileStore(dir))
    const s = store.create('alpha', '/proj')
    const msg = { id: 'dup', role: 'assistant', text: 'result', createdAt: 1 }
    expect(await store.appendMessageIfMissing(s.id, msg)).toBe(true)
    expect(store.transcript(s.id)).toHaveLength(1)
    expect(await store.appendMessageIfMissing(s.id, { ...msg, text: 'different' })).toBe(false)
    expect(store.transcript(s.id)).toHaveLength(1)
  })
})
