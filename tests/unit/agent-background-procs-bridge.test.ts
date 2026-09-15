import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bridge-'))

// Mirrors the manager's forwarding rule: forward data/exit only for subscribed ids.
function makeBridge(store: BackgroundProcessStore) {
  const subs = new Set<string>()
  const data: { id: string; chunk: string }[] = []
  const exits: { id: string; exitCode: number | null }[] = []
  store.on('data', (e: { id: string; chunk: string }) => { if (subs.has(e.id)) data.push(e) })
  store.on('exit', (e: { id: string; exitCode: number | null }) => { if (subs.has(e.id)) exits.push(e) })
  return { subs, data, exits }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 30)) }
}

describe('background proc subscription bridge', () => {
  it('forwards data/exit only for subscribed ids', async () => {
    const store = new BackgroundProcessStore({ getSessionId: () => 's', onExit: () => {} })
    const b = makeBridge(store)
    const watched = store.start('a1', 'sleep 0.2; echo SUB_OK', dir) as { id: string }
    const ignored = store.start('a1', 'echo IGN', dir) as { id: string }
    b.subs.add(watched.id)
    await waitFor(() => b.data.some(d => d.chunk.includes('SUB_OK')) && b.exits.some(e => e.id === watched.id))
    expect(b.data.every(d => d.id === watched.id)).toBe(true)
    expect(b.exits.some(e => e.id === ignored.id)).toBe(false)
  }, 20000)
})
