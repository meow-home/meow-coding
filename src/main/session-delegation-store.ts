import { randomUUID } from 'node:crypto'
import type { JsonStore } from './json-store'
import type { DelegationStatus, SessionDelegation } from '../shared/types'

/**
 * Path canonicalization for cross-process/project identity: on Windows the
 * same disk location can be addressed with different drive-letter case or
 * separator styles, so compare on a lowercase, forward-slash key. Non-Windows
 * platforms are left case-sensitive.
 */
function normalizeProjectPath(p: string): string {
  if (process.platform === 'win32') {
    return p.replace(/\\/g, '/').toLowerCase()
  }
  return p.replace(/\\/g, '/')
}

export interface CreateDelegationRecord {
  id: string
  projectPath: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string
  targetBusyAtCreation: boolean
  task: string
  sourceKind?: 'session' | 'external'
  externalClient?: 'claude'
  planKey?: string
}

export interface TransitionPatch {
  startedAt?: number
  finishedAt?: number
  result?: string
  resultTruncated?: boolean
  error?: string
  touchedFiles?: string[]
  deliveredAt?: number
  wakeAt?: number
}

const ALLOWED_TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['waiting_for_input', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting_for_input: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: []
}

/** Terminal statuses; no further status transition is allowed once reached. */
const TERMINAL: ReadonlySet<DelegationStatus> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

const RETENTION_MS = 30 * 86_400_000

function clone(d: SessionDelegation): SessionDelegation {
  return { ...d, touchedFiles: d.touchedFiles ? [...d.touchedFiles] : undefined }
}

export class SessionDelegationStore {
  private records: SessionDelegation[] | null = null
  private lastUpdatedAt = 0

  constructor(
    private store: JsonStore<SessionDelegation>,
    private now: () => number = Date.now
  ) {}

  private all(): SessionDelegation[] {
    if (!this.records) this.records = this.store.load()
    return this.records
  }

  private save(records: SessionDelegation[]): void {
    this.records = records
    this.store.save(records)
  }

  private nextUpdatedAt(): number {
    const now = this.now()
    if (now > this.lastUpdatedAt) this.lastUpdatedAt = now
    else this.lastUpdatedAt += 1
    return this.lastUpdatedAt
  }

  private normalize(raw: SessionDelegation): SessionDelegation {
    return {
      ...raw,
      projectPath: normalizeProjectPath(raw.projectPath),
      touchedFiles: raw.touchedFiles ? [...raw.touchedFiles] : undefined,
      status: (ALLOWED_TRANSITIONS[raw.status] ? raw.status : 'queued') as DelegationStatus
    }
  }

  load(): Promise<void> {
    // Parse (normalize) the raw disk records once. `this.records` is set in
    // `load()`; re-normalizing here keeps callers safe if a reload happens.
    this.records = this.store.load().map(r => this.normalize(r))
    return Promise.resolve()
  }

  create(input: CreateDelegationRecord): SessionDelegation {
    const now = this.now()
    const record: SessionDelegation = {
      id: input.id,
      projectPath: normalizeProjectPath(input.projectPath),
      sourceAgentId: input.sourceAgentId,
      sourceSessionId: input.sourceSessionId,
      targetAgentId: input.targetAgentId,
      targetSessionId: input.targetSessionId,
      task: input.task,
      status: 'queued',
      revision: 1,
      targetBusyAtCreation: input.targetBusyAtCreation,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
      ...(input.externalClient !== undefined ? { externalClient: input.externalClient } : {}),
      ...(input.planKey !== undefined ? { planKey: input.planKey } : {})
    }
    this.save([...this.all(), record])
    return clone(record)
  }

  get(id: string): SessionDelegation | undefined {
    const found = this.all().find(r => r.id === id)
    return found ? clone(found) : undefined
  }

  list(filter?: {
    projectPath?: string
    sourceAgentId?: string
    targetAgentId?: string
  }): SessionDelegation[] {
    let items = this.all()
    if (filter?.projectPath) {
      const key = normalizeProjectPath(filter.projectPath)
      items = items.filter(r => r.projectPath === key)
    }
    if (filter?.sourceAgentId) {
      items = items.filter(r => r.sourceAgentId === filter.sourceAgentId)
    }
    if (filter?.targetAgentId) {
      items = items.filter(r => r.targetAgentId === filter.targetAgentId)
    }
    return items.map(clone)
  }

  transition(
    id: string,
    expectedRevision: number,
    status: DelegationStatus,
    patch?: TransitionPatch
  ): SessionDelegation | undefined {
    const all = this.all()
    const idx = all.findIndex(r => r.id === id)
    if (idx < 0) return undefined
    const record = all[idx]
    if (record.revision !== expectedRevision) return undefined
    const allowed = ALLOWED_TRANSITIONS[record.status]
    if (!allowed || !allowed.includes(status)) return undefined
    const next: SessionDelegation = {
      ...clone(record),
      status,
      revision: record.revision + 1,
      updatedAt: this.nextUpdatedAt(),
      ...(patch?.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch?.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      ...(patch?.result !== undefined ? { result: patch.result } : {}),
      ...(patch?.resultTruncated !== undefined ? { resultTruncated: patch.resultTruncated } : {}),
      ...(patch?.error !== undefined ? { error: patch.error } : {}),
      ...(patch?.touchedFiles !== undefined ? { touchedFiles: [...patch.touchedFiles] } : {})
    }
    all[idx] = next
    this.save(all)
    return clone(next)
  }

  /** Post-terminal metadata mutation: only for `deliveredAt`. */
  markDelivered(id: string, expectedRevision: number, deliveredAt: number): SessionDelegation | undefined {
    return this.markMetadata(id, expectedRevision, { deliveredAt })
  }

  /** Post-terminal metadata mutation: only for `wakeAt`. */
  markWoken(id: string, expectedRevision: number, wakeAt: number): SessionDelegation | undefined {
    return this.markMetadata(id, expectedRevision, { wakeAt })
  }

  private markMetadata(
    id: string,
    expectedRevision: number,
    patch: { deliveredAt?: number; wakeAt?: number }
  ): SessionDelegation | undefined {
    const all = this.all()
    const idx = all.findIndex(r => r.id === id)
    if (idx < 0) return undefined
    const record = all[idx]
    if (record.revision !== expectedRevision) return undefined
    if (!TERMINAL.has(record.status)) return undefined
    const next: SessionDelegation = {
      ...clone(record),
      ...patch,
      revision: record.revision + 1,
      updatedAt: this.nextUpdatedAt()
    }
    all[idx] = next
    this.save(all)
    return clone(next)
  }

  async recoverInterrupted(): Promise<SessionDelegation[]> {
    const all = this.all().filter(r => r.status === 'running' || r.status === 'waiting_for_input')
    return all.map(clone)
  }

  async purgeTerminalBefore(cutoff: number): Promise<string[]> {
    const all = this.all()
    const kept: SessionDelegation[] = []
    const purged: string[] = []
    for (const r of all) {
      if (TERMINAL.has(r.status)) {
        const finished = r.finishedAt ?? r.updatedAt
        if (finished < cutoff) {
          purged.push(r.id)
          continue
        }
      }
      kept.push(r)
    }
    if (purged.length > 0) this.save(kept)
    return purged
  }
}

export { normalizeProjectPath, RETENTION_MS }
