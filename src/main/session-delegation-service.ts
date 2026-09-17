import { randomUUID } from 'node:crypto'
import type { SessionDelegationStore } from './session-delegation-store'
import type { SessionDelegation, DelegationStatus } from '../shared/types'
import type {
  AgentRunContext,
  AgentTurnResult,
  DelegatedTurnInput,
  DelegationResultInput
} from './agent/run-context'

export interface DelegationAgent {
  agentId: string
  name: string
  projectPath: string
  sessionId: string
}

export interface DelegationRuntime {
  resolveAgent(agentId: string): DelegationAgent | undefined
  isBusy(agentId: string): boolean
  runDelegatedTurn(input: DelegatedTurnInput): Promise<AgentTurnResult>
  appendResult(input: DelegationResultInput): Promise<void>
  wakeSource(input: DelegationResultInput): Promise<void>
}

export interface CreateDelegationInput {
  sourceRun: AgentRunContext
  targetAgentId: string
  task: string
}

export interface SessionDelegationServiceDeps {
  store: SessionDelegationStore
  runtime: DelegationRuntime
  now?: () => number
  id?: () => string
  onChanged?: (delegation: SessionDelegation) => void
}

const TASK_MAX_BYTES = 32 * 1024
const RESULT_MAX_BYTES = 64 * 1024
const MAX_NONTERMINAL_PER_TARGET = 5
const RETENTION_MS = 30 * 86_400_000

const TERMINAL: ReadonlySet<DelegationStatus> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

interface Waiter {
  promise: Promise<void>
  resolve: () => void
}

/** Truncates a string to fit `maxBytes` without splitting a UTF-8 code point. */
function truncateUtf8(input: string, maxBytes: number): { text: string | undefined; truncated: boolean } {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return { text: input, truncated: false }
  let lo = 0
  let hi = input.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (Buffer.byteLength(input.slice(0, mid), 'utf8') <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return { text: input.slice(0, lo), truncated: true }
}

function statusToReason(status: DelegationStatus): 'completed' | 'failed' | 'cancelled' | 'interrupted' {
  switch (status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'interrupted'
  }
}

export class SessionDelegationService {
  private store: SessionDelegationStore
  private runtime: DelegationRuntime
  private now: () => number
  private id: () => string
  private onChanged?: (d: SessionDelegation) => void
  private suspended = true
  private pumping = new Set<string>()
  private waiters = new Map<string, Waiter>()
  private pumpPromises = new Set<Promise<void>>()

  constructor(deps: SessionDelegationServiceDeps) {
    this.store = deps.store
    this.runtime = deps.runtime
    this.now = deps.now ?? (() => Date.now())
    this.id = deps.id ?? (() => randomUUID())
    this.onChanged = deps.onChanged
  }

  private emit(d: SessionDelegation): void {
    this.onChanged?.(d)
  }

  /** Store backing the service, for observers. */
  getStore(): SessionDelegationStore {
    return this.store
  }

  create(input: CreateDelegationInput): SessionDelegation {
    const { sourceRun } = input
    if (sourceRun.origin !== 'user') {
      throw new Error('[meow] Only a user-origin run may delegate.')
    }
    const source = this.runtime.resolveAgent(sourceRun.agentId)
    if (!source) throw new Error(`[meow] Source session does not exist: ${sourceRun.agentId}`)
    const target = this.runtime.resolveAgent(input.targetAgentId)
    if (!target) throw new Error(`[meow] Delegation target session does not exist: ${input.targetAgentId}`)
    if (target.agentId === sourceRun.agentId) throw new Error('[meow] A session cannot delegate to itself.')
    if (source.projectPath !== target.projectPath) {
      throw new Error('[meow] Delegation is only allowed between sessions in the same project.')
    }
    const task = (input.task ?? '').trim()
    if (!task) throw new Error('[meow] Delegation task must not be empty.')
    if (Buffer.byteLength(task, 'utf8') > TASK_MAX_BYTES) {
      throw new Error(`[meow] Delegation task exceeds the ${TASK_MAX_BYTES / 1024} KiB limit.`)
    }
    const active = this.store.list({ targetAgentId: target.agentId })
      .filter(d => d.status === 'queued' || d.status === 'running' || d.status === 'waiting_for_input')
    if (active.length >= MAX_NONTERMINAL_PER_TARGET) {
      throw new Error(`[meow] Too many queued delegations for this session (max ${MAX_NONTERMINAL_PER_TARGET}).`)
    }

    const record = this.store.create({
      id: this.id(),
      projectPath: target.projectPath,
      sourceAgentId: sourceRun.agentId,
      sourceSessionId: sourceRun.sessionId,
      targetAgentId: target.agentId,
      targetSessionId: target.sessionId,
      targetBusyAtCreation: this.runtime.isBusy(target.agentId),
      task
    })
    this.emit(record)
    this.notifyAgentAvailable(target.agentId)
    return record
  }

  /** A target became available; wake its waiting pump loop or start one. */
  notifyAgentAvailable(agentId: string): void {
    const waiter = this.waiters.get(agentId)
    if (waiter) {
      this.waiters.delete(agentId)
      waiter.resolve()
      return
    }
    if (!this.suspended && !this.pumping.has(agentId) && this.hasQueuedFor(agentId)) {
      this.pumpTarget(agentId)
    }
  }

  private hasQueuedFor(agentId: string): boolean {
    return this.store.list({ targetAgentId: agentId }).some(d => d.status === 'queued')
  }

  private pumpTarget(targetAgentId: string): void {
    this.pumping.add(targetAgentId)
    const run = this.driveTarget(targetAgentId)
    this.pumpPromises.add(run)
    run.finally(() => this.pumpPromises.delete(run))
  }

  private async driveTarget(targetAgentId: string): Promise<void> {
    try {
      while (!this.suspended) {
        const next = this.selectNextQueued(targetAgentId)
        if (!next) break
        const target = this.runtime.resolveAgent(targetAgentId)
        if (!target) break
        const source = this.runtime.resolveAgent(next.sourceAgentId)
        if (!source || source.projectPath !== target.projectPath) {
          const failed = this.store.transition(next.id, next.revision, 'failed', {
            finishedAt: this.now(),
            error: '[meow] A participant session is no longer available.'
          })
          if (failed) this.emit(failed)
          continue
        }
        if (this.runtime.isBusy(targetAgentId)) {
          await this.waitForAvailable(targetAgentId)
          continue
        }
        await this.runQueued(next)
      }
    } finally {
      // New work arriving after this point is picked up by `notifyAgentAvailable`
      // (it sees `pumping` no longer contains the target).
      this.pumping.delete(targetAgentId)
    }
  }

  private waitForAvailable(agentId: string): Promise<void> {
    const existing = this.waiters.get(agentId)
    if (existing) return existing.promise
    let resolve!: () => void
    const promise = new Promise<void>(r => { resolve = r })
    this.waiters.set(agentId, { promise, resolve })
    return promise
  }

  private selectNextQueued(targetAgentId: string): SessionDelegation | undefined {
    return this.store.list({ targetAgentId })
      .filter(d => d.status === 'queued')
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  }

  private async runQueued(record: SessionDelegation): Promise<void> {
    const running = this.store.transition(record.id, record.revision, 'running', { startedAt: this.now() })
    if (!running) return
    this.emit(running)
    const result = await this.runtime.runDelegatedTurn({
      delegationId: running.id,
      sourceAgentId: running.sourceAgentId,
      sourceName: this.runtime.resolveAgent(running.sourceAgentId)?.name ?? running.sourceAgentId,
      targetAgentId: running.targetAgentId,
      targetSessionId: running.targetSessionId,
      task: running.task
    })
    const status = result.reason
    // Re-read the current record: the run may have passed through
    // `waiting_for_input` (a prompt answer) while it was executing, so the
    // terminal transition must start from the latest revision, not the one
    // we captured at `running`.
    const current = this.store.get(running.id)
    const fromStatus = current && (current.status === 'running' || current.status === 'waiting_for_input')
      ? current
      : running
    const truncated = result.finalText !== undefined
      ? truncateUtf8(result.finalText, RESULT_MAX_BYTES)
      : { text: undefined, truncated: false }
    const terminal = this.store.transition(fromStatus.id, fromStatus.revision, status, {
      finishedAt: this.now(),
      ...(truncated.text !== undefined ? { result: truncated.text } : {}),
      ...(truncated.truncated ? { resultTruncated: true } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      touchedFiles: result.touchedFiles
    })
    if (terminal) {
      this.emit(terminal)
      await this.finishTerminal(terminal)
    }
  }

  private async finishTerminal(record: SessionDelegation): Promise<void> {
    const input: DelegationResultInput = {
      delegationId: record.id,
      sourceAgentId: record.sourceAgentId,
      sourceSessionId: record.sourceSessionId,
      targetAgentId: record.targetAgentId,
      targetName: this.runtime.resolveAgent(record.targetAgentId)?.name ?? record.targetAgentId,
      status: statusToReason(record.status),
      ...(record.result !== undefined ? { result: record.result } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
      touchedFiles: record.touchedFiles ?? []
    }
    // Terminal already persisted before this call. Append the idempotent
    // result message, then mark delivered, then wake the source.
    await this.runtime.appendResult(input)
    const delivered = this.store.markDelivered(record.id, record.revision, this.now())
    if (delivered) this.emit(delivered)
    if (this.runtime.resolveAgent(record.sourceAgentId)) {
      await this.runtime.wakeSource(input)
    }
  }

  /** The manager calls this just before injecting a wake into the idle source
   *  model; revision-persists `wakeAt` and returns false if already claimed. */
  async claimSourceWake(delegationId: string, wakeAt: number): Promise<boolean> {
    const record = this.store.get(delegationId)
    if (!record) return false
    if (record.wakeAt !== undefined) return false
    const claimed = this.store.markWoken(delegationId, record.revision, wakeAt)
    if (claimed) this.emit(claimed)
    return Boolean(claimed)
  }

  async notifyPromptState(delegationId: string, waiting: boolean): Promise<void> {
    const record = this.store.get(delegationId)
    if (!record) return
    if (waiting && record.status === 'running') {
      const next = this.store.transition(delegationId, record.revision, 'waiting_for_input')
      if (next) this.emit(next)
    } else if (!waiting && record.status === 'waiting_for_input') {
      const next = this.store.transition(delegationId, record.revision, 'running', { startedAt: record.startedAt })
      if (next) this.emit(next)
    }
  }

  async cancelQueued(id: string): Promise<SessionDelegation> {
    const record = this.store.get(id)
    if (!record) throw new Error(`[meow] Unknown delegation: ${id}`)
    if (record.status !== 'queued') {
      throw new Error(`[meow] Only queued delegations can be cancelled (current status: ${record.status}).`)
    }
    const cancelled = this.store.transition(id, record.revision, 'cancelled', { finishedAt: this.now() })!
    this.emit(cancelled)
    return cancelled
  }

  async handleAgentRemoved(agentId: string): Promise<void> {
    for (const d of this.store.list({ targetAgentId: agentId }).filter(x => x.status === 'queued')) {
      const next = this.store.transition(d.id, d.revision, 'failed', {
        finishedAt: this.now(),
        error: '[meow] Target session was removed.'
      })
      if (next) this.emit(next)
    }
  }

  async handleProjectRemoved(projectPath: string): Promise<void> {
    for (const d of this.store.list({ projectPath }).filter(x => x.status === 'queued')) {
      const next = this.store.transition(d.id, d.revision, 'cancelled', {
        finishedAt: this.now(),
        error: '[meow] Project was removed.'
      })
      if (next) this.emit(next)
    }
  }

  /** Start the scheduler and run startup recovery. */
  async start(): Promise<void> {
    if (!this.suspended) return
    // eslint-disable-next-line no-console
    console.error('[SVC] start begin')
    this.suspended = false
    // Interrupt in-flight records and deliver once — never rerun the target task.
    for (const rec of await this.store.recoverInterrupted()) {
      const next = this.store.transition(rec.id, rec.revision, 'interrupted', { finishedAt: this.now() })
      if (next) {
        this.emit(next)
        await this.finishTerminal(next)
      }
    }
    // Redeliver terminal results missing deliveredAt; re-schedule wakes missing
    // wakeAt. Both paths are idempotent via the store's deterministic append.
    for (const rec of this.store.list().filter(d => TERMINAL.has(d.status))) {
      if (rec.deliveredAt === undefined) await this.finishTerminal(rec)
    }
    // Retention cleanup.
    await this.store.purgeTerminalBefore(this.now() - RETENTION_MS)
    // Resume queued pumping.
    for (const target of new Set(this.store.list().map(d => d.targetAgentId))) {
      if (this.hasQueuedFor(target)) this.pumpTarget(target)
    }
  }

  /** Graceful shutdown: no new scheduling; running pumps idle out. */
  suspend(): void {
    this.suspended = true
  }

  /** Awaits the scheduler until no target pump loop is still driving. */
  async flush(): Promise<void> {
    // Repeatedly await the current pump promises; a loop may re-register on
    // new work in a `finally` between two snapshots, so loop until idle.
    for (let i = 0; i < 1000; i++) {
      const current = [...this.pumpPromises]
      if (current.length === 0) break
      await Promise.all(current)
    }
  }

  getStatus(id: string): SessionDelegation | undefined {
    return this.store.get(id)
  }
}
