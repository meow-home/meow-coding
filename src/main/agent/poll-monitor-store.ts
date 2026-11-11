import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import type { MonitorInfo } from '@shared/types'
import { buildShellCommand } from './tools/bash'
import type { MonitorResolveInfo, MonitorWaitResult } from './monitor-store'

export interface PollMonitorStartOpts {
  untilRegex?: string
  untilExit?: boolean | number
  intervalMs?: number
  timeoutMs?: number
}

export interface PollMonitorStoreOpts {
  getSessionId: (agentId: string) => string
  onResolve: (info: MonitorResolveInfo) => void
  /** Fired whenever the watch list changes, so the UI can refresh on push. */
  onChange?: (agentId: string) => void
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
  startedAt: number
  polling: boolean
  timer?: ReturnType<typeof setInterval>
  timeoutTimer?: ReturnType<typeof setTimeout>
  key: string
}

const DEFAULT_MAX_PER_AGENT = 10
const DEFAULT_INTERVAL_MS = 5000
const MIN_INTERVAL_MS = 1000
const DETAIL_CAP = 500
const MAX_OUTPUT = 64 * 1024
const POLL_KILL_MS = 30_000
// Resolved watches stay visible in the task card until dismissed.
const MAX_HISTORY = 20

export class PollMonitorStore {
  private entries = new Map<string, Entry>()
  private waiters = new Map<string, Set<(result: MonitorWaitResult) => void>>()
  private consumed = new Set<string>()
  private resolved = new Map<string, MonitorResolveInfo>()
  private history = new Map<string, { agentId: string; info: MonitorInfo }>()

  private key(agentId: string, command: string, cwd: string, opts: PollMonitorStartOpts, intervalMs: number): string {
    return `${agentId}\0${command}\0${cwd}\0${opts.untilRegex ?? ''}\0${opts.untilExit === undefined ? 'unset' : String(opts.untilExit)}\0${intervalMs}`
  }

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

  /** Watching monitors plus recently resolved ones, for the task card. */
  snapshot(agentId: string): MonitorInfo[] {
    const watching: MonitorInfo[] = []
    for (const e of this.entries.values()) {
      if (e.agentId !== agentId || e.status !== 'watching') continue
      watching.push({
        id: e.id, kind: 'poll', label: e.command, targetId: e.command, until: e.until,
        status: 'watching', startedAt: e.startedAt, sessionId: e.sessionId
      })
    }
    const done = [...this.history.values()]
      .filter(h => h.agentId === agentId)
      .map(h => h.info)
      .reverse()
    return [...watching.sort((a, b) => a.startedAt - b.startedAt), ...done]
  }

  /** Stops a watching monitor, or dismisses a resolved one. Returns whether anything changed. */
  cancel(id: string): boolean {
    const entry = this.entries.get(id)
    if (entry) {
      const agentId = entry.agentId
      this.teardown(entry)
      this.opts.onChange?.(agentId)
      return true
    }
    const done = this.history.get(id)
    if (done) {
      this.history.delete(id)
      this.opts.onChange?.(done.agentId)
      return true
    }
    return false
  }

  wasWaitConsumed(id: string): boolean { return this.consumed.delete(id) }

  wait(id: string, signal?: AbortSignal, maxWaitMs = 60_000): Promise<MonitorWaitResult> {
    const resolved = this.resolved.get(id)
    if (resolved) {
      this.consumed.add(id)
      return Promise.resolve({ status: 'resolved', id, info: resolved })
    }
    if (!this.entries.has(id)) return Promise.resolve({ status: 'pending', id })
    return new Promise(resolve => {
      let settled = false
      const settle = (result: MonitorWaitResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        const set = this.waiters.get(id)
        set?.delete(settle)
        if (set?.size === 0) this.waiters.delete(id)
        resolve(result)
      }
      const onAbort = () => settle({ status: 'aborted', id })
      const timer = setTimeout(() => settle({ status: 'pending', id }), Math.min(maxWaitMs, 60_000))
      timer.unref?.()
      const set = this.waiters.get(id) ?? new Set()
      set.add(settle)
      this.waiters.set(id, set)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  start(agentId: string, command: string, cwd: string, opts: PollMonitorStartOpts): { id: string; reused: boolean; pending: boolean } | { error: string } {
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
    const resolvedCwd = existsSync(cwd) ? cwd : homedir()
    const key = this.key(agentId, command, resolvedCwd, opts, intervalMs)
    for (const existing of this.entries.values()) {
      if (existing.status === 'watching' && existing.key === key) return { id: existing.id, reused: true, pending: true }
    }
    const id = randomUUID().slice(0, 8)
    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      checkExit ? `exit ${untilCode}` : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')
    const entry: Entry = {
      id, agentId, sessionId: this.opts.getSessionId(agentId), command, cwd,
      untilRegex, checkExit, untilCode, until, status: 'watching', startedAt: Date.now(), polling: false, key
    }
    entry.timer = setInterval(() => this.poll(entry), intervalMs)
    entry.timer.unref?.()
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const ms = opts.timeoutMs
      entry.timeoutTimer = setTimeout(() => this.resolve(entry, 'timeout', `${Math.round(ms / 1000)}s`), ms)
      entry.timeoutTimer.unref?.()
    }
    this.entries.set(id, entry)
    this.opts.onChange?.(agentId)
    this.poll(entry) // immediate first poll
    return { id, reused: false, pending: true }
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
    const info: MonitorResolveInfo = {
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.command, reason, detail, kind: 'poll'
    }
    this.publish(info, entry)
  }

  private publish(info: MonitorResolveInfo, entry?: Entry): void {
    this.history.set(info.id, {
      agentId: info.agentId,
      info: {
        id: info.id, kind: 'poll', label: entry?.command ?? info.targetId, targetId: info.targetId,
        until: entry?.until ?? '', status: 'resolved', reason: info.reason, detail: info.detail,
        startedAt: entry?.startedAt ?? Date.now(), resolvedAt: Date.now(), sessionId: info.sessionId
      }
    })
    while (this.history.size > MAX_HISTORY) {
      const oldest = this.history.keys().next().value
      if (oldest === undefined) break
      this.history.delete(oldest)
    }
    this.opts.onChange?.(info.agentId)
    this.resolved.set(info.id, info)
    const waiters = this.waiters.get(info.id)
    if (waiters?.size) {
      this.consumed.add(info.id)
      for (const settle of [...waiters]) settle({ status: 'resolved', id: info.id, info })
      this.opts.onResolve(info)
      this.resolved.delete(info.id)
      return
    }
    queueMicrotask(() => {
      this.opts.onResolve(info)
      this.resolved.delete(info.id)
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
    this.opts.onChange?.(agentId)
  }

  cancelAll(): void {
    for (const e of [...this.entries.values()]) this.teardown(e)
  }
}
