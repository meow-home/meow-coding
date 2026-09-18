import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ChatTranscriptItem, TodoItem, UsageSummary } from '../../shared/types'
import { titleFrom, DEFAULT_SESSION_TITLE, type StoredSession } from './session'
import { serializeSessionJsonl } from './session-records'
import { encodeProjectPath } from '../project-encode'
import { writeFileAtomic } from '../atomic-write'
import type { SessionIndexEntry } from './session-file-store'

type RawSession = Partial<StoredSession> & Record<string, unknown>

function titleFromItems(items: ChatTranscriptItem[]): string {
  for (const item of items) {
    if (item.kind === 'message' && item.message.role === 'user') {
      const t = titleFrom(item.message.displayText ?? item.message.text)
      if (t !== DEFAULT_SESSION_TITLE) return t
    }
  }
  return DEFAULT_SESSION_TITLE
}

function normalizeLegacy(raw: RawSession): StoredSession {
  const items: ChatTranscriptItem[] = Array.isArray(raw.items) ? (raw.items as ChatTranscriptItem[]) : []
  const id = String(raw.id ?? '')
  return {
    id,
    agentId: String(raw.agentId ?? raw.id ?? ''),
    projectPath: String(raw.projectPath ?? ''),
    title: typeof raw.title === 'string' && raw.title ? raw.title : titleFromItems(items),
    items,
    todos: Array.isArray(raw.todos) ? (raw.todos as TodoItem[]) : [],
    usage: (raw.usage as UsageSummary) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : ((raw.updatedAt as number) ?? Date.now()),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export function migrateSessions(rootDir: string): { migrated: number; skipped: boolean } {
  const flag = path.join(rootDir, '.sessions-migrated-v1')
  if (existsSync(flag)) return { migrated: 0, skipped: true }

  const legacyFile = path.join(rootDir, 'sessions.json')
  if (!existsSync(legacyFile)) {
    writeFileSync(flag, String(Date.now()))
    return { migrated: 0, skipped: false }
  }

  let raw: RawSession[]
  try {
    const parsed = JSON.parse(readFileSync(legacyFile, 'utf-8'))
    raw = Array.isArray(parsed) ? parsed : []
  } catch {
    raw = []
  }

  const index: SessionIndexEntry[] = []
  for (const entry of raw) {
    const s = normalizeLegacy(entry)
    if (!s.id) continue
    const file = path.join(rootDir, 'projects', encodeProjectPath(s.projectPath), `${s.id}.jsonl`)
    writeFileAtomic(file, serializeSessionJsonl(s))
    index.push({
      id: s.id, agentId: s.agentId, projectPath: s.projectPath, title: s.title,
      messageCount: s.items.length, createdAt: s.createdAt, updatedAt: s.updatedAt, usage: s.usage
    })
  }
  writeFileAtomic(path.join(rootDir, 'sessions-index.json'), JSON.stringify(index, null, 2))

  // Keep the old file as a backup rather than deleting it.
  let bak = path.join(rootDir, 'sessions.json.migrated-bak')
  if (existsSync(bak)) bak = `${bak}-${Date.now()}`
  try { renameSync(legacyFile, bak) } catch { /* best effort */ }

  writeFileSync(flag, String(Date.now()))
  return { migrated: index.length, skipped: false }
}
