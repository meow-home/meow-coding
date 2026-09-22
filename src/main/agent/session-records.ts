import { randomUUID } from 'node:crypto'
import type { ChatMessage, ToolCallData, TodoItem, UsageSummary } from '../../shared/types'
import type { StoredSession } from './session'

export type SessionRecord =
  | { type: 'meta'; v: 1; sessionId: string; agentId: string; projectPath: string; title: string; createdAt: number }
  | { type: 'message'; uuid: string; parentUuid: string | null; ts: number; message: ChatMessage }
  | { type: 'tool'; uuid: string; parentUuid: string | null; ts: number; tool: ToolCallData }
  | { type: 'title'; ts: number; title: string }
  | { type: 'todos'; ts: number; todos: TodoItem[] }
  | { type: 'usage'; ts: number; usage: UsageSummary }

export function sessionToRecords(s: StoredSession): SessionRecord[] {
  const records: SessionRecord[] = [
    { type: 'meta', v: 1, sessionId: s.id, agentId: s.agentId, projectPath: s.projectPath, title: s.title, createdAt: s.createdAt }
  ]
  let parent: string | null = null
  for (const item of s.items) {
    const uuid = randomUUID()
    if (item.kind === 'message') {
      records.push({ type: 'message', uuid, parentUuid: parent, ts: item.message.createdAt, message: item.message })
    } else {
      records.push({ type: 'tool', uuid, parentUuid: parent, ts: s.updatedAt, tool: item.tool })
    }
    parent = uuid
  }
  records.push({ type: 'title', ts: s.updatedAt, title: s.title })
  records.push({ type: 'todos', ts: s.updatedAt, todos: s.todos })
  records.push({ type: 'usage', ts: s.updatedAt, usage: s.usage })
  return records
}

export function serializeSessionJsonl(s: StoredSession): string {
  return sessionToRecords(s).map(r => JSON.stringify(r)).join('\n') + '\n'
}

export function parseSessionJsonl(text: string): StoredSession | null {
  const lines = text.split('\n')
  let meta: Extract<SessionRecord, { type: 'meta' }> | null = null
  const items: StoredSession['items'] = []
  let title: string | null = null
  let todos: TodoItem[] = []
  let usage: UsageSummary = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  let lastTs = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: SessionRecord
    try {
      rec = JSON.parse(trimmed) as SessionRecord
    } catch {
      // A truncated final line from a crash mid-append: skip it.
      continue
    }
    switch (rec.type) {
      case 'meta': meta = rec; break
      case 'message': items.push({ kind: 'message', message: rec.message }); if (rec.ts > lastTs) lastTs = rec.ts; break
      case 'tool': items.push({ kind: 'tool', tool: rec.tool }); if (rec.ts > lastTs) lastTs = rec.ts; break
      case 'title': title = rec.title; if (rec.ts > lastTs) lastTs = rec.ts; break
      case 'todos': todos = Array.isArray(rec.todos) ? rec.todos : []; if (rec.ts > lastTs) lastTs = rec.ts; break
      // A corrupt `todos` record (string/object instead of array) from a
      // pre-validation write heals to [] here so a damaged file never
      // propagates a non-array into the renderer's `todos.filter`.
      case 'usage': usage = rec.usage; if (rec.ts > lastTs) lastTs = rec.ts; break
    }
  }
  if (!meta) return null
  return {
    id: meta.sessionId,
    agentId: meta.agentId,
    projectPath: meta.projectPath,
    title: title ?? meta.title,
    items,
    todos,
    usage,
    createdAt: meta.createdAt,
    updatedAt: Math.max(lastTs, meta.createdAt)
  }
}
