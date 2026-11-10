import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CliLoginManager,
  LOGIN_BUFFER_MAX_BYTES,
  type PtyProcessLike,
  type PtySpawn
} from '../../src/main/cli-agents/login-session'

class FakePty implements PtyProcessLike {
  pid?: number
  private dataCbs: ((chunk: string) => void)[] = []
  private exitCbs: ((e: { exitCode: number; signal?: number }) => void)[] = []
  writes: string[] = []
  killCount = 0

  constructor(pid?: number) {
    this.pid = pid
  }

  onData(cb: (chunk: string) => void): void {
    this.dataCbs.push(cb)
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitCbs.push(cb)
  }

  write(data: string): void {
    this.writes.push(data)
  }

  kill(): void {
    this.killCount++
  }

  emitData(chunk: string): void {
    for (const cb of this.dataCbs) cb(chunk)
  }

  emitExit(exitCode = 0, signal?: number): void {
    for (const cb of this.exitCbs) cb({ exitCode, signal })
  }
}

describe('CliLoginManager', () => {
  let fakePtyList: FakePty[] = []
  let spawnPtyMock: ReturnType<typeof vi.fn>
  let killTreeMock: ReturnType<typeof vi.fn>
  let dataEvents: { loginId: string; chunk: string }[] = []
  let urlEvents: { loginId: string; url: string }[] = []
  let exitEvents: { loginId: string; code: number }[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    fakePtyList = []
    dataEvents = []
    urlEvents = []
    exitEvents = []

    killTreeMock = vi.fn().mockResolvedValue(undefined)
    spawnPtyMock = vi.fn().mockImplementation((file: string, args: string[], opts: any) => {
      const pty = new FakePty(9999 + fakePtyList.length)
      fakePtyList.push(pty)
      return pty
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createLoginManager(overrides: Partial<Parameters<typeof CliLoginManager['prototype']['constructor']>[0]> = {}) {
    return new CliLoginManager({
      spawnPty: spawnPtyMock as unknown as PtySpawn,
      killTree: killTreeMock,
      onData: (loginId, chunk) => dataEvents.push({ loginId, chunk }),
      onUrl: (loginId, url) => urlEvents.push({ loginId, url }),
      onExit: (loginId, code) => exitEvents.push({ loginId, code }),
      ...overrides
    })
  }

  it('starts a login session and spawns the PTY with correct parameters', () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_1',
      file: 'agy',
      args: ['auth'],
      cwd: '/workspace',
      env: { FOO: 'bar' }
    })

    expect(manager.activeCount()).toBe(1)
    expect(manager.isActive('login_1')).toBe(true)
    expect(spawnPtyMock).toHaveBeenCalledWith('agy', ['auth'], {
      cwd: '/workspace',
      env: { FOO: 'bar' },
      cols: 100,
      rows: 30
    })

    // Cannot start duplicate loginId
    expect(() => {
      manager.start({
        loginId: 'login_1',
        file: 'agy',
        args: [],
        cwd: '/workspace',
        env: {}
      })
    }).toThrow(/already active/)
  })

  it('streams data, extracts URLs, and deduplicates identical URLs per session', () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_2',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    pty.emitData('To sign in, visit https://accounts.google.com/oauth?code=abc\r\n')
    pty.emitData('Again: https://accounts.google.com/oauth?code=abc or https://example.com/login\n')

    expect(dataEvents).toHaveLength(2)
    expect(urlEvents).toEqual([
      { loginId: 'login_2', url: 'https://accounts.google.com/oauth?code=abc' },
      { loginId: 'login_2', url: 'https://example.com/login' }
    ])
  })

  it('caps the stream buffer at 64 KiB keeping the tail', () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_buf',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    const largeChunk1 = 'A'.repeat(50 * 1024)
    const largeChunk2 = 'B'.repeat(30 * 1024)
    pty.emitData(largeChunk1)
    pty.emitData(largeChunk2)

    const buffer = manager.getBuffer('login_buf')
    expect(buffer).toBeDefined()
    expect(Buffer.byteLength(buffer!, 'utf8')).toBe(LOGIN_BUFFER_MAX_BYTES)
    expect(buffer!.endsWith('B'.repeat(30 * 1024))).toBe(true)
  })

  it('writes input to the active PTY', () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_write',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    manager.write('login_write', 'user-input\n')
    expect(pty.writes).toEqual(['user-input\n'])

    // Unknown loginId write does nothing
    manager.write('unknown', 'test')
  })

  it('removes the session and notifies on exit', () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_exit',
      file: 'opencode',
      args: ['auth', 'login'],
      cwd: '/workspace',
      env: {}
    })

    expect(manager.activeCount()).toBe(1)
    const pty = fakePtyList[0]
    pty.emitExit(0)

    expect(manager.activeCount()).toBe(0)
    expect(manager.isActive('login_exit')).toBe(false)
    expect(exitEvents).toEqual([{ loginId: 'login_exit', code: 0 }])
  })

  it('cancels the login session and kills the process exactly once', async () => {
    const manager = createLoginManager()
    manager.start({
      loginId: 'login_cancel',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    expect(manager.cancel('login_cancel')).toBe(true)
    expect(manager.activeCount()).toBe(0)
    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)
    expect(killTreeMock).toHaveBeenCalledWith(pty.pid)

    // Second cancel is a no-op and does not kill again
    expect(manager.cancel('login_cancel')).toBe(false)
    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)
  })

  it('times out and kills the process exactly once; subsequent cancel does not kill again', async () => {
    const manager = createLoginManager({ timeoutMs: 1000 })
    manager.start({
      loginId: 'login_timeout',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    expect(pty.killCount).toBe(0)
    expect(killTreeMock).toHaveBeenCalledTimes(0)

    // Advance timers past timeout
    vi.advanceTimersByTime(1001)

    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)

    // Subsequent cancel is no-op
    expect(manager.cancel('login_timeout')).toBe(false)
    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)
  })

  it('cancel before timeout clears the timer and does not kill again at timeout', async () => {
    const manager = createLoginManager({ timeoutMs: 5000 })
    manager.start({
      loginId: 'login_early_cancel',
      file: 'agy',
      args: [],
      cwd: '/workspace',
      env: {}
    })

    const pty = fakePtyList[0]
    manager.cancel('login_early_cancel')
    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)

    // Advance time past what was the timeout
    vi.advanceTimersByTime(6000)

    expect(pty.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(1)
  })

  it('cancelAll terminates all active sessions exactly once', async () => {
    const manager = createLoginManager()
    manager.start({ loginId: 'sess_1', file: 'agy', args: [], cwd: '/dir', env: {} })
    manager.start({ loginId: 'sess_2', file: 'opencode', args: [], cwd: '/dir', env: {} })

    expect(manager.activeCount()).toBe(2)
    const pty1 = fakePtyList[0]
    const pty2 = fakePtyList[1]

    await manager.cancelAll()

    expect(manager.activeCount()).toBe(0)
    expect(pty1.killCount).toBe(1)
    expect(pty2.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(2)

    // Calling cancelAll again does not re-kill
    await manager.cancelAll()
    expect(pty1.killCount).toBe(1)
    expect(pty2.killCount).toBe(1)
    expect(killTreeMock).toHaveBeenCalledTimes(2)
  })

  it('supports listener subscriptions for data, exit, and url', () => {
    const manager = createLoginManager({ onData: undefined, onUrl: undefined, onExit: undefined })
    const dataSub = vi.fn()
    const urlSub = vi.fn()
    const exitSub = vi.fn()

    const unsubData = manager.onData(dataSub)
    const unsubUrl = manager.onUrl(urlSub)
    const unsubExit = manager.onExit(exitSub)

    manager.start({ loginId: 'sub_test', file: 'agy', args: [], cwd: '/dir', env: {} })
    const pty = fakePtyList[0]

    pty.emitData('See https://meow.dev/auth')
    expect(dataSub).toHaveBeenCalledWith('sub_test', 'See https://meow.dev/auth')
    expect(urlSub).toHaveBeenCalledWith('sub_test', 'https://meow.dev/auth')

    pty.emitExit(0)
    expect(exitSub).toHaveBeenCalledWith('sub_test', 0)

    unsubData()
    unsubUrl()
    unsubExit()
  })
})
