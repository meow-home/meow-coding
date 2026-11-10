import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CliSessionMeta, CliSessionStatus, CliTranscriptItem } from '../../shared/types'
import { writeFileAtomic } from '../atomic-write'

export const TRANSCRIPT_MAX_BYTES = 5 * 1024 * 1024 // 5 MiB
export const TRANSCRIPT_TRUNCATE_BYTES = 4 * 1024 * 1024 // 4 MiB

export function assertValidSessionId(id: string): void {
  if (!id || typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id) || id.includes('..')) {
    throw new Error(`[meow] Invalid session id: "${id}"`)
  }
}

export interface CliSessionStoreOptions {
  maxTranscriptBytes?: number
  truncateTranscriptBytes?: number
  now?: () => number
}

export class CliSessionStore {
  private readonly indexPath: string
  private readonly transcriptsDir: string
  private readonly maxTranscriptBytes: number
  private readonly truncateTranscriptBytes: number
  private readonly now: () => number
  private sessions: CliSessionMeta[] | null = null

  constructor(filePathOrUserDataDir: string, opts?: CliSessionStoreOptions) {
    if (filePathOrUserDataDir.endsWith('.json')) {
      this.indexPath = filePathOrUserDataDir
      this.transcriptsDir = path.join(path.dirname(filePathOrUserDataDir), 'cli-sessions')
    } else {
      this.indexPath = path.join(filePathOrUserDataDir, 'cli-sessions.json')
      this.transcriptsDir = path.join(filePathOrUserDataDir, 'cli-sessions')
    }
    this.maxTranscriptBytes = opts?.maxTranscriptBytes ?? TRANSCRIPT_MAX_BYTES
    this.truncateTranscriptBytes = opts?.truncateTranscriptBytes ?? TRANSCRIPT_TRUNCATE_BYTES
    this.now = opts?.now ?? Date.now
  }

  getIndexPath(): string {
    return this.indexPath
  }

  getTranscriptsDir(): string {
    return this.transcriptsDir
  }

  getTranscriptPath(id: string): string {
    assertValidSessionId(id)
    return path.join(this.transcriptsDir, `${id}.jsonl`)
  }

  private load(): CliSessionMeta[] {
    if (this.sessions) return this.sessions
    if (!existsSync(this.indexPath)) {
      this.sessions = []
      return this.sessions
    }
    try {
      const raw = readFileSync(this.indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.sessions = parsed
      } else if (parsed && Array.isArray(parsed.sessions)) {
        this.sessions = parsed.sessions
      } else {
        this.sessions = []
      }
    } catch {
      try {
        renameSync(this.indexPath, `${this.indexPath}.corrupt`)
      } catch {
        /* best effort */
      }
      this.sessions = []
    }
    return this.sessions ?? []
  }

  private save(): void {
    const list = this.sessions ?? []
    writeFileAtomic(this.indexPath, JSON.stringify(list, null, 2))
  }

  list(projectPath?: string): CliSessionMeta[] {
    const sessions = this.load()
    if (!projectPath) {
      return sessions.map(s => ({ ...s }))
    }
    return sessions.filter(s => s.projectPath === projectPath).map(s => ({ ...s }))
  }

  get(id: string): CliSessionMeta | null {
    assertValidSessionId(id)
    const session = this.load().find(s => s.id === id)
    return session ? { ...session } : null
  }

  create(meta: CliSessionMeta): CliSessionMeta {
    assertValidSessionId(meta.id)
    const sessions = this.load()
    if (sessions.some(s => s.id === meta.id)) {
      throw new Error(`[meow] Session already exists with id: ${meta.id}`)
    }
    const item: CliSessionMeta = { ...meta }
    sessions.push(item)
    this.save()
    return { ...item }
  }

  update(id: string, patch: Partial<CliSessionMeta>): CliSessionMeta {
    assertValidSessionId(id)
    const sessions = this.load()
    const index = sessions.findIndex(s => s.id === id)
    if (index === -1) {
      throw new Error(`[meow] Session not found with id: ${id}`)
    }
    const current = sessions[index]
    const updated: CliSessionMeta = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: patch.updatedAt ?? this.now()
    }
    sessions[index] = updated
    this.save()
    return { ...updated }
  }

  rename(id: string, title: string): CliSessionMeta {
    return this.update(id, { title })
  }

  setStatus(id: string, status: CliSessionStatus): CliSessionMeta {
    return this.update(id, { status })
  }

  delete(id: string): boolean {
    assertValidSessionId(id)
    const sessions = this.load()
    const index = sessions.findIndex(s => s.id === id)
    if (index === -1) {
      return false
    }
    sessions.splice(index, 1)
    this.save()
    const transcriptPath = this.getTranscriptPath(id)
    if (existsSync(transcriptPath)) {
      try {
        rmSync(transcriptPath, { force: true })
      } catch {
        /* best effort */
      }
    }
    return true
  }

  appendItem(id: string, item: CliTranscriptItem): void {
    assertValidSessionId(id)
    if (!this.get(id)) {
      return
    }
    try {
      if (!existsSync(this.transcriptsDir)) {
        mkdirSync(this.transcriptsDir, { recursive: true })
      }
      const filePath = this.getTranscriptPath(id)
      const line = JSON.stringify(item) + '\n'
      const lineBytes = Buffer.byteLength(line, 'utf8')

      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath)
          if (stat.size + lineBytes > this.maxTranscriptBytes) {
            const buf = readFileSync(filePath)
            if (buf.length > this.truncateTranscriptBytes) {
              let sliced = buf.subarray(buf.length - this.truncateTranscriptBytes)
              const firstNl = sliced.indexOf(0x0a)
              if (firstNl !== -1) {
                sliced = sliced.subarray(firstNl + 1)
              }
              writeFileSync(filePath, sliced)
            }
            const notice: CliTranscriptItem = {
              kind: 'notice',
              level: 'info',
              text: 'Transcript was truncated to preserve size limit',
              at: item.at ?? this.now()
            }
            appendFileSync(filePath, JSON.stringify(notice) + '\n', 'utf8')
          }
        } catch {
          /* best effort on rotation */
        }
      }

      appendFileSync(filePath, line, 'utf8')
    } catch {
      /* never throw on missing transcript file or append error */
    }
  }

  readTranscript(id: string, limit?: number): CliTranscriptItem[] {
    assertValidSessionId(id)
    const filePath = this.getTranscriptPath(id)
    if (!existsSync(filePath)) {
      return []
    }
    try {
      const raw = readFileSync(filePath, 'utf8')
      const lines = raw.split(/\r?\n/)
      const items: CliTranscriptItem[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          items.push(JSON.parse(trimmed) as CliTranscriptItem)
        } catch {
          /* ignore corrupted line */
        }
      }
      if (limit !== undefined && limit > 0) {
        return items.slice(-limit)
      }
      return items
    } catch {
      return []
    }
  }

  prune(retentionDays: number): number {
    if (retentionDays <= 0) return 0
    const sessions = this.load()
    const cutoff = this.now() - retentionDays * 24 * 60 * 60 * 1000
    const kept: CliSessionMeta[] = []
    let pruned = 0

    for (const session of sessions) {
      if (session.status === 'running') {
        kept.push(session)
        continue
      }
      const lastActivity = session.updatedAt || session.createdAt
      if (lastActivity < cutoff) {
        pruned++
        const transcriptPath = this.getTranscriptPath(session.id)
        if (existsSync(transcriptPath)) {
          try {
            rmSync(transcriptPath, { force: true })
          } catch {
            /* best effort */
          }
        }
      } else {
        kept.push(session)
      }
    }

    if (pruned > 0) {
      this.sessions = kept
      this.save()
    }
    return pruned
  }
}
