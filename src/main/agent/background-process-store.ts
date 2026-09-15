import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import kill from 'tree-kill'
import { buildShellCommand } from './tools/bash'

export interface BgDataEvent { id: string; chunk: string }
export interface BgExitEvent { id: string; exitCode: number | null }

export interface BgExitInfo {
  id: string
  agentId: string
  sessionId: string
  command: string
  exitCode: number | null
}

export interface BackgroundProcessStoreOpts {
  getSessionId: (agentId: string) => string
  onExit: (info: BgExitInfo) => void
  maxPerAgent?: number
  maxBufferBytes?: number
  maxBufferLines?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  command: string
  child: ChildProcess
  status: 'running' | 'exited'
  exitCode: number | null
  buffer: string
  readOffset: number
  truncatedMarked: boolean
}

const DEFAULT_MAX_PER_AGENT = 10
const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_LINES = 2000
const EXITED_TTL_MS = 5 * 60_000

export class BackgroundProcessStore extends EventEmitter {
  private entries = new Map<string, Entry>()

  constructor(private opts: BackgroundProcessStoreOpts) {
    super()
    // Many monitors may subscribe to one store; lift the 10-listener warning cap.
    this.setMaxListeners(0)
  }

  /** Read-only view of a process for observers (monitors), without touching readOffset. */
  inspect(id: string): { status: 'running' | 'exited'; exitCode: number | null; buffer: string } | undefined {
    const e = this.entries.get(id)
    return e ? { status: e.status, exitCode: e.exitCode, buffer: e.buffer } : undefined
  }

  private get maxPerAgent(): number { return this.opts.maxPerAgent ?? DEFAULT_MAX_PER_AGENT }
  private get maxBytes(): number { return this.opts.maxBufferBytes ?? DEFAULT_MAX_BYTES }
  private get maxLines(): number { return this.opts.maxBufferLines ?? DEFAULT_MAX_LINES }

  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'running') n++
    return n
  }

  list(agentId: string): { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }[] {
    const out: { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId) out.push({ id: e.id, command: e.command, status: e.status, exitCode: e.exitCode })
    }
    return out
  }

  start(agentId: string, command: string, cwd: string): { id: string } | { error: string } {
    if (!command || typeof command !== 'string') return { error: 'bash: missing "command" (string)' }
    if (this.count(agentId) >= this.maxPerAgent) {
      return { error: `bash: too many background processes (max ${this.maxPerAgent}). Stop one with kill_shell first.` }
    }
    const dir = existsSync(cwd) ? cwd : homedir()
    const resolved = buildShellCommand(command, dir)
    const child = spawn(resolved.command, resolved.args, {
      cwd: dir,
      env: process.env as Record<string, string>,
      windowsHide: true,
      windowsVerbatimArguments: resolved.verbatim ?? false
    })
    const id = randomUUID().slice(0, 8)
    const entry: Entry = {
      id, agentId, sessionId: this.opts.getSessionId(agentId), command,
      child, status: 'running', exitCode: null, buffer: '', readOffset: 0, truncatedMarked: false
    }
    this.entries.set(id, entry)
    const append = (d: Buffer) => this.appendOutput(entry, d.toString())
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (err) => this.appendOutput(entry, `\n[error] ${err.message}\n`))
    child.on('close', (code) => {
      entry.status = 'exited'
      entry.exitCode = code
      this.opts.onExit({ id, agentId, sessionId: entry.sessionId, command, exitCode: code })
      this.emit('exit', { id, exitCode: code })
      const timer = setTimeout(() => this.entries.delete(id), EXITED_TTL_MS)
      timer.unref?.()
    })
    return { id }
  }

  private appendOutput(entry: Entry, text: string): void {
    this.emit('data', { id: entry.id, chunk: text })
    entry.buffer += text
    let dropped = 0
    if (entry.buffer.length > this.maxBytes) {
      const d = entry.buffer.length - this.maxBytes
      entry.buffer = entry.buffer.slice(d)
      dropped += d
    }
    const lines = entry.buffer.split('\n')
    if (lines.length > this.maxLines) {
      const kept = lines.slice(lines.length - this.maxLines).join('\n')
      dropped += entry.buffer.length - kept.length
      entry.buffer = kept
    }
    if (dropped > 0) {
      if (!entry.truncatedMarked) {
        entry.buffer = '[…truncated…]\n' + entry.buffer
        entry.truncatedMarked = true
        entry.readOffset = 0
      } else {
        entry.readOffset = Math.max(0, entry.readOffset - dropped)
      }
    }
  }

  readNew(id: string, filter?: string): { text: string; status: 'running' | 'exited'; exitCode: number | null } | { error: string } {
    const entry = this.entries.get(id)
    if (!entry) return { error: `bash_output: unknown id "${id}"` }
    let text = entry.buffer.slice(entry.readOffset)
    entry.readOffset = entry.buffer.length
    if (filter) {
      let re: RegExp
      try { re = new RegExp(filter) } catch { return { error: 'bash_output: invalid filter regex' } }
      text = text.split('\n').filter(l => re.test(l)).join('\n')
    }
    // Do not delete an exited entry on read: bash_output may be called more
    // than once (the agent re-checks after the exit notice), and a second read
    // should return "no new output, exited" rather than "unknown id". The TTL
    // timer scheduled on exit is the sole reaper, so the buffer still can't leak.
    return { text, status: entry.status, exitCode: entry.exitCode }
  }

  kill(id: string): { killed: boolean } | { error: string } {
    const entry = this.entries.get(id)
    if (!entry) return { error: `kill_shell: unknown id "${id}"` }
    if (entry.status === 'exited') return { killed: false }
    if (entry.child.pid) { try { kill(entry.child.pid) } catch { /* already dead */ } }
    return { killed: true }
  }

  killAllForAgent(agentId: string): void {
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'running' && e.child.pid) {
        try { kill(e.child.pid) } catch { /* already dead */ }
      }
    }
  }

  killAll(): void {
    for (const e of this.entries.values()) {
      if (e.status === 'running' && e.child.pid) {
        try { kill(e.child.pid) } catch { /* already dead */ }
      }
    }
  }
}
