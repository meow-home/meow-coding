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
})
