import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bashTool, bashOutputTool, killShellTool } from '../../src/main/agent/tools/bash'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'
import type { ToolContext } from '../../src/main/agent/tools/types'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bgtool-'))

function ctxWithStore(): { ctx: ToolContext; store: BackgroundProcessStore } {
  const store = new BackgroundProcessStore({ getSessionId: () => 'sess-1', onExit: () => {} })
  const ctx: ToolContext = { cwd: dir, ask: async () => null, agentId: 'a1', backgroundProcs: store }
  return { ctx, store }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('background bash tools', () => {
  it('run_in_background returns immediately with an id and background flag', async () => {
    const { ctx } = ctxWithStore()
    const r = await bashTool.run({ command: 'echo BGT_OK', run_in_background: true }, ctx)
    expect(r.background).toBe(true)
    expect(r.output).toMatch(/id=[0-9a-f]{8}/)
  }, 20000)

  it('bash_output returns the captured output', async () => {
    const { ctx } = ctxWithStore()
    const started = await bashTool.run({ command: 'echo BGT_OUT', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    // Poll bash_output, accumulating output, until the marker appears.
    let seen = ''
    const start = Date.now()
    while (!seen.includes('BGT_OUT')) {
      if (Date.now() - start > 8000) throw new Error('no output from background shell')
      const out = await bashOutputTool.run({ id }, ctx)
      seen += out.output ?? ''
      if (!seen.includes('BGT_OUT')) await new Promise(r => setTimeout(r, 100))
    }
    expect(seen).toContain('BGT_OUT')
  }, 20000)

  it('bash_output and kill_shell error on unknown id', async () => {
    const { ctx } = ctxWithStore()
    const out = await bashOutputTool.run({ id: 'deadbeef' }, ctx)
    expect(out.error).toMatch(/unknown id/)
    const k = await killShellTool.run({ id: 'deadbeef' }, ctx)
    expect(k.error).toMatch(/unknown id/)
  })

  it('foreground bash still works without a store', async () => {
    const ctx: ToolContext = { cwd: dir, ask: async () => null }
    const r = await bashTool.run({ command: 'echo FG_OK' }, ctx)
    expect(r.output).toContain('FG_OK')
  }, 20000)

  it('bash_output waits for output instead of returning empty', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 1 && echo WAITED_OUT && sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const out = await bashOutputTool.run({ id, wait_s: 10 }, ctx)
    expect(out.output).toContain('WAITED_OUT')
    store.kill(id)
  }, 30000)

  it('bash_output with wait_s 0 returns immediately', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const t0 = Date.now()
    const out = await bashOutputTool.run({ id, wait_s: 0 }, ctx)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.output).toContain('(no new output)')
    store.kill(id)
  }, 20000)

  it('bash_output stops waiting on abort', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const t0 = Date.now()
    await bashOutputTool.run({ id, wait_s: 60 }, { ...ctx, signal: controller.signal })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(store.listenerCount('data')).toBe(0)
    store.kill(id)
  }, 20000)

  it('bash_output with a filter keeps waiting for a matching line', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'echo noise && sleep 1 && echo READY_LINE && sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const out = await bashOutputTool.run({ id, filter: 'READY', wait_s: 10 }, ctx)
    expect(out.output).toContain('READY_LINE')
    store.kill(id)
  }, 30000)
})
