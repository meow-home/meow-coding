import { randomUUID } from 'node:crypto'
import type { BackgroundProcessStore, BgDataEvent, BgExitEvent } from './background-process-store'

export type MonitorReason = 'matched' | 'exited' | 'timeout' | 'succeeded'

export interface MonitorResolveInfo {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  reason: MonitorReason
  detail: string
  // 'shell' = watching a background shell (targetId is a shell id);
  // 'poll'  = polling a command (targetId is the command string).
  kind: 'shell' | 'poll'
}
export interface MonitorWaitResult { status: 'resolved' | 'pending' | 'aborted'; info?: MonitorResolveInfo; id: string }

export interface MonitorStartOpts {
  untilRegex?: string
  untilExit?: boolean | number
  timeoutMs?: number
}

export interface MonitorStoreOpts {
  procs: BackgroundProcessStore
  getSessionId: (agentId: string) => string
  onResolve: (info: MonitorResolveInfo) => void
  maxPerAgent?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  untilRegex?: RegExp
  untilExit?: boolean | number
  until: string
  status: 'watching' | 'resolved'
  onData: (e: BgDataEvent) => void
  onExit: (e: BgExitEvent) => void
  timer?: ReturnType<typeof setTimeout>
  key: string
}

const DEFAULT_MAX_PER_AGENT = 10
const DETAIL_CAP = 500

export class MonitorStore {
  private entries = new Map<string, Entry>()
  private waiters = new Map<string, Set<(result: MonitorWaitResult) => void>>()
  private consumed = new Set<string>()
  private resolved = new Map<string, MonitorResolveInfo>()

  private key(agentId: string, targetId: string, opts: MonitorStartOpts): string {
    return `${agentId}\0${targetId}\0${opts.untilRegex ?? ''}\0${opts.untilExit === undefined ? 'unset' : String(opts.untilExit)}`
  }

  constructor(private opts: MonitorStoreOpts) {}

  private get maxPerAgent(): number { return this.opts.maxPerAgent ?? DEFAULT_MAX_PER_AGENT }

  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'watching') n++
    return n
  }

  list(agentId: string): { id: string; targetId: string; until: string }[] {
    const out: { id: string; targetId: string; until: string }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'watching') out.push({ id: e.id, targetId: e.targetId, until: e.until })
    }
    return out
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

  start(agentId: string, targetId: string, opts: MonitorStartOpts): { id: string; reused: boolean; pending: boolean } | { error: string } {
    if (opts.untilRegex === undefined && opts.untilExit === undefined) {
      return { error: 'monitor: provide at least one of until_regex or until_exit' }
    }
    let untilRegex: RegExp | undefined
    if (opts.untilRegex !== undefined) {
      try { untilRegex = new RegExp(opts.untilRegex) } catch { return { error: 'monitor: invalid until_regex' } }
    }
    const key = this.key(agentId, targetId, opts)
    for (const existing of this.entries.values()) {
      if (existing.status === 'watching' && existing.key === key) return { id: existing.id, reused: true, pending: true }
    }
    const target = this.opts.procs.inspect(targetId)
    if (!target) return { error: `monitor: unknown background shell id "${targetId}"` }
    if (this.count(agentId) >= this.maxPerAgent) {
      return { error: `monitor: too many monitors (max ${this.maxPerAgent})` }
    }
    const id = randomUUID().slice(0, 8)
    const sessionId = this.opts.getSessionId(agentId)

    // Target already gone: resolve immediately as exited.
    if (target.status === 'exited') {
      this.publish({ id, agentId, sessionId, targetId, reason: 'exited', detail: `exit code ${target.exitCode}`, kind: 'shell' })
      return { id, reused: false, pending: false }
    }

    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      opts.untilExit !== undefined ? 'exit' : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')
    const entry: Entry = {
      id, agentId, sessionId, targetId, untilRegex, untilExit: opts.untilExit, until,
      status: 'watching', onData: () => {}, onExit: () => {}, key
    }
    entry.onData = (e: BgDataEvent) => {
      if (e.id !== targetId || entry.status !== 'watching' || !entry.untilRegex) return
      for (const line of e.chunk.split('\n')) {
        if (entry.untilRegex.test(line)) { this.resolve(entry, 'matched', line.trim().slice(0, DETAIL_CAP)); return }
      }
    }
    entry.onExit = (e: BgExitEvent) => {
      if (e.id !== targetId || entry.status !== 'watching') return
      this.resolve(entry, 'exited', `exit code ${e.exitCode}`)
    }
    this.opts.procs.on('data', entry.onData)
    this.opts.procs.on('exit', entry.onExit)
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const ms = opts.timeoutMs
      entry.timer = setTimeout(() => this.resolve(entry, 'timeout', `${Math.round(ms / 1000)}s`), ms)
      entry.timer.unref?.()
    }
    this.entries.set(id, entry)

    // Close the subscribe gap: a matching line may already be in the buffer
    // (printed before we attached the listener). Re-inspect after subscribing.
    if (untilRegex) {
      const current = this.opts.procs.inspect(targetId)
      for (const line of (current?.buffer ?? '').split('\n')) {
        if (untilRegex.test(line)) { this.resolve(entry, 'matched', line.trim().slice(0, DETAIL_CAP)); break }
      }
    }
    return { id, reused: false, pending: this.entries.has(id) }
  }

  private resolve(entry: Entry, reason: MonitorReason, detail: string): void {
    if (entry.status !== 'watching') return
    this.teardown(entry)
    const info: MonitorResolveInfo = {
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.targetId, reason, detail, kind: 'shell'
    }
    this.publish(info)
  }

  private publish(info: MonitorResolveInfo): void {
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
    this.opts.procs.removeListener('data', entry.onData)
    this.opts.procs.removeListener('exit', entry.onExit)
    if (entry.timer) clearTimeout(entry.timer)
    this.entries.delete(entry.id)
  }

  cancelAllForAgent(agentId: string): void {
    for (const e of [...this.entries.values()]) if (e.agentId === agentId) this.teardown(e)
  }

  cancelAll(): void {
    for (const e of [...this.entries.values()]) this.teardown(e)
  }
}

export interface MonitorResolveDeps {
  appendMessage: (sessionId: string, text: string) => void
  notify?: (info: MonitorResolveInfo) => void
  isRunning: (agentId: string) => boolean
  wake: (agentId: string, text: string) => void
}

export function monitorResolveMessage(info: MonitorResolveInfo): string {
  const head = info.reason === 'matched' ? `matched: ${info.detail}`
    : info.reason === 'exited' ? `shell exited (${info.detail})`
    : info.reason === 'succeeded' ? `command succeeded (${info.detail})`
    : `timed out after ${info.detail}`
  if (info.kind === 'poll') {
    return `[monitor ${info.id}] command \`${info.targetId}\` — ${head}.`
  }
  return `[monitor ${info.id}] shell ${info.targetId} — ${head}. ` +
    `Read output with bash_output({ id: "${info.targetId}" }).`
}

export function handleMonitorResolve(info: MonitorResolveInfo, deps: MonitorResolveDeps): void {
  deps.appendMessage(info.sessionId, monitorResolveMessage(info))
  deps.notify?.(info)
  if (!deps.isRunning(info.agentId)) {
    deps.wake(
      info.agentId,
      `A monitor (${info.id}) resolved (${info.reason}). Read the shell's output with bash_output if relevant and continue.`
    )
  }
}
