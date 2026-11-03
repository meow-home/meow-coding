import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TERMINALS_PER_SESSION,
  PERSIST_INTERVAL_MS,
  TerminalManager,
  type TerminalManagerDeps
} from '../../src/main/terminal-manager'
import type { PtyManager } from '../../src/main/pty-manager'
import type { ResolvedShell } from '../../src/main/terminal-shell'
import { TerminalStore } from '../../src/main/terminal-store'
import type { TerminalInfo } from '../../src/shared/types'

class FakePtyManager extends EventEmitter {
  readonly running = new Set<string>()
  readonly starts: Array<{ id: string; cwd: string; shell: ResolvedShell; env?: Record<string, string> }> = []
  readonly writes: Array<{ id: string; data: string }> = []
  readonly resizes: Array<{ id: string; cols: number; rows: number }> = []

  startTerminal(id: string, cwd: string, shell: ResolvedShell, env?: Record<string, string>): void {
    this.running.add(id)
    this.starts.push({ id, cwd, shell, env })
  }

  writeRaw(id: string, data: string): void {
    this.writes.push({ id, data })
  }

  resize(id: string, cols: number, rows: number): void {
    this.resizes.push({ id, cols, rows })
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  async stop(id: string): Promise<void> {
    if (this.running.has(id)) {
      this.running.delete(id)
      this.emit('exit', { agentId: id, exitCode: 0 })
    }
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.running)) {
      this.running.delete(id)
      this.emit('exit', { agentId: id, exitCode: 0 })
    }
  }
}

describe('TerminalManager', () => {
  let tmpDir: string
  let store: TerminalStore
  let fakePty: FakePtyManager
  let emitDataCalls: Array<{ id: string; data: string }>
  let emitChangedCalls: Array<{ agentId: string; terminals: TerminalInfo[] }>
  let defaultShell: ResolvedShell
  let manager: TerminalManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meow-term-mgr-test-'))
    store = new TerminalStore(tmpDir)
    fakePty = new FakePtyManager()
    emitDataCalls = []
    emitChangedCalls = []
    defaultShell = { name: 'bash', executable: '/bin/bash', args: ['--login'] }

    const deps: TerminalManagerDeps = {
      pty: fakePty as unknown as PtyManager,
      store,
      resolveShell: () => defaultShell,
      emitData: e => emitDataCalls.push(e),
      emitChanged: e => emitChangedCalls.push(e)
    }

    manager = new TerminalManager(deps)
  })

  afterEach(async () => {
    await manager.stopAll()
    vi.useRealTimers()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('enforces the max terminal cap per session', () => {
    const agentId = 'agent-cap'
    for (let i = 0; i < MAX_TERMINALS_PER_SESSION; i++) {
      manager.create(agentId, '/test/cwd')
    }

    expect(manager.list(agentId)).toHaveLength(MAX_TERMINALS_PER_SESSION)
    expect(() => manager.create(agentId, '/test/cwd')).toThrow('[meow] A session can have at most 8 terminals.')

    const other = manager.create('agent-other', '/test/cwd')
    expect(other.agentId).toBe('agent-other')
  })

  it('uses default cwd or accepts override, and defaults title to shell name', () => {
    const t1 = manager.create('agent-1', '/default/dir')
    expect(t1.cwd).toBe('/default/dir')
    expect(t1.title).toBe('bash')
    expect(fakePty.starts[0]).toEqual({
      id: t1.id,
      cwd: '/default/dir',
      shell: defaultShell,
      env: { TERM: 'xterm-256color', MEOW_SESSION_ID: 'agent-1' }
    })

    const t2 = manager.create('agent-1', '/default/dir', { cwd: '/custom/dir', title: 'Custom' })
    expect(t2.cwd).toBe('/custom/dir')
    expect(t2.title).toBe('Custom')
    expect(fakePty.starts[1]?.cwd).toBe('/custom/dir')
  })

  it('writes initial command with return when provided', () => {
    const t = manager.create('agent-cmd', '/test/dir', { command: 'npm test' })
    expect(fakePty.writes).toEqual([{ id: t.id, data: 'npm test\r' }])
  })

  it('buffers data while detached without emitting', () => {
    const t = manager.create('agent-detach', '/test/dir')
    fakePty.emit('data', { agentId: t.id, data: 'hello before attach\n' })

    expect(emitDataCalls).toHaveLength(0)

    const { scrollback } = manager.attach(t.id)
    expect(scrollback).toBe('hello before attach\n')
  })

  it('streams data through batcher when attached using fake timers', () => {
    vi.useFakeTimers()
    const t = manager.create('agent-attach', '/test/dir')
    manager.attach(t.id)

    fakePty.emit('data', { agentId: t.id, data: 'stream chunk 1' })
    expect(emitDataCalls).toHaveLength(0)

    vi.advanceTimersByTime(16)
    expect(emitDataCalls).toEqual([{ id: t.id, data: 'stream chunk 1' }])

    manager.detach(t.id)
    fakePty.emit('data', { agentId: t.id, data: 'after detach' })
    vi.advanceTimersByTime(32)
    expect(emitDataCalls).toHaveLength(1)
  })

  it('handles process exit by updating status, exitCode, notice and flushing batcher', () => {
    const t = manager.create('agent-exit', '/test/dir')
    manager.attach(t.id)
    emitDataCalls = []

    fakePty.running.delete(t.id)
    fakePty.emit('exit', { agentId: t.id, exitCode: 130 })

    const list = manager.list('agent-exit')
    expect(list[0]?.status).toBe('exited')
    expect(list[0]?.exitCode).toBe(130)

    const { scrollback } = manager.attach(t.id)
    expect(scrollback).toContain('[meow] Process exited with code 130')

    expect(emitDataCalls.some(c => c.data.includes('Process exited with code 130'))).toBe(true)
    expect(emitChangedCalls.some(c => c.agentId === 'agent-exit')).toBe(true)
  })

  it('restarts terminal keeping scrollback and clears restored/exitCode', async () => {
    const t = manager.create('agent-restart', '/test/dir')
    fakePty.emit('data', { agentId: t.id, data: 'first run output\n' })

    const beforeStarts = fakePty.starts.length
    const restarted = await manager.restart(t.id)

    expect(fakePty.starts.length).toBe(beforeStarts + 1)
    expect(restarted.status).toBe('running')
    expect(restarted.exitCode).toBeUndefined()
    expect(restarted.restored).toBeUndefined()

    const { scrollback } = manager.attach(t.id)
    expect(scrollback).toContain('first run output\n')
    expect(scrollback).toContain('[meow] Restarted')
  })

  it('kills terminal and ignores late exit events', async () => {
    const t = manager.create('agent-kill', '/test/dir')
    await manager.kill(t.id)

    expect(manager.list('agent-kill')).toHaveLength(0)

    fakePty.emit('exit', { agentId: t.id, exitCode: 0 })
    expect(manager.list('agent-kill')).toHaveLength(0)
  })

  it('removeSession kills only that agent terminals and removes folder from disk', async () => {
    const t1 = manager.create('agent-a', '/dir/a')
    const t2 = manager.create('agent-b', '/dir/b')

    await manager.removeSession('agent-a')

    expect(manager.list('agent-a')).toHaveLength(0)
    expect(manager.list('agent-b')).toHaveLength(1)
    expect(manager.list('agent-b')[0]?.id).toBe(t2.id)

    const onDiskA = store.load('agent-a')
    expect(onDiskA.info).toHaveLength(0)
  })

  it('loads restored entries as exited with restored: true and seeds scrollback', async () => {
    const t = manager.create('agent-restore', '/initial/dir')
    fakePty.emit('data', { agentId: t.id, data: 'log from before restart\n' })
    manager.flush()

    await manager.stopAll()

    const newFakePty = new FakePtyManager()
    const manager2 = new TerminalManager({
      pty: newFakePty as unknown as PtyManager,
      store,
      resolveShell: () => defaultShell,
      emitData: () => {},
      emitChanged: () => {}
    })

    const list = manager2.list('agent-restore')
    expect(list).toHaveLength(1)
    expect(list[0]?.status).toBe('exited')
    expect(list[0]?.restored).toBe(true)

    const { scrollback } = manager2.attach(t.id)
    expect(scrollback).toContain('log from before restart\n')
    expect(scrollback).toContain('[meow] Restored after restart — press Restart to start a new shell.')

    await manager2.stopAll()
  })

  it('persists only sessions with running terminals on the persist interval', async () => {
    vi.useFakeTimers()
    const customFakePty = new FakePtyManager()
    const saveSpy = vi.spyOn(store, 'save')

    const mgr = new TerminalManager({
      pty: customFakePty as unknown as PtyManager,
      store,
      resolveShell: () => defaultShell,
      emitData: () => {},
      emitChanged: () => {}
    })

    const t1 = mgr.create('agent-running', '/dir1')
    const t2 = mgr.create('agent-exited', '/dir2')

    customFakePty.running.delete(t2.id)
    customFakePty.emit('exit', { agentId: t2.id, exitCode: 0 })
    saveSpy.mockClear()

    vi.advanceTimersByTime(PERSIST_INTERVAL_MS)

    const savedAgents = saveSpy.mock.calls.map(call => call[0])
    expect(savedAgents).toContain('agent-running')
    expect(savedAgents).not.toContain('agent-exited')

    await mgr.stopAll()
  })

  it('supports rename and resize', () => {
    const t = manager.create('agent-ops', '/test/dir')

    manager.rename(t.id, '  My Custom Name  ')
    expect(manager.list('agent-ops')[0]?.userTitle).toBe('My Custom Name')

    manager.rename(t.id, '   ')
    expect(manager.list('agent-ops')[0]?.userTitle).toBeUndefined()

    manager.resize(t.id, 120, 40)
    expect(fakePty.resizes).toContainEqual({ id: t.id, cols: 120, rows: 40 })

    manager.resize(t.id, -10, 0)
    expect(fakePty.resizes).toContainEqual({ id: t.id, cols: 1, rows: 1 })
  })
})
