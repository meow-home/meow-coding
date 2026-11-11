import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'
import {
  MonitorStore, delegationWakeInstruction, handleMonitorResolve, monitorResolveMessage, type MonitorResolveInfo
} from '../../src/main/agent/monitor-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-mon-'))

function makeStores(): { procs: BackgroundProcessStore; monitors: MonitorStore; resolved: MonitorResolveInfo[] } {
  const procs = new BackgroundProcessStore({ getSessionId: () => 'sess-1', onExit: () => {} })
  const resolved: MonitorResolveInfo[] = []
  const monitors = new MonitorStore({
    procs,
    getSessionId: () => 'sess-1',
    onResolve: (i) => resolved.push(i)
  })
  return { procs, monitors, resolved }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise(r => setTimeout(r, 30))
  }
}

describe('MonitorStore', () => {
  it('resolves matched when a new output line hits the regex', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 0.3; echo READY_NOW', dir) as { id: string }
    const m = monitors.start('a1', bg.id, { untilRegex: 'READY_NOW' })
    expect('id' in m).toBe(true)
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('matched')
    expect(resolved[0].detail).toContain('READY_NOW')
    procs.killAllForAgent('a1')
  }, 20000)

  it('resolves exited when the target exits', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 0.3; exit 4', dir) as { id: string }
    monitors.start('a1', bg.id, { untilExit: true })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('exited')
    expect(resolved[0].detail).toContain('4')
  }, 20000)

  it('resolves exited when the target exits before the regex matches', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 0.3; exit 0', dir) as { id: string }
    monitors.start('a1', bg.id, { untilRegex: 'NEVER_MATCH' })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('exited')
    procs.killAllForAgent('a1')
  }, 20000)

  it('resolves timeout when nothing matches in time', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    monitors.start('a1', bg.id, { untilRegex: 'NOPE', timeoutMs: 300 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('timeout')
    procs.killAllForAgent('a1')
  }, 20000)

  it('allows a foreground waiter to consume a matched resolution once', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 0.2; echo WAIT_READY', dir) as { id: string }
    const started = monitors.start('a1', bg.id, { untilRegex: 'WAIT_READY' })
    if (!('id' in started)) throw new Error('monitor did not start')
    const waited = await monitors.wait(started.id, undefined, 2000)
    expect(waited.status).toBe('resolved')
    expect(waited.info?.reason).toBe('matched')
    expect(resolved).toHaveLength(1)
    expect(monitors.wasWaitConsumed(started.id)).toBe(true)
    procs.killAllForAgent('a1')
  }, 20000)

  it('does not let an expired foreground waiter consume a later background resolution', async () => {
    const { procs, monitors, resolved } = makeStores()
    const bg = procs.start('a1', 'sleep 0.2; echo LATE_READY; sleep 1', dir) as { id: string }
    const started = monitors.start('a1', bg.id, { untilRegex: 'LATE_READY' })
    if (!('id' in started)) throw new Error('monitor did not start')

    const waited = await monitors.wait(started.id, undefined, 10)
    expect(waited.status).toBe('pending')
    await waitFor(() => resolved.length === 1)

    expect(monitors.wasWaitConsumed(started.id)).toBe(false)
    procs.killAllForAgent('a1')
  }, 20000)

  it('errors on unknown target, missing condition, and bad regex', () => {
    const { procs, monitors } = makeStores()
    expect('error' in monitors.start('a1', 'nope', { untilExit: true })).toBe(true)
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    expect('error' in monitors.start('a1', bg.id, {})).toBe(true)
    expect('error' in monitors.start('a1', bg.id, { untilRegex: '(' })).toBe(true)
    procs.killAllForAgent('a1')
  })

  it('enforces the per-agent monitor limit', () => {
    const { procs, monitors } = makeStores()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    const opts = { maxPerAgent: 2 }
    const m2 = new MonitorStore({ procs, getSessionId: () => 's', onResolve: () => {}, ...opts })
    m2.start('a1', bg.id, { untilExit: true })
    m2.start('a1', bg.id, { untilExit: true })
    expect(m2.start('a1', bg.id, { untilExit: true })).toMatchObject({ reused: true })
    procs.killAllForAgent('a1')
  })

  it('snapshot() keeps resolved watches in history while list() stays active-only', async () => {
    const { monitors } = makeStores()
    const changes: string[] = []
    const store = new MonitorStore({
      procs: new BackgroundProcessStore({ getSessionId: () => 'sess-1', onExit: () => {} }),
      getSessionId: () => 'sess-1',
      onResolve: () => {},
      onChange: agentId => changes.push(agentId)
    })
    store.registerExternal({ agentId: 'a1', targetId: 'del-9', until: 'delegation finishes', id: 'del-9', label: 'review the diff' })
    const watching = store.snapshot('a1')
    expect(watching).toHaveLength(1)
    expect(watching[0]).toMatchObject({ id: 'del-9', kind: 'delegation', label: 'review the diff', status: 'watching' })
    expect(typeof watching[0].startedAt).toBe('number')

    store.resolveExternal('a1', 'del-9', 'succeeded', 'completed')
    expect(store.list('a1')).toHaveLength(0)
    const after = store.snapshot('a1')
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: 'del-9', status: 'resolved', reason: 'succeeded', detail: 'completed' })
    expect(typeof after[0].resolvedAt).toBe('number')

    // Dismissing the resolved watch empties the card.
    expect(store.cancel('del-9')).toBe(true)
    expect(store.snapshot('a1')).toHaveLength(0)
    expect(changes).toContain('a1')
    expect(monitors.count('a1')).toBe(0)
  })

  it('cancel() stops a watching monitor and reports no-op for unknown ids', async () => {
    const { procs } = makeStores()
    const store = new MonitorStore({
      procs,
      getSessionId: () => 'sess-1',
      onResolve: () => {}
    })
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    const started = store.start('a1', bg.id, { untilRegex: 'NEVER', timeoutMs: 30000 })
    if (!('id' in started)) throw new Error('monitor did not start')
    expect(store.snapshot('a1')).toHaveLength(1)
    expect(store.cancel(started.id)).toBe(true)
    expect(store.snapshot('a1')).toHaveLength(0)
    expect(store.cancel(started.id)).toBe(false)
    // The process itself is untouched: cancelling a watch is not a kill.
    expect(procs.inspect(bg.id)?.status).toBe('running')
    procs.killAllForAgent('a1')
  })

  it('list(agentId) returns active monitors with a readable until', () => {
    const { procs, monitors } = makeStores()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    monitors.start('a1', bg.id, { untilRegex: 'READY', timeoutMs: 30000 })
    const list = monitors.list('a1')
    expect(list.length).toBe(1)
    expect(list[0].targetId).toBe(bg.id)
    expect(list[0].until).toContain('READY')
    procs.killAllForAgent('a1')
  })
})

describe('handleMonitorResolve', () => {
  const info: MonitorResolveInfo = { id: 'm1', agentId: 'a1', sessionId: 's9', targetId: 'bg1', reason: 'matched', detail: 'Local: http://x', kind: 'shell' }

  it('builds a message naming the monitor and target', () => {
    const msg = monitorResolveMessage(info)
    expect(msg).toContain('m1')
    expect(msg).toContain('bg1')
    expect(msg).toContain('bash_output')
  })

  it('appends, notifies, and wakes only when idle', () => {
    const appendMessage = vi.fn()
    const notify = vi.fn()
    handleMonitorResolve(info, { appendMessage, notify, isRunning: () => false, wake: vi.fn() })
    expect(appendMessage).toHaveBeenCalledWith('s9', expect.stringContaining('m1'))
    expect(notify).toHaveBeenCalledWith(info)

    const wakeBusy = vi.fn()
    handleMonitorResolve(info, { appendMessage: vi.fn(), isRunning: () => true, wake: wakeBusy })
    expect(wakeBusy).not.toHaveBeenCalled()
  })

  it('poll-kind message omits the bash_output hint; shell-kind keeps it', () => {
    const shellMsg = monitorResolveMessage({ ...info, kind: 'shell' })
    expect(shellMsg).toContain('bash_output')
    const pollMsg = monitorResolveMessage({
      id: 'm2', agentId: 'a1', sessionId: 's9', targetId: 'curl -sf localhost:3000',
      reason: 'succeeded', detail: 'exit code 0', kind: 'poll'
    })
    expect(pollMsg).toContain('curl -sf localhost:3000')
    expect(pollMsg).toContain('succeeded')
    expect(pollMsg).not.toContain('bash_output')
  })
})

describe('MonitorStore delegation monitors', () => {
  it('registers an external monitor under the delegation id and resolves it once', async () => {
    const { monitors, resolved } = makeStores()
    const reg = monitors.registerExternal({ agentId: 'a1', targetId: 'del-1', until: 'delegation finishes', id: 'del-1' })
    expect('id' in reg && reg.id).toBe('del-1')
    expect(monitors.list('a1').map(m => m.id)).toContain('del-1')
    // Re-registering the same delegation reuses the entry.
    const again = monitors.registerExternal({ agentId: 'a1', targetId: 'del-1', until: 'delegation finishes', id: 'del-1' })
    expect('reused' in again && again.reused).toBe(true)
    expect(monitors.count('a1')).toBe(1)

    expect(monitors.resolveExternal('a1', 'del-1', 'succeeded', 'completed')).toBe(true)
    expect(monitors.resolveExternal('a1', 'del-1', 'succeeded', 'completed')).toBe(false)
    // Without a waiter the resolve is published on a microtask.
    await new Promise(r => setTimeout(r, 0))
    expect(resolved).toHaveLength(1)
    expect(resolved[0].kind).toBe('delegation')
    expect(resolved[0].targetId).toBe('del-1')
    expect(monitors.list('a1')).toHaveLength(0)
  })

  it('lets wait consume the delegation resolution so no wake is needed', async () => {
    const { monitors, resolved } = makeStores()
    monitors.registerExternal({ agentId: 'a1', targetId: 'del-2', until: 'delegation finishes', id: 'del-2' })
    const waiting = monitors.wait('del-2', undefined, 5_000)
    monitors.resolveExternal('a1', 'del-2', 'succeeded', 'completed')
    const result = await waiting
    expect(result.status).toBe('resolved')
    expect(result.info?.kind).toBe('delegation')
    // A foreground wait consumed the resolution: no synthetic wake is due.
    expect(monitors.wasWaitConsumed('del-2')).toBe(true)
    expect(resolved).toHaveLength(1)
  })

  it('returns pending immediately when the monitor is still watching', async () => {
    const { monitors } = makeStores()
    monitors.registerExternal({ agentId: 'a1', targetId: 'del-3', until: 'delegation finishes', id: 'del-3' })
    const result = await monitors.wait('del-3', undefined, 0)
    expect(result.status).toBe('pending')
    expect(monitors.wasWaitConsumed('del-3')).toBe(false)
  })

  it('keeps the delegation id in the message and wake text, never the result body', () => {
    const delegationInfo: MonitorResolveInfo = {
      id: 'del-4', agentId: 'a1', sessionId: 's1', targetId: 'del-4',
      reason: 'succeeded', detail: 'completed', kind: 'delegation'
    }
    expect(monitorResolveMessage(delegationInfo)).toContain('delegate_result({ id: "del-4" })')
    expect(monitorResolveMessage(delegationInfo)).not.toContain('bash_output')
    const wake = delegationWakeInstruction('del-4', 'completed')
    expect(wake).toContain('delegate_result({ id: "del-4" })')
    expect(wake).toContain('completed')
  })
})
