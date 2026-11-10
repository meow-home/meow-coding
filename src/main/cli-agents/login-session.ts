import kill from 'tree-kill'

export const LOGIN_BUFFER_MAX_BYTES = 64 * 1024
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const URL_REGEX = /https?:\/\/[^\s"'<>]+/g

export interface PtyProcessLike {
  pid?: number
  onData(cb: (chunk: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  kill(): void
}

export type PtySpawn = (
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; cols?: number; rows?: number }
) => PtyProcessLike

export interface CliLoginManagerOptions {
  spawnPty: PtySpawn
  killTree?: (pid: number) => Promise<void> | void
  now?: () => number
  timeoutMs?: number
  onData?: (loginId: string, chunk: string) => void
  onExit?: (loginId: string, code: number) => void
  onUrl?: (loginId: string, url: string) => void
}

export interface StartLoginInput {
  loginId: string
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

interface LoginSessionRecord {
  loginId: string
  proc: PtyProcessLike
  buffer: string
  seenUrls: Set<string>
  timer?: NodeJS.Timeout
  killed: boolean
  killPromise?: Promise<void>
}

function defaultKillTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    kill(pid, () => resolve())
  })
}

export class CliLoginManager {
  private readonly opts: CliLoginManagerOptions
  private readonly spawnPty: PtySpawn
  private readonly killTree: (pid: number) => Promise<void> | void
  private readonly timeoutMs: number
  private readonly sessions = new Map<string, LoginSessionRecord>()

  private readonly dataListeners = new Set<(loginId: string, chunk: string) => void>()
  private readonly exitListeners = new Set<(loginId: string, code: number) => void>()
  private readonly urlListeners = new Set<(loginId: string, url: string) => void>()

  constructor(opts: CliLoginManagerOptions) {
    this.opts = opts
    this.spawnPty = opts.spawnPty
    this.killTree = opts.killTree ?? defaultKillTree
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  }

  onData(cb: (loginId: string, chunk: string) => void): () => void {
    this.dataListeners.add(cb)
    return () => this.dataListeners.delete(cb)
  }

  onExit(cb: (loginId: string, code: number) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  onUrl(cb: (loginId: string, url: string) => void): () => void {
    this.urlListeners.add(cb)
    return () => this.urlListeners.delete(cb)
  }

  start(input: StartLoginInput): void {
    if (this.sessions.has(input.loginId)) {
      throw new Error(`[meow] Login session already active: ${input.loginId}`)
    }

    const proc = this.spawnPty(input.file, input.args, {
      cwd: input.cwd,
      env: input.env,
      cols: 100,
      rows: 30
    })

    const record: LoginSessionRecord = {
      loginId: input.loginId,
      proc,
      buffer: '',
      seenUrls: new Set<string>(),
      killed: false
    }

    this.sessions.set(input.loginId, record)

    record.timer = setTimeout(() => {
      void this.killSession(record)
    }, this.timeoutMs)

    proc.onData((chunk: string) => {
      if (record.killed) return

      record.buffer += chunk
      const byteLen = Buffer.byteLength(record.buffer, 'utf8')
      if (byteLen > LOGIN_BUFFER_MAX_BYTES) {
        const buf = Buffer.from(record.buffer, 'utf8')
        record.buffer = buf.subarray(buf.length - LOGIN_BUFFER_MAX_BYTES).toString('utf8')
      }

      const matches = chunk.match(URL_REGEX)
      if (matches) {
        for (const url of matches) {
          if (!record.seenUrls.has(url)) {
            record.seenUrls.add(url)
            this.opts.onUrl?.(input.loginId, url)
            this.urlListeners.forEach(cb => cb(input.loginId, url))
          }
        }
      }

      this.opts.onData?.(input.loginId, chunk)
      this.dataListeners.forEach(cb => cb(input.loginId, chunk))
    })

    proc.onExit((e: { exitCode: number; signal?: number }) => {
      if (record.timer) {
        clearTimeout(record.timer)
        record.timer = undefined
      }
      this.sessions.delete(input.loginId)
      const exitCode = e.exitCode ?? 0
      this.opts.onExit?.(input.loginId, exitCode)
      this.exitListeners.forEach(cb => cb(input.loginId, exitCode))
    })
  }

  write(loginId: string, data: string): void {
    const session = this.sessions.get(loginId)
    if (!session || session.killed) return
    session.proc.write(data)
  }

  cancel(loginId: string): boolean {
    const session = this.sessions.get(loginId)
    if (!session || session.killed) return false
    void this.killSession(session)
    return true
  }

  async cancelAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const session of this.sessions.values()) {
      if (!session.killed) {
        promises.push(this.killSession(session))
      } else if (session.killPromise) {
        promises.push(session.killPromise)
      }
    }
    await Promise.all(promises)
  }

  activeCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (!session.killed) count++
    }
    return count
  }

  isActive(loginId: string): boolean {
    const session = this.sessions.get(loginId)
    return !!session && !session.killed
  }

  getBuffer(loginId: string): string | undefined {
    return this.sessions.get(loginId)?.buffer
  }

  private async killSession(session: LoginSessionRecord): Promise<void> {
    if (session.killed) {
      return session.killPromise ?? Promise.resolve()
    }
    session.killed = true
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = undefined
    }

    const p = (async () => {
      try {
        session.proc.kill()
      } catch {
        /* best effort */
      }
      if (session.proc.pid) {
        await this.killTree(session.proc.pid)
      }
    })()

    session.killPromise = p
    return p
  }
}
