import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'
import {
  MonitorStore, handleMonitorResolve, monitorResolveMessage, type MonitorResolveInfo
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
    expect('error' in m2.start('a1', bg.id, { untilExit: true })).toBe(true)
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
