import { randomUUID } from 'node:crypto'
import type { MonitorInfo, MonitorKind, MonitorReason } from '@shared/types'
import type { BackgroundProcessStore, BgDataEvent, BgExitEvent } from './background-process-store'

export type { MonitorKind, MonitorReason }

export interface MonitorResolveInfo {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  reason: MonitorReason
  detail: string
  // 'shell' = watching a background shell (targetId is a shell id);
  // 'poll'  = polling a command (targetId is the command string);
  // 'delegation' = watching a sub-session delegation (targetId is the delegation
  // id), resolved by the delegation runtime instead of a process.
  kind: MonitorKind
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
  /** Fired whenever the watch list changes, so the UI can refresh on push. */
  onChange?: (agentId: string) => void
  maxPerAgent?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  label: string
  kind: 'shell' | 'delegation'
  startedAt: number
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
// Resolved watches stay visible in the task card until dismissed; cap the
// history so a long session cannot grow it without bound.
const MAX_HISTORY = 20

export class MonitorStore {
  private entries = new Map<string, Entry>()
  private waiters = new Map<string, Set<(result: MonitorWaitResult) => void>>()
  private consumed = new Set<string>()
  private resolved = new Map<string, MonitorResolveInfo>()
  private history = new Map<string, { agentId: string; info: MonitorInfo }>()

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

  /** Watching monitors only — the list `monitor.wait` and the agent see. */
  list(agentId: string): { id: string; targetId: string; until: string }[] {
    const out: { id: string; targetId: string; until: string }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'watching') out.push({ id: e.id, targetId: e.targetId, until: e.until })
    }
    return out
  }

  /** Watching monitors plus recently resolved ones, for the task card. */
  snapshot(agentId: string): MonitorInfo[] {
    const watching: MonitorInfo[] = []
    for (const e of this.entries.values()) {
      if (e.agentId !== agentId || e.status !== 'watching') continue
      watching.push({
        id: e.id, kind: e.kind, label: e.label, targetId: e.targetId, until: e.until,
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

  private remember(agentId: string, info: MonitorInfo): void {
    this.history.set(info.id, { agentId, info })
    while (this.history.size > MAX_HISTORY) {
      const oldest = this.history.keys().next().value
      if (oldest === undefined) break
      this.history.delete(oldest)
    }
  }

  wasWaitConsumed(id: string): boolean { return this.consumed.delete(id) }

  /** True when `id` is a monitor handle (watching or resolved), not a shell id. */
  has(id: string): boolean { return this.entries.has(id) || this.resolved.has(id) }

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

    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      opts.untilExit !== undefined ? 'exit' : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')

    // Target already gone: resolve immediately as exited.
    if (target.status === 'exited') {
      this.publish({ id, agentId, sessionId, targetId, reason: 'exited', detail: `exit code ${target.exitCode}`, kind: 'shell' }, target.command, until)
      return { id, reused: false, pending: false }
    }
    const entry: Entry = {
      id, agentId, sessionId, targetId, label: target.command, untilRegex, untilExit: opts.untilExit, until,
      status: 'watching', kind: 'shell', startedAt: Date.now(), onData: () => {}, onExit: () => {}, key
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
    this.opts.onChange?.(agentId)
    return { id, reused: false, pending: this.entries.has(id) }
  }

  /**
   * Registers a monitor for a condition no process reports: it stays watching
   * until `resolveExternal` is called. Used for session delegation, so a
   * sub-session can be watched with the same `monitor.wait` / list surface as a
   * background shell instead of waking the source with a chat message.
   */
  registerExternal(input: { agentId: string; targetId: string; until: string; id?: string; sessionId?: string; label?: string }): { id: string; reused: boolean } | { error: string } {
    const key = this.externalKey(input.agentId, input.targetId)
    for (const existing of this.entries.values()) {
      if (existing.status === 'watching' && existing.key === key) return { id: existing.id, reused: true }
    }
    if (this.count(input.agentId) >= this.maxPerAgent) {
      return { error: `monitor: too many monitors (max ${this.maxPerAgent})` }
    }
    // Delegation monitors reuse the delegation id so `monitor.wait` can be
    // addressed with the id the model already has from delegate_session.
    const id = input.id ?? randomUUID().slice(0, 8)
    const entry: Entry = {
      id,
      agentId: input.agentId,
      sessionId: input.sessionId ?? this.opts.getSessionId(input.agentId),
      targetId: input.targetId,
      label: input.label ?? input.targetId,
      until: input.until,
      status: 'watching',
      kind: 'delegation',
      startedAt: Date.now(),
      onData: () => {},
      onExit: () => {},
      key
    }
    this.entries.set(id, entry)
    this.opts.onChange?.(input.agentId)
    return { id, reused: false }
  }

  /** Resolves a monitor registered with `registerExternal`; false when none is watching. */
  resolveExternal(agentId: string, targetId: string, reason: MonitorReason, detail: string): boolean {
    const key = this.externalKey(agentId, targetId)
    for (const entry of [...this.entries.values()]) {
      if (entry.status === 'watching' && entry.key === key) {
        this.resolve(entry, reason, detail)
        return true
      }
    }
    return false
  }

  private externalKey(agentId: string, targetId: string): string {
    return `external\0${agentId}\0${targetId}`
  }

  private resolve(entry: Entry, reason: MonitorReason, detail: string): void {
    if (entry.status !== 'watching') return
    this.teardown(entry)
    const info: MonitorResolveInfo = {
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.targetId, reason, detail,
      kind: entry.kind === 'delegation' ? 'delegation' : 'shell'
    }
    this.publish(info, entry.label, entry.until, entry.startedAt)
  }

  private publish(info: MonitorResolveInfo, label = info.targetId, until = '', startedAt = Date.now()): void {
    this.remember(info.agentId, {
      id: info.id, kind: info.kind, label, targetId: info.targetId, until,
      status: 'resolved', reason: info.reason, detail: info.detail,
      startedAt, resolvedAt: Date.now(), sessionId: info.sessionId
    })
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
    if (entry.kind === 'shell') {
      this.opts.procs.removeListener('data', entry.onData)
      this.opts.procs.removeListener('exit', entry.onExit)
    }
    if (entry.timer) clearTimeout(entry.timer)
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
  if (info.kind === 'delegation') {
    return `[delegation ${info.targetId}] finished (${info.reason}: ${info.detail}). ` +
      `Read the result with delegate_result({ id: "${info.targetId}" }).`
  }
  return `[monitor ${info.id}] shell ${info.targetId} — ${head}. ` +
    `Read output with bash_output({ id: "${info.targetId}" }).`
}

/** Wake text for a finished delegation: a fixed instruction, never the delegated
 *  session's own output — the body is read with `delegate_result` so it reaches
 *  the model as tool data instead of user instructions. */
export function delegationWakeInstruction(delegationId: string, reason: string): string {
  return `A delegated sub-session (${delegationId}) finished (${reason}). ` +
    `Read its result with delegate_result({ id: "${delegationId}" }) and continue.`
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
