import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore, type BgExitInfo } from '../../src/main/agent/background-process-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bg-'))

function makeStore(over: Partial<ConstructorParameters<typeof BackgroundProcessStore>[0]> = {}) {
  const exits: BgExitInfo[] = []
  const store = new BackgroundProcessStore({
    getSessionId: () => 'sess-1',
    onExit: (i) => exits.push(i),
    ...over
  })
  return { store, exits }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('BackgroundProcessStore', () => {
  it('captures output and advances the read offset', async () => {
    const { store } = makeStore()
    const r = store.start('a1', 'echo BG_MARKER', dir)
    expect('id' in r).toBe(true)
    const id = (r as { id: string }).id
    await waitFor(() => {
      const out = store.readNew(id)
      return 'text' in out && out.text.includes('BG_MARKER')
    })
  }, 20000)

  it('fires onExit with the captured sessionId and exit code', async () => {
    const { store, exits } = makeStore({ getSessionId: () => 'sess-42' })
    const r = store.start('a1', process.platform === 'win32' ? 'exit 2' : 'exit 2', dir) as { id: string }
    await waitFor(() => exits.length === 1)
    expect(exits[0].sessionId).toBe('sess-42')
    expect(exits[0].exitCode).toBe(2)
    expect(exits[0].id).toBe(r.id)
  }, 20000)

  it('enforces the per-agent limit', () => {
    const { store } = makeStore({ maxPerAgent: 2 })
    const cmd = process.platform === 'win32' ? 'ping -n 20 127.0.0.1' : 'sleep 20'
    store.start('a1', cmd, dir)
    store.start('a1', cmd, dir)
    const third = store.start('a1', cmd, dir)
    expect('error' in third).toBe(true)
    store.killAllForAgent('a1')
  })

  it('filters output lines by regex', async () => {
    const { store } = makeStore()
    const cmd = 'printf "alpha\\nbeta\\ngamma\\n"'
    const r = store.start('a1', cmd, dir) as { id: string }
    await waitFor(() => {
      const out = store.readNew(r.id, 'beta')
      return 'text' in out && out.text.includes('beta') && !out.text.includes('alpha')
    })
  }, 20000)

  it('trims the buffer and marks truncation', async () => {
    const { store } = makeStore({ maxBufferBytes: 40, maxBufferLines: 1000 })
    const cmd = `${process.execPath} -e "for(let i=1;i<=50;i++) console.log('LINE'+i)"`
    const r = store.start('a1', cmd, dir) as { id: string }
    await waitFor(() => {
      const out = store.readNew(r.id)
      return 'text' in out && out.text.includes('…truncated…')
    })
  }, 20000)

  it('unknown ids return errors', () => {
    const { store } = makeStore()
    expect('error' in store.readNew('nope')).toBe(true)
    expect('error' in store.kill('nope')).toBe(true)
  })

  it('stays readable across repeated reads after exit (not deleted on first read)', async () => {
    const { store, exits } = makeStore()
    const r = store.start('a1', 'echo BG_DONE', dir) as { id: string }
    await waitFor(() => exits.some(e => e.id === r.id))
    const first = store.readNew(r.id)
    expect('error' in first).toBe(false)
    expect('status' in first && first.status).toBe('exited')
    // A second read must not fail with "unknown id"; it returns no new text
    // but still reports the exited status until the TTL sweep removes it.
    const second = store.readNew(r.id)
    expect('error' in second).toBe(false)
    expect('text' in second && second.text).toBe('')
    expect('status' in second && second.status).toBe('exited')
  }, 20000)
})
