import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatTranscriptItem, SessionSummary, TodoItem, ToolCallData, TranscriptWindow, TranscriptWindowOpts, UsageSummary } from '../../shared/types'
import { SessionFileStore } from './session-file-store'

export const DEFAULT_SESSION_TITLE = 'New session'

export interface StoredSession {
  id: string
  agentId: string
  projectPath: string
  title: string
  items: ChatTranscriptItem[]
  todos: TodoItem[]
  usage: UsageSummary
  createdAt: number
  updatedAt: number
}

export type { SessionSummary }

export function titleFrom(text: string): string {
  const cleanText = text
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .trim()

  const line = cleanText.split('\n').find(l => l.trim().length > 0)
  let t = (line ?? '').trim().replace(/\s+/g, ' ')
  if (t.length > 60) t = t.slice(0, 59) + '…'
  return t || DEFAULT_SESSION_TITLE
}

export class SessionStore {
  private lastUpdatedAt = 0
  constructor(private store: SessionFileStore) {}

  flush(): void { this.store.flush() }

  private nextUpdatedAt(): number {
    const now = Date.now()
    if (now > this.lastUpdatedAt) this.lastUpdatedAt = now
    else this.lastUpdatedAt += 1
    return this.lastUpdatedAt
  }

  private toSummary(e: { id: string; agentId: string; title: string; messageCount: number; createdAt: number; updatedAt: number }): SessionSummary {
    return { id: e.id, agentId: e.agentId, title: e.title, messageCount: e.messageCount, createdAt: e.createdAt, updatedAt: e.updatedAt }
  }

  list(agentId: string): SessionSummary[] {
    return this.store.list()
      .filter(e => e.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(e => this.toSummary(e))
  }

  // Summary-only StoredSessions (empty items/todos) for getStats, which reads
  // id/title/agentId/usage only.
  listAll(): StoredSession[] {
    return this.store.list().map(e => ({
      id: e.id, agentId: e.agentId, projectPath: e.projectPath, title: e.title,
      items: [], todos: [], usage: e.usage, createdAt: e.createdAt, updatedAt: e.updatedAt
    }))
  }

  get(id: string): StoredSession | null { return this.store.get(id) }

  latest(agentId: string): StoredSession | null {
    const entry = this.store.list()
      .filter(e => e.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return entry ? this.store.get(entry.id) : null
  }

  create(agentId: string, projectPath: string): StoredSession {
    const session: StoredSession = {
      id: randomUUID(), agentId, projectPath, title: DEFAULT_SESSION_TITLE,
      items: [], todos: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      createdAt: Date.now(), updatedAt: this.nextUpdatedAt()
    }
    this.store.create(session)
    return session
  }

  transcript(id: string): ChatTranscriptItem[] { return this.store.get(id)?.items ?? [] }

  transcriptWindow(id: string, opts?: TranscriptWindowOpts): TranscriptWindow {
    const items = this.store.get(id)?.items ?? []
    const limit = Math.max(1, opts?.limit ?? 50)
    if (!opts?.beforeId) return { items: items.slice(-limit), hasMore: items.length > limit }
    const index = items.findIndex(it => (it.kind === 'message' ? it.message.id : it.tool.id) === opts.beforeId)
    if (index < 0) return { items: items.slice(-limit), hasMore: items.length > limit }
    const start = Math.max(0, index - limit + 1)
    return { items: items.slice(start, index + 1), hasMore: start > 0 }
  }

  todos(id: string): TodoItem[] { return this.store.get(id)?.todos ?? [] }

  setTodos(id: string, todos: TodoItem[]): void {
    const s = this.store.get(id); if (!s) return
    s.todos = todos
    s.updatedAt = this.nextUpdatedAt()
    this.store.append(id, [{ type: 'todos', ts: s.updatedAt, todos }])
    this.store.reindex(s)
  }

  replaceItems(id: string, items: ChatTranscriptItem[]): void {
    const s = this.store.get(id); if (!s) return
    s.items = items
    s.updatedAt = this.nextUpdatedAt()
    this.store.rewrite(s)
  }

  removeMessage(id: string, messageId: string): void {
    const s = this.store.get(id); if (!s) return
    const after = s.items.filter(it => !(it.kind === 'message' && it.message.id === messageId))
    if (after.length === s.items.length) return
    s.items = after
    s.updatedAt = this.nextUpdatedAt()
    this.store.rewrite(s)
  }

  truncateFromLastUser(id: string): ChatTranscriptItem[] {
    const s = this.store.get(id); if (!s) return []
    let cut = -1
    for (let i = s.items.length - 1; i >= 0; i--) {
      const item = s.items[i]
      if (item.kind === 'message' && item.message.role === 'user') { cut = i; break }
    }
    if (cut < 0) return []
    const removed = s.items.splice(cut)
    s.updatedAt = this.nextUpdatedAt()
    this.store.rewrite(s)
    return removed
  }

  appendMessage(id: string, message: ChatMessage): void {
    const s = this.store.get(id); if (!s) return
    s.items.push({ kind: 'message', message })
    const records: import('./session-records').SessionRecord[] =
      [{ type: 'message', uuid: randomUUID(), parentUuid: null, ts: message.createdAt, message }]
    if (s.title === DEFAULT_SESSION_TITLE && message.role === 'user') {
      const derived = titleFrom(message.displayText ?? message.text)
      if (derived !== DEFAULT_SESSION_TITLE) {
        s.title = derived
        records.push({ type: 'title', ts: this.nextUpdatedAt(), title: derived })
      }
    }
    s.updatedAt = this.nextUpdatedAt()
    this.store.append(id, records)
    this.store.reindex(s)
  }

  appendTool(id: string, tool: ToolCallData): void {
    const s = this.store.get(id); if (!s) return
    s.items.push({ kind: 'tool', tool })
    s.updatedAt = this.nextUpdatedAt()
    this.store.append(id, [{ type: 'tool', uuid: randomUUID(), parentUuid: null, ts: s.updatedAt, tool }])
    this.store.reindex(s)
  }

  setTitle(id: string, title: string): void {
    const s = this.store.get(id); if (!s) return
    s.title = title
    s.updatedAt = this.nextUpdatedAt()
    this.store.append(id, [{ type: 'title', ts: s.updatedAt, title }])
    this.store.reindex(s)
  }

  touch(id: string): void {
    const s = this.store.get(id); if (!s) return
    s.updatedAt = this.nextUpdatedAt()
    this.store.reindex(s)
  }

  getUsage(id: string): UsageSummary {
    return this.store.get(id)?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  }

  addUsage(id: string, usage: UsageSummary): void {
    const s = this.store.get(id); if (!s) return
    s.usage = {
      input: s.usage.input + usage.input, output: s.usage.output + usage.output,
      cacheRead: s.usage.cacheRead + usage.cacheRead, cacheWrite: s.usage.cacheWrite + usage.cacheWrite,
      cost: s.usage.cost + usage.cost
    }
    s.updatedAt = this.nextUpdatedAt()
    this.store.append(id, [{ type: 'usage', ts: s.updatedAt, usage: s.usage }])
    this.store.reindex(s)
  }

  delete(id: string): void { this.store.remove(id) }

  deleteForAgent(agentId: string): void {
    for (const e of this.store.list()) if (e.agentId === agentId) this.store.remove(e.id)
  }
}
