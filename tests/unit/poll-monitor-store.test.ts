import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PollMonitorStore } from '../../src/main/agent/poll-monitor-store'
import type { MonitorResolveInfo } from '../../src/main/agent/monitor-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-poll-'))

function makeStore(maxPerAgent?: number) {
  const resolved: MonitorResolveInfo[] = []
  const store = new PollMonitorStore({ getSessionId: () => 's', onResolve: (i) => resolved.push(i), maxPerAgent })
  return { store, resolved }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 40)) }
}

describe('PollMonitorStore', () => {
  it('resolves succeeded when the command exits 0 (default condition)', async () => {
    const { store, resolved } = makeStore()
    const r = store.start('a1', 'exit 0', dir, { intervalMs: 1000 })
    expect('id' in r).toBe(true)
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('succeeded')
    expect(resolved[0].kind).toBe('poll')
    expect(resolved[0].targetId).toBe('exit 0')
  }, 20000)

  it('resolves succeeded only on a specific exit code', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'exit 7', dir, { untilExit: 7, intervalMs: 1000 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('succeeded')
    expect(resolved[0].detail).toContain('7')
  }, 20000)

  it('resolves matched when output matches the regex', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'echo READY_TO_GO; exit 1', dir, { untilRegex: 'READY_TO_GO', intervalMs: 1000 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('matched')
    expect(resolved[0].detail).toContain('READY_TO_GO')
  }, 20000)

  it('resolves timeout when nothing satisfies in time', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'exit 1', dir, { untilExit: 0, intervalMs: 1000, timeoutMs: 400 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('timeout')
  }, 20000)

  it('errors on invalid regex and enforces the per-agent limit', () => {
    const { store } = makeStore(2)
    expect('error' in store.start('a1', 'exit 1', dir, { untilRegex: '(' })).toBe(true)
    store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })
    store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })
    expect('error' in store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })).toBe(true)
    store.cancelAllForAgent('a1')
  })
})
