import type { TerminalCreateOptions, TerminalInfo } from '../shared/types'
import { OutputBatcher, ScrollbackBuffer, type BatcherTimers } from './terminal-buffer'
import type { PtyManager } from './pty-manager'
import type { ResolvedShell } from './terminal-shell'
import type { TerminalStore } from './terminal-store'

export const MAX_TERMINALS_PER_SESSION = 8
export const SCROLLBACK_BYTES = 512 * 1024
export const FLUSH_INTERVAL_MS = 16
export const FLUSH_MAX_BYTES = 64 * 1024
export const PERSIST_INTERVAL_MS = 30_000

export interface TerminalManagerDeps {
  pty: PtyManager
  store: TerminalStore
  resolveShell: () => ResolvedShell
  emitData: (e: { id: string; data: string }) => void
  emitChanged: (e: { agentId: string; terminals: TerminalInfo[] }) => void
  now?: () => number
  timers?: {
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
    setTimeout?: (fn: () => void, ms: number) => any
    clearTimeout?: (id: any) => void
  }
}

interface TerminalEntry {
  info: TerminalInfo
  buffer: ScrollbackBuffer
  batcher: OutputBatcher | null
  generation: number
  activeGeneration: number
}

function generateTerminalId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let suffix = ''
  for (let i = 0; i < 10; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `term_${suffix}`
}

export class TerminalManager {
  private readonly terminals = new Map<string, TerminalEntry>()
  private readonly sessionTerminals = new Map<string, string[]>()
  private readonly knownSessions = new Set<string>()
  private persistTimer: any = null
  private readonly batcherTimers?: BatcherTimers

  constructor(private readonly deps: TerminalManagerDeps) {
    if (deps.timers?.setTimeout) {
      this.batcherTimers = {
        setTimeout: deps.timers.setTimeout,
        clearTimeout: deps.timers.clearTimeout ?? clearTimeout
      }
    }

    this.deps.pty.on('data', (e: { agentId: string; data: string }) => {
      this.onPtyData(e.agentId, e.data)
    })
    this.deps.pty.on('exit', (e: { agentId: string; exitCode: number }) => {
      this.onPtyExit(e.agentId, e.exitCode)
    })

    const setInt = deps.timers?.setInterval ?? setInterval
    this.persistTimer = setInt(() => {
      this.persistRunningSessions()
    }, PERSIST_INTERVAL_MS)
  }

  private onPtyData(id: string, data: string): void {
    const entry = this.terminals.get(id)
    if (!entry) return
    entry.buffer.append(data)
    if (entry.batcher) {
      entry.batcher.push(data)
    }
  }

  private onPtyExit(id: string, exitCode: number): void {
    const entry = this.terminals.get(id)
    if (!entry) return
    if (entry.activeGeneration !== entry.generation) return

    entry.info.status = 'exited'
    entry.info.exitCode = exitCode
    const notice = `\r\n\x1b[2m[meow] Process exited with code ${exitCode}\x1b[0m\r\n`
    entry.buffer.append(notice)
    if (entry.batcher) {
      entry.batcher.push(notice)
      entry.batcher.flushNow()
    }
    this.emitChanged(entry.info.agentId)
    this.persistSession(entry.info.agentId)
  }

  private ensureSessionLoaded(agentId: string): void {
    if (this.knownSessions.has(agentId)) return
    this.knownSessions.add(agentId)

    const loaded = this.deps.store.load(agentId)
    const ids: string[] = []
    const sorted = [...loaded.info].sort((a, b) => a.createdAt - b.createdAt)

    for (const raw of sorted) {
      if (!raw || !raw.id) continue
      const info: TerminalInfo = {
        ...raw,
        status: 'exited',
        restored: true
      }
      const buffer = new ScrollbackBuffer(SCROLLBACK_BYTES)
      const savedLog = loaded.logs[info.id] ?? ''
      const notice = '\r\n\x1b[2m[meow] Restored after restart — press Restart to start a new shell.\x1b[0m\r\n'
      buffer.append(savedLog + notice)

      const entry: TerminalEntry = {
        info,
        buffer,
        batcher: null,
        generation: 0,
        activeGeneration: 0
      }
      this.terminals.set(info.id, entry)
      ids.push(info.id)
    }
    this.sessionTerminals.set(agentId, ids)
  }

  list(agentId: string): TerminalInfo[] {
    this.ensureSessionLoaded(agentId)
    const ids = this.sessionTerminals.get(agentId) ?? []
    const result: TerminalInfo[] = []
    for (const id of ids) {
      const entry = this.terminals.get(id)
      if (entry) {
        result.push({ ...entry.info })
      }
    }
    return result
  }

  create(agentId: string, defaultCwd: string, opts?: TerminalCreateOptions): TerminalInfo {
    this.ensureSessionLoaded(agentId)
    const ids = this.sessionTerminals.get(agentId) ?? []
    if (ids.length >= MAX_TERMINALS_PER_SESSION) {
      throw new Error('[meow] A session can have at most 8 terminals.')
    }

    const id = generateTerminalId()
    const now = this.deps.now ? this.deps.now() : Date.now()
    const shell = this.deps.resolveShell()
    const cwd = opts?.cwd ?? defaultCwd
    const title = opts?.title ?? shell.name

    const info: TerminalInfo = {
      id,
      agentId,
      title,
      cwd,
      status: 'running',
      createdAt: now
    }
    const buffer = new ScrollbackBuffer(SCROLLBACK_BYTES)
    const entry: TerminalEntry = {
      info,
      buffer,
      batcher: null,
      generation: 1,
      activeGeneration: 1
    }

    this.terminals.set(id, entry)
    ids.push(id)
    this.sessionTerminals.set(agentId, ids)

    try {
      this.deps.pty.startTerminal(id, cwd, shell, {
        TERM: 'xterm-256color',
        MEOW_SESSION_ID: agentId
      })
    } catch (err) {
      this.terminals.delete(id)
      ids.pop()
      throw err
    }

    if (opts?.command) {
      this.deps.pty.writeRaw(id, opts.command + '\r')
    }

    this.emitChanged(agentId)
    this.persistSession(agentId)
    return { ...info }
  }

  attach(id: string): { scrollback: string } {
    const entry = this.terminals.get(id)
    if (!entry) throw new Error(`[meow] Terminal not found: ${id}`)
    const scrollback = entry.buffer.snapshot()
    if (!entry.batcher) {
      entry.batcher = new OutputBatcher(
        data => this.deps.emitData({ id, data }),
        FLUSH_INTERVAL_MS,
        FLUSH_MAX_BYTES,
        this.batcherTimers
      )
    }
    return { scrollback }
  }

  detach(id: string): void {
    const entry = this.terminals.get(id)
    if (!entry || !entry.batcher) return
    entry.batcher.dispose()
    entry.batcher = null
  }

  write(id: string, data: string): void {
    this.deps.pty.writeRaw(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.terminals.get(id)
    if (!entry || entry.info.status !== 'running') return
    const safeCols = Math.max(1, Math.floor(cols) || 1)
    const safeRows = Math.max(1, Math.floor(rows) || 1)
    this.deps.pty.resize(id, safeCols, safeRows)
  }

  rename(id: string, userTitle: string | null): void {
    const entry = this.terminals.get(id)
    if (!entry) return
    const trimmed = userTitle?.trim()
    if (trimmed) {
      entry.info.userTitle = trimmed
    } else {
      delete entry.info.userTitle
    }
    this.emitChanged(entry.info.agentId)
    this.persistSession(entry.info.agentId)
  }

  async restart(id: string): Promise<TerminalInfo> {
    const entry = this.terminals.get(id)
    if (!entry) throw new Error(`[meow] Terminal not found: ${id}`)

    const targetGen = ++entry.generation
    if (this.deps.pty.isRunning(id)) {
      await this.deps.pty.stop(id)
    }

    if (this.terminals.get(id) !== entry || entry.generation !== targetGen) {
      return { ...entry.info }
    }

    const restartNotice = '\r\n\x1b[2m[meow] Restarted\x1b[0m\r\n'
    entry.buffer.append(restartNotice)
    if (entry.batcher) {
      entry.batcher.push(restartNotice)
    }

    const shell = this.deps.resolveShell()
    delete entry.info.exitCode
    delete entry.info.restored
    entry.info.status = 'running'
    entry.activeGeneration = entry.generation

    this.deps.pty.startTerminal(id, entry.info.cwd, shell, {
      TERM: 'xterm-256color',
      MEOW_SESSION_ID: entry.info.agentId
    })

    this.emitChanged(entry.info.agentId)
    this.persistSession(entry.info.agentId)
    return { ...entry.info }
  }

  async kill(id: string): Promise<void> {
    const entry = this.terminals.get(id)
    if (!entry) return

    entry.generation++
    if (entry.batcher) {
      entry.batcher.dispose()
      entry.batcher = null
    }

    this.terminals.delete(id)
    const agentId = entry.info.agentId
    const list = this.sessionTerminals.get(agentId)
    if (list) {
      const idx = list.indexOf(id)
      if (idx !== -1) list.splice(idx, 1)
    }

    if (this.deps.pty.isRunning(id)) {
      await this.deps.pty.stop(id)
    }

    this.emitChanged(agentId)
    this.persistSession(agentId)
  }

  async removeSession(agentId: string): Promise<void> {
    this.ensureSessionLoaded(agentId)
    const ids = this.sessionTerminals.get(agentId) ? [...this.sessionTerminals.get(agentId)!] : []
    await Promise.all(ids.map(id => this.kill(id)))
    this.sessionTerminals.delete(agentId)
    this.knownSessions.delete(agentId)
    this.deps.store.removeSession(agentId)
    this.deps.emitChanged({ agentId, terminals: [] })
  }

  flush(): void {
    for (const agentId of this.knownSessions) {
      this.persistSession(agentId)
    }
  }

  async stopAll(): Promise<void> {
    if (this.persistTimer !== null) {
      const clearInt = this.deps.timers?.clearInterval ?? clearInterval
      clearInt(this.persistTimer)
      this.persistTimer = null
    }
    for (const entry of this.terminals.values()) {
      if (entry.batcher) {
        entry.batcher.dispose()
        entry.batcher = null
      }
    }
    await this.deps.pty.stopAll()
  }

  private persistSession(agentId: string): void {
    const ids = this.sessionTerminals.get(agentId) ?? []
    const infos: TerminalInfo[] = []
    const logs: Record<string, string> = {}
    for (const id of ids) {
      const entry = this.terminals.get(id)
      if (entry) {
        infos.push({ ...entry.info })
        logs[id] = entry.buffer.snapshot()
      }
    }
    this.deps.store.save(agentId, infos, logs)
  }

  private persistRunningSessions(): void {
    for (const agentId of this.knownSessions) {
      const ids = this.sessionTerminals.get(agentId) ?? []
      const hasRunning = ids.some(id => this.terminals.get(id)?.info.status === 'running')
      if (hasRunning) {
        this.persistSession(agentId)
      }
    }
  }

  private emitChanged(agentId: string): void {
    const terminals = this.list(agentId)
    this.deps.emitChanged({ agentId, terminals })
  }
}
