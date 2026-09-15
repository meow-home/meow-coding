// src/main/agent/session-file-store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, appendFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { UsageSummary } from '../../shared/types'
import type { StoredSession } from './session'
import { encodeProjectPath } from '../project-encode'
import { parseSessionJsonl, serializeSessionJsonl, type SessionRecord } from './session-records'
import { writeFileAtomic } from '../atomic-write'
import { migrateSessions } from './session-migrate'

export interface SessionIndexEntry {
  id: string
  agentId: string
  projectPath: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
  usage: UsageSummary
}

function summaryOf(s: StoredSession): SessionIndexEntry {
  return {
    id: s.id, agentId: s.agentId, projectPath: s.projectPath, title: s.title,
    messageCount: s.items.length, createdAt: s.createdAt, updatedAt: s.updatedAt, usage: s.usage
  }
}

export class SessionFileStore {
  private readonly projectsDir: string
  private readonly indexFile: string
  private readonly debounceMs: number
  private index: Map<string, SessionIndexEntry> | null = null
  private cache = new Map<string, StoredSession>()
  private indexTimer: ReturnType<typeof setTimeout> | null = null

  constructor(rootDir: string, opts: { debounceMs?: number } = {}) {
    this.projectsDir = path.join(rootDir, 'projects')
    this.indexFile = path.join(rootDir, 'sessions-index.json')
    this.debounceMs = opts.debounceMs ?? 0
    if (this.debounceMs > 0) process.on('exit', () => this.flush())
    // One-time move of the legacy sessions.json into per-session jsonl files.
    // Best-effort: a failure must not break store construction (app boot).
    try { migrateSessions(rootDir) } catch { /* best effort */ }
  }

  private loadIndex(): Map<string, SessionIndexEntry> {
    if (this.index) return this.index
    const map = new Map<string, SessionIndexEntry>()
    if (existsSync(this.indexFile)) {
      try {
        const parsed = JSON.parse(readFileSync(this.indexFile, 'utf-8')) as SessionIndexEntry[]
        for (const e of parsed) map.set(e.id, e)
        this.index = map
        return map
      } catch {
        try { renameSync(this.indexFile, `${this.indexFile}.corrupt`) } catch { /* best effort */ }
      }
    }
    // No (valid) index: rebuild by scanning projects/.
    this.index = this.rebuildIndex(map)
    this.scheduleIndexWrite()
    return this.index
  }

  private rebuildIndex(map: Map<string, SessionIndexEntry>): Map<string, SessionIndexEntry> {
    if (!existsSync(this.projectsDir)) return map
    for (const projDir of readdirSync(this.projectsDir)) {
      const dir = path.join(this.projectsDir, projDir)
      let files: string[]
      try { files = readdirSync(dir) } catch { continue }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        try {
          const s = parseSessionJsonl(readFileSync(path.join(dir, file), 'utf-8'))
          if (s) map.set(s.id, summaryOf(s))
        } catch { /* skip unreadable file */ }
      }
    }
    return map
  }

  protected fileFor(entry: Pick<SessionIndexEntry, 'id' | 'projectPath'>): string {
    return path.join(this.projectsDir, encodeProjectPath(entry.projectPath), `${entry.id}.jsonl`)
  }

  list(): SessionIndexEntry[] {
    return [...this.loadIndex().values()]
  }

  get(id: string): StoredSession | null {
    const cached = this.cache.get(id)
    if (cached) return cached
    const entry = this.loadIndex().get(id)
    if (!entry) return null
    try {
      const s = parseSessionJsonl(readFileSync(this.fileFor(entry), 'utf-8'))
      if (s) this.cache.set(id, s)
      return s
    } catch {
      return null
    }
  }

  // Write methods (create/append/rewrite/remove/reindex) added in Task 5.

  create(session: StoredSession): void {
    writeFileAtomic(this.fileFor(session), serializeSessionJsonl(session))
    this.cache.set(session.id, session)
    this.reindex(session)
  }

  append(id: string, records: SessionRecord[]): void {
    const entry = this.loadIndex().get(id)
    if (!entry) return
    const text = records.map(r => JSON.stringify(r)).join('\n') + '\n'
    mkdirSync(path.dirname(this.fileFor(entry)), { recursive: true })
    appendFileSync(this.fileFor(entry), text)
  }

  rewrite(session: StoredSession): void {
    writeFileAtomic(this.fileFor(session), serializeSessionJsonl(session))
    this.cache.set(session.id, session)
    this.reindex(session)
  }

  reindex(session: StoredSession): void {
    this.loadIndex().set(session.id, summaryOf(session))
    this.scheduleIndexWrite()
  }

  remove(id: string): void {
    const index = this.loadIndex()
    const entry = index.get(id)
    if (entry) {
      try { rmSync(this.fileFor(entry), { force: true }) } catch { /* best effort */ }
    }
    index.delete(id)
    this.cache.delete(id)
    this.scheduleIndexWrite()
  }

  private scheduleIndexWrite(): void {
    if (this.debounceMs <= 0) { this.writeIndex(); return }
    if (!this.indexTimer) this.indexTimer = setTimeout(() => this.flush(), this.debounceMs)
  }

  private writeIndex(): void {
    if (!this.index) return
    try { writeFileAtomic(this.indexFile, JSON.stringify([...this.index.values()], null, 2)) } catch { /* best effort */ }
  }

  flush(): void {
    if (this.indexTimer) { clearTimeout(this.indexTimer); this.indexTimer = null }
    this.writeIndex()
  }
}
