import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { monitorTool } from '../../src/main/agent/tools/monitor'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'
import { MonitorStore } from '../../src/main/agent/monitor-store'
import type { ToolContext } from '../../src/main/agent/tools/types'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-montool-'))

function ctx(): { ctx: ToolContext; procs: BackgroundProcessStore } {
  const procs = new BackgroundProcessStore({ getSessionId: () => 'sess-1', onExit: () => {} })
  const monitors = new MonitorStore({ procs, getSessionId: () => 'sess-1', onResolve: () => {} })
  return { ctx: { cwd: dir, ask: async () => null, agentId: 'a1', monitors }, procs }
}

describe('monitor tool', () => {
  it('returns immediately with background flag and a monitor id', async () => {
    const { ctx: c, procs } = ctx()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    const r = await monitorTool.run({ id: bg.id, until_exit: true }, c)
    expect(r.background).toBe(true)
    expect(r.output).toMatch(/monitor [0-9a-f]{8}/)
    procs.killAllForAgent('a1')
  }, 20000)

  it('errors on missing condition and unknown target', async () => {
    const { ctx: c, procs } = ctx()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    const noCond = await monitorTool.run({ id: bg.id }, c)
    expect(noCond.error).toMatch(/at least one/)
    const unknown = await monitorTool.run({ id: 'nope', until_exit: true }, c)
    expect(unknown.error).toMatch(/unknown background shell/)
    procs.killAllForAgent('a1')
  })

  it('command mode returns immediately with a monitor id', async () => {
    const { PollMonitorStore } = await import('../../src/main/agent/poll-monitor-store')
    const pollMonitors = new PollMonitorStore({ getSessionId: () => 'sess-1', onResolve: () => {} })
    const c = { cwd: dir, ask: async () => null, agentId: 'a1', pollMonitors } as unknown as import('../../src/main/agent/tools/types').ToolContext
    const r = await monitorTool.run({ command: 'exit 1', until_regex: 'never', timeout_s: 1 }, c)
    expect(r.background).toBe(true)
    expect(r.output).toMatch(/monitor [0-9a-f]{8}/)
    pollMonitors.cancelAllForAgent('a1')
  }, 20000)

  it('errors when neither id nor command (and when both) are given', async () => {
    const { ctx: c } = ctx()
    const none = await monitorTool.run({}, c)
    expect(none.error).toMatch(/exactly one/)
    const both = await monitorTool.run({ id: 'x', command: 'y' }, c)
    expect(both.error).toMatch(/exactly one/)
  })
})
