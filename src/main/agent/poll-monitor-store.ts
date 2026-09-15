import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import { buildShellCommand } from './tools/bash'
import type { MonitorResolveInfo } from './monitor-store'

export interface PollMonitorStartOpts {
  untilRegex?: string
  untilExit?: boolean | number
  intervalMs?: number
  timeoutMs?: number
}

export interface PollMonitorStoreOpts {
  getSessionId: (agentId: string) => string
  onResolve: (info: MonitorResolveInfo) => void
  maxPerAgent?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  command: string
  cwd: string
  untilRegex?: RegExp
  checkExit: boolean
  untilCode: number
  until: string
  status: 'watching' | 'resolved'
  polling: boolean
  timer?: ReturnType<typeof setInterval>
  timeoutTimer?: ReturnType<typeof setTimeout>
}

const DEFAULT_MAX_PER_AGENT = 10
const DEFAULT_INTERVAL_MS = 5000
const MIN_INTERVAL_MS = 1000
const DETAIL_CAP = 500
const MAX_OUTPUT = 64 * 1024
const POLL_KILL_MS = 30_000

export class PollMonitorStore {
  private entries = new Map<string, Entry>()

  constructor(private opts: PollMonitorStoreOpts) {}

  private get maxPerAgent(): number { return this.opts.maxPerAgent ?? DEFAULT_MAX_PER_AGENT }

  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'watching') n++
    return n
  }

  list(agentId: string): { id: string; targetId: string; until: string }[] {
    const out: { id: string; targetId: string; until: string }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'watching') out.push({ id: e.id, targetId: e.command, until: e.until })
    }
    return out
  }

  start(agentId: string, command: string, cwd: string, opts: PollMonitorStartOpts): { id: string } | { error: string } {
    if (!command || typeof command !== 'string') return { error: 'monitor: missing command' }
    let untilRegex: RegExp | undefined
    if (opts.untilRegex !== undefined) {
      try { untilRegex = new RegExp(opts.untilRegex) } catch { return { error: 'monitor: invalid until_regex' } }
    }
    let checkExit = false
    let untilCode = 0
    if (opts.untilExit !== undefined) {
      checkExit = true
      untilCode = typeof opts.untilExit === 'number' ? opts.untilExit : 0
    }
    // Default when no condition is given: poll until the command succeeds.
    if (!untilRegex && !checkExit) checkExit = true
    if (this.count(agentId) >= this.maxPerAgent) {
      return { error: `monitor: too many monitors (max ${this.maxPerAgent})` }
    }
    const intervalMs = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS)
    const id = randomUUID().slice(0, 8)
    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      checkExit ? `exit ${untilCode}` : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')
    const entry: Entry = {
      id, agentId, sessionId: this.opts.getSessionId(agentId), command, cwd,
      untilRegex, checkExit, untilCode, until, status: 'watching', polling: false
    }
    entry.timer = setInterval(() => this.poll(entry), intervalMs)
    entry.timer.unref?.()
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const ms = opts.timeoutMs
      entry.timeoutTimer = setTimeout(() => this.resolve(entry, 'timeout', `${Math.round(ms / 1000)}s`), ms)
      entry.timeoutTimer.unref?.()
    }
    this.entries.set(id, entry)
    this.poll(entry) // immediate first poll
    return { id }
  }

  private poll(entry: Entry): void {
    if (entry.status !== 'watching' || entry.polling) return
    entry.polling = true
    const dir = existsSync(entry.cwd) ? entry.cwd : homedir()
    const resolved = buildShellCommand(entry.command, dir)
    const child = spawn(resolved.command, resolved.args, {
      cwd: dir,
      env: process.env as Record<string, string>,
      windowsHide: true,
      windowsVerbatimArguments: resolved.verbatim ?? false
    })
    let out = ''
    child.stdout?.on('data', d => { if (out.length < MAX_OUTPUT) out += d.toString() })
    child.stderr?.on('data', d => { if (out.length < MAX_OUTPUT) out += d.toString() })
    const killTimer = setTimeout(() => { if (child.pid) { try { kill(child.pid) } catch { /* dead */ } } }, POLL_KILL_MS)
    killTimer.unref?.()
    child.on('error', () => { clearTimeout(killTimer); entry.polling = false })
    child.on('close', (code) => {
      clearTimeout(killTimer)
      entry.polling = false
      if (entry.status !== 'watching') return
      if (entry.untilRegex) {
        for (const line of out.split('\n')) {
          if (entry.untilRegex.test(line)) { this.resolve(entry, 'matched', line.trim().slice(0, DETAIL_CAP)); return }
        }
      }
      if (entry.checkExit && code === entry.untilCode) {
        this.resolve(entry, 'succeeded', `exit code ${code}`)
      }
    })
  }

  private resolve(entry: Entry, reason: 'matched' | 'succeeded' | 'timeout', detail: string): void {
    if (entry.status !== 'watching') return
    this.teardown(entry)
    this.opts.onResolve({
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.command, reason, detail, kind: 'poll'
    })
  }

  private teardown(entry: Entry): void {
    entry.status = 'resolved'
    if (entry.timer) clearInterval(entry.timer)
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
    this.entries.delete(entry.id)
  }

  cancelAllForAgent(agentId: string): void {
    for (const e of [...this.entries.values()]) if (e.agentId === agentId) this.teardown(e)
  }

  cancelAll(): void {
    for (const e of [...this.entries.values()]) this.teardown(e)
  }
}
