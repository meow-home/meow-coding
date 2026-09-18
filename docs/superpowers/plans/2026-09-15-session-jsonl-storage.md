# Session JSONL Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move session transcripts from a single `sessions.json` array to one append-only JSONL file per session grouped by project (`userData/projects/<encoded>/<sessionId>.jsonl`), Claude-CLI-style, keeping Meow's pane model and the `SessionStore` public API unchanged.

**Architecture:** A pure records layer serializes/parses a `StoredSession` to/from JSONL (`meta` + `message`/`tool` + latest-wins `title`/`todos`/`usage`, each transcript record carrying a linear `parentUuid`). A `SessionFileStore` owns the on-disk `projects/` tree plus a lightweight `sessions-index.json` of summaries, lazily reading transcripts per session. `SessionStore` keeps its public API but drives `SessionFileStore` granularly: appends on the hot path, full rewrites for the rare mutating ops (undo/compact/steer). A flag-guarded, idempotent migration runs once inside `SessionFileStore`'s constructor.

**Tech Stack:** TypeScript, Electron main process, Node `fs` (sync), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-15-session-jsonl-storage-design.md](../specs/2026-09-15-session-jsonl-storage-design.md)

## Global Constraints

- Node `fs` sync APIs only in the store (the `SessionStore` API is synchronous); no async/await in store read/write paths.
- All file writes that replace a whole file are atomic (temp file + rename-with-retry); appends use `appendFileSync`.
- Never hard-delete user data on migration: the old `sessions.json` is renamed to a backup, not removed.
- `SessionStore` public API and the exports `titleFrom` and `DEFAULT_SESSION_TITLE` from `src/main/agent/session.ts` must not change (consumed by `src/main/index.ts` and `src/main/meow-agent-manager.ts`).
- Path encoding replaces each `:`, `\`, `/` with `-` (Claude CLI scheme), e.g. `E:\Git\GitHub\meow-coding` → `E--Git-GitHub-meow-coding`.
- Test command: `npm run test` (Vitest). Typecheck: `npm run typecheck`.
- Migration guard flag file: `userData/.sessions-migrated-v1`. Backup file: `userData/sessions.json.migrated-bak`.

---

### Task 1: Extract atomic write helper

Both the new store and the migration need json-store's atomic write + Windows rename-retry. Extract it into a shared module and refactor `json-store.ts` to use it (behavior unchanged; existing tests stay green).

**Files:**
- Create: `src/main/atomic-write.ts`
- Modify: `src/main/json-store.ts` (replace the inline `renameOverwrite`/`write` internals with the helper)
- Test: `tests/unit/atomic-write.test.ts`

**Interfaces:**
- Produces: `writeFileAtomic(filePath: string, data: string): void` — writes `data` to `filePath` via `filePath + '.tmp'` then rename, retrying transient EPERM/EACCES/EBUSY on rename, falling back to in-place `writeFileSync`. Creates parent dirs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/atomic-write.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFileAtomic } from '../../src/main/atomic-write'

describe('writeFileAtomic', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-atomic-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates parent dirs and writes the data', () => {
    const file = path.join(dir, 'a', 'b', 'c.json')
    writeFileAtomic(file, '{"x":1}')
    expect(readFileSync(file, 'utf-8')).toBe('{"x":1}')
  })

  it('overwrites an existing file and leaves no temp file', () => {
    const file = path.join(dir, 'c.json')
    writeFileAtomic(file, 'first')
    writeFileAtomic(file, 'second')
    expect(readFileSync(file, 'utf-8')).toBe('second')
    expect(existsSync(file + '.tmp')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/atomic-write.test.ts`
Expected: FAIL — cannot find module `../../src/main/atomic-write`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/atomic-write.ts
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// On Windows, renameSync over an existing file throws EPERM/EACCES/EBUSY while
// the destination is transiently locked (antivirus, Search Indexer, OneDrive).
// Retry with backoff before falling back to an in-place overwrite.
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80]
const sleepBuf = new Int32Array(new SharedArrayBuffer(4))

function renameOverwrite(tmp: string, filePath: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, filePath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!transient || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
      Atomics.wait(sleepBuf, 0, 0, RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}

/** Writes data by swapping in a temp file, so a crash mid-write cannot leave a
 * half-written file. Creates parent dirs. */
export function writeFileAtomic(filePath: string, data: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data)
  try {
    renameOverwrite(tmp, filePath)
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    writeFileSync(filePath, data)
  }
}
```

Then in `src/main/json-store.ts` delete the local `RENAME_RETRY_DELAYS_MS`, `sleepBuf`, `renameOverwrite`, and replace the body of the internal `write` with:

```ts
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { writeFileAtomic } from './atomic-write'
// ...
const write = (items: T[]): void => {
  writeFileAtomic(filePath, JSON.stringify(items, null, 2))
}
```

(Keep the rest of `json-store.ts` — the `load()` corrupt-parking logic, debounce, cache — unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/atomic-write.test.ts tests/unit/json-store.test.ts`
Expected: PASS (both the new test and the untouched json-store suite).

- [ ] **Step 5: Commit**

```bash
git add src/main/atomic-write.ts src/main/json-store.ts tests/unit/atomic-write.test.ts
git commit -m "refactor(agent): extract writeFileAtomic helper from json-store"
```

---

### Task 2: Project path encoding

**Files:**
- Create: `src/main/project-encode.ts`
- Test: `tests/unit/project-encode.test.ts`

**Interfaces:**
- Produces: `encodeProjectPath(projectPath: string): string` — replaces every `:`, `\`, `/` with `-`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/project-encode.test.ts
import { describe, expect, it } from 'vitest'
import { encodeProjectPath } from '../../src/main/project-encode'

describe('encodeProjectPath', () => {
  it('encodes a Windows path the Claude CLI way', () => {
    expect(encodeProjectPath('E:\\Git\\GitHub\\meow-coding')).toBe('E--Git-GitHub-meow-coding')
  })
  it('encodes a POSIX path', () => {
    expect(encodeProjectPath('/home/me/proj')).toBe('-home-me-proj')
  })
  it('leaves an already-dashed name unchanged', () => {
    expect(encodeProjectPath('meow-coding')).toBe('meow-coding')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/project-encode.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/project-encode.ts
/** Encode a project path into a single directory-name segment, matching Claude
 * CLI's scheme (every ':', '\' and '/' becomes '-'). Not reversible; the true
 * projectPath is stored in each session file's meta record. */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[:\\/]/g, '-')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/project-encode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/project-encode.ts tests/unit/project-encode.test.ts
git commit -m "feat(agent): add project path encoding for jsonl session dirs"
```

---

### Task 3: Session records (serialize / parse)

Pure functions converting a `StoredSession` to/from JSONL text. No filesystem.

**Files:**
- Create: `src/main/agent/session-records.ts`
- Test: `tests/unit/session-records.test.ts`

**Interfaces:**
- Consumes: `StoredSession` (type) from `./session` (type-only import — no runtime cycle); `ChatMessage`, `ToolCallData`, `TodoItem`, `UsageSummary` from `../../shared/types`.
- Produces:
  - `type SessionRecord` — the discriminated union below.
  - `sessionToRecords(s: StoredSession): SessionRecord[]` — `meta`, then a `message`/`tool` per item with a fresh `uuid` and linear `parentUuid`, then `title`, `todos`, `usage`.
  - `serializeSessionJsonl(s: StoredSession): string` — records as newline-terminated JSON lines.
  - `parseSessionJsonl(text: string): StoredSession | null` — reconstruct; latest-wins for title/todos/usage; skip an unparseable final line; return `null` if there is no valid `meta` record.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/session-records.test.ts
import { describe, expect, it } from 'vitest'
import { serializeSessionJsonl, parseSessionJsonl } from '../../src/main/agent/session-records'
import type { StoredSession } from '../../src/main/agent/session'

function sample(): StoredSession {
  return {
    id: 's1', agentId: 'a1', projectPath: '/proj', title: 'Fix bug',
    items: [
      { kind: 'message', message: { id: 'm0', role: 'user', text: 'hi', createdAt: 1 } },
      { kind: 'tool', tool: { id: 't1', tool: 'bash', input: { cmd: 'ls' }, permission: 'allowed' } },
      { kind: 'message', message: { id: 'm2', role: 'assistant', text: 'done', createdAt: 3 } }
    ],
    todos: [{ content: 'run tests', status: 'pending' }],
    usage: { input: 10, output: 20, cacheRead: 1, cacheWrite: 2, cost: 0.5 },
    createdAt: 100, updatedAt: 300
  }
}

describe('session-records round trip', () => {
  it('serialize -> parse preserves items, title, todos, usage, createdAt', () => {
    const s = sample()
    const back = parseSessionJsonl(serializeSessionJsonl(s))
    expect(back).not.toBeNull()
    expect(back!.id).toBe('s1')
    expect(back!.agentId).toBe('a1')
    expect(back!.projectPath).toBe('/proj')
    expect(back!.title).toBe('Fix bug')
    expect(back!.items).toEqual(s.items)
    expect(back!.todos).toEqual(s.todos)
    expect(back!.usage).toEqual(s.usage)
    expect(back!.createdAt).toBe(100)
  })

  it('latest title/todos/usage records win', () => {
    const s = sample()
    let text = serializeSessionJsonl(s)
    text += JSON.stringify({ type: 'title', ts: 400, title: 'Renamed' }) + '\n'
    text += JSON.stringify({ type: 'usage', ts: 401, usage: { input: 99, output: 0, cacheRead: 0, cacheWrite: 0, cost: 1 } }) + '\n'
    const back = parseSessionJsonl(text)!
    expect(back.title).toBe('Renamed')
    expect(back.usage.input).toBe(99)
  })

  it('skips a corrupt trailing line (crash mid-append)', () => {
    const s = sample()
    const text = serializeSessionJsonl(s) + '{"type":"message","uuid":"x",'  // truncated
    const back = parseSessionJsonl(text)
    expect(back).not.toBeNull()
    expect(back!.items).toHaveLength(3)
  })

  it('returns null when there is no meta record', () => {
    expect(parseSessionJsonl('{"type":"title","ts":1,"title":"x"}\n')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-records.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/agent/session-records.ts
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
      case 'todos': todos = rec.todos; if (rec.ts > lastTs) lastTs = rec.ts; break
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-records.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session-records.ts tests/unit/session-records.test.ts
git commit -m "feat(agent): add session jsonl record serialize/parse"
```

---

### Task 4: SessionFileStore — reads, index, self-heal

Read side of the per-session store: locate files, lazily read/parse a session, and maintain an in-memory index of summaries loaded from `sessions-index.json` or rebuilt by scanning `projects/`.

**Files:**
- Create: `src/main/agent/session-file-store.ts`
- Test: `tests/unit/session-file-store.test.ts`

**Interfaces:**
- Consumes: `encodeProjectPath` (Task 2); `parseSessionJsonl`, `serializeSessionJsonl` (Task 3); `writeFileAtomic` (Task 1); `StoredSession` (type) from `./session`; `UsageSummary` from `../../shared/types`.
- Produces:
  - `interface SessionIndexEntry { id: string; agentId: string; projectPath: string; title: string; messageCount: number; createdAt: number; updatedAt: number; usage: UsageSummary }`
  - `class SessionFileStore` with (this task) `constructor(rootDir: string, opts?: { debounceMs?: number })`, `list(): SessionIndexEntry[]`, `get(id: string): StoredSession | null`. (Write methods land in Task 5.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/session-file-store.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionFileStore } from '../../src/main/agent/session-file-store'
import { serializeSessionJsonl } from '../../src/main/agent/session-records'
import { encodeProjectPath } from '../../src/main/project-encode'
import type { StoredSession } from '../../src/main/agent/session'

function seed(root: string, s: StoredSession) {
  const dir = path.join(root, 'projects', encodeProjectPath(s.projectPath))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${s.id}.jsonl`), serializeSessionJsonl(s))
}
function session(id: string, agentId: string, projectPath = '/p'): StoredSession {
  return { id, agentId, projectPath, title: `T-${id}`, items: [
    { kind: 'message', message: { id: `${id}-m`, role: 'user', text: 'hi', createdAt: 1 } }
  ], todos: [], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 }, createdAt: 10, updatedAt: 20 }
}

describe('SessionFileStore reads', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-fs-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('rebuilds the index by scanning projects/ when no index file exists', () => {
    seed(root, session('s1', 'a1'))
    seed(root, session('s2', 'a2'))
    const store = new SessionFileStore(root)
    expect(store.list().map(e => e.id).sort()).toEqual(['s1', 's2'])
    const e1 = store.list().find(e => e.id === 's1')!
    expect(e1.agentId).toBe('a1')
    expect(e1.messageCount).toBe(1)
    expect(e1.usage.output).toBe(2)
  })

  it('reads and parses one session lazily by id', () => {
    seed(root, session('s1', 'a1'))
    const store = new SessionFileStore(root)
    const s = store.get('s1')
    expect(s?.items).toHaveLength(1)
    expect(s?.title).toBe('T-s1')
    expect(store.get('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-file-store.test.ts`
Expected: FAIL — cannot find module / `SessionFileStore` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/agent/session-file-store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { UsageSummary } from '../../shared/types'
import type { StoredSession } from './session'
import { encodeProjectPath } from '../project-encode'
import { parseSessionJsonl, serializeSessionJsonl, type SessionRecord } from './session-records'
import { writeFileAtomic } from '../atomic-write'

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-file-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session-file-store.ts tests/unit/session-file-store.test.ts
git commit -m "feat(agent): add SessionFileStore reads + index rebuild"
```

---

### Task 5: SessionFileStore — writes (create / append / rewrite / remove)

**Files:**
- Modify: `src/main/agent/session-file-store.ts`
- Test: `tests/unit/session-file-store.test.ts` (add a `SessionFileStore writes` describe block)

**Interfaces:**
- Consumes: `SessionRecord`, `serializeSessionJsonl` (Task 3), `writeFileAtomic` (Task 1), everything from Task 4.
- Produces (added to `SessionFileStore`):
  - `create(session: StoredSession): void` — writes the file (via `serializeSessionJsonl`), caches it, indexes it.
  - `append(id: string, records: SessionRecord[]): void` — `appendFileSync` one line per record to the session's file.
  - `reindex(session: StoredSession): void` — recompute and upsert the index summary; schedule index write.
  - `rewrite(session: StoredSession): void` — atomic full rewrite of the file + reindex.
  - `remove(id: string): void` — delete the file, drop from cache + index.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/session-file-store.test.ts
import { readFileSync as read } from 'node:fs'
import { randomUUID } from 'node:crypto'

describe('SessionFileStore writes', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-fsw-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('create writes a meta line and indexes the session', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1')
    s.items = []
    store.create(s)
    expect(store.list().map(e => e.id)).toEqual(['s1'])
    const file = path.join(root, 'projects', encodeProjectPath('/p'), 's1.jsonl')
    const first = read(file, 'utf-8').split('\n')[0]
    expect(JSON.parse(first).type).toBe('meta')
  })

  it('append adds one line per record without rewriting earlier lines', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1'); s.items = []
    store.create(s)
    const file = path.join(root, 'projects', encodeProjectPath('/p'), 's1.jsonl')
    const before = read(file, 'utf-8')
    store.append('s1', [{ type: 'message', uuid: randomUUID(), parentUuid: null, ts: 5, message: { id: 'm1', role: 'user', text: 'hi', createdAt: 5 } }])
    const after = read(file, 'utf-8')
    expect(after.startsWith(before)).toBe(true)      // earlier bytes untouched
    expect(after.trimEnd().split('\n')).toHaveLength(before.trimEnd().split('\n').length + 1)
  })

  it('rewrite replaces the file and reindexes; remove deletes it', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1')
    store.create(s)
    const s2 = { ...s, items: [], title: 'Empty' }
    store.rewrite(s2)
    store['cache'].delete('s1')                       // force re-read from disk
    expect(store.get('s1')?.items).toHaveLength(0)
    expect(store.list().find(e => e.id === 's1')?.title).toBe('Empty')
    store.remove('s1')
    expect(store.get('s1')).toBeNull()
    expect(store.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-file-store.test.ts`
Expected: FAIL — `create`/`append`/`rewrite`/`remove` are not functions.

- [ ] **Step 3: Write minimal implementation**

Add `appendFileSync` to the `node:fs` import, and add these methods to `SessionFileStore` (replace the `// Write methods ... Task 5.` comment):

```ts
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
```

(`create` and `rewrite` are intentionally identical for now — both do a full atomic write; they are separate methods so Task 6's callers read clearly and so a future leaf-repoint upgrade can differentiate them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-file-store.test.ts`
Expected: PASS (reads + writes blocks).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session-file-store.ts tests/unit/session-file-store.test.ts
git commit -m "feat(agent): add SessionFileStore write path (create/append/rewrite/remove)"
```

---

### Task 6: Refactor SessionStore onto SessionFileStore

Rewire `SessionStore` to drive `SessionFileStore` instead of `JsonStore<StoredSession>`. Public API and the `titleFrom`/`DEFAULT_SESSION_TITLE` exports stay identical. Appends hit the hot path; the three mutating ops (`replaceItems`, `truncateFromLastUser`, `removeMessage`) do a full `rewrite`. Summary methods (`list`/`latest`/`listAll`) read the index.

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `tests/unit/session-store.test.ts` (construct via `SessionFileStore`; rewrite the two caching tests; move the legacy-normalize test out — it becomes Task 7's migration test)
- Modify: `tests/unit/session-store-remove.test.ts` (construct via `SessionFileStore`)

**Interfaces:**
- Consumes: `SessionFileStore`, `SessionIndexEntry` (Tasks 4-5); `sessionToRecords` and record helpers (Task 3).
- Produces: `SessionStore` with an unchanged public API but `constructor(store: SessionFileStore)`. `listAll(): StoredSession[]` now returns summary-only `StoredSession`s (empty `items`/`todos`) built from the index — its only caller, `MeowAgentManager.getStats`, reads `id`/`title`/`agentId`/`usage` only.

- [ ] **Step 1: Update the tests first (they define the new construction + invariants)**

In `tests/unit/session-store.test.ts` and `tests/unit/session-store-remove.test.ts`, replace the imports and `makeStore` helper:

```ts
import { SessionStore, DEFAULT_SESSION_TITLE, titleFrom } from '../../src/main/agent/session'
import { SessionFileStore } from '../../src/main/agent/session-file-store'
// ...
function makeStore(dir: string) {
  return new SessionStore(new SessionFileStore(dir))
}
```

Update each `beforeEach` to pass the temp **dir** (not a `sessions.json` file path) to `makeStore(dir)`. The `SessionStore flush` describe becomes:

```ts
it('persists debounced index writes to disk on demand', () => {
  const store = new SessionStore(new SessionFileStore(dir, { debounceMs: 60_000 }))
  const s = store.create('agent1', '/proj')
  store.appendMessage(s.id, userMessage('hi'))
  store.flush()
  expect(new SessionStore(new SessionFileStore(dir)).transcript(s.id)).toHaveLength(1)
})
```

Replace the `SessionStore caching` describe block (which used the fake `countingStore`) with disk-based invariants:

```ts
describe('SessionStore persistence shape', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-persist-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('appends one line per message rather than rewriting the transcript', () => {
    const store = makeStore(dir)
    const s = store.create('agent1', '/proj')
    for (let i = 0; i < 20; i++) store.appendMessage(s.id, userMessage(`m${i}`))
    const file = require('node:fs').readFileSync(
      path.join(dir, 'projects', 'proj'.replace(/^/, '-'), `${s.id}.jsonl`), 'utf-8')  // '/proj' -> '-proj'
    const lines = file.trimEnd().split('\n').map((l: string) => JSON.parse(l))
    expect(lines[0].type).toBe('meta')
    expect(lines.filter((r: { type: string }) => r.type === 'message')).toHaveLength(20)
    expect(store.transcript(s.id)).toHaveLength(20)
  })
})
```

Delete the `migrates legacy entries (id = agentId, no title/createdAt)` test from this file (it moves to Task 7).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/session-store.test.ts tests/unit/session-store-remove.test.ts`
Expected: FAIL — `SessionStore` still expects a `JsonStore`; `new SessionFileStore(dir)` is not assignable / methods mismatch.

- [ ] **Step 3: Rewrite `src/main/agent/session.ts`**

Keep `DEFAULT_SESSION_TITLE`, `titleFrom`, `titleFromItems`, and the `StoredSession` interface exactly as they are. Remove `normalize`, `RawSession`, and the `JsonStore` import. Replace the class body:

```ts
import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatTranscriptItem, SessionSummary, TodoItem, ToolCallData, TranscriptWindow, TranscriptWindowOpts, UsageSummary } from '../../shared/types'
import { SessionFileStore } from './session-file-store'
import { sessionToRecords } from './session-records'

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

// titleFrom and titleFromItems: unchanged (copy from the current file).

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
```

Note: `parentUuid` is written as `null` on the append path for simplicity (the linear chain is reconstructed on read by file order); `sessionToRecords` (used by rewrite/migration) sets the proper linear chain. This is acceptable for Approach C and is where the future leaf-repoint upgrade plugs in.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/session-store.test.ts tests/unit/session-store-remove.test.ts tests/unit/session-file-store.test.ts tests/unit/session-records.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
npm run typecheck
npm run test
git add src/main/agent/session.ts tests/unit/session-store.test.ts tests/unit/session-store-remove.test.ts
git commit -m "refactor(agent): back SessionStore with per-session jsonl files"
```

Expected: typecheck clean, all tests pass.

---

### Task 7: One-time migration from legacy sessions.json

**Files:**
- Create: `src/main/agent/session-migrate.ts`
- Test: `tests/unit/session-migrate.test.ts`

**Interfaces:**
- Consumes: `serializeSessionJsonl` (Task 3), `encodeProjectPath` (Task 2), `writeFileAtomic` (Task 1), `titleFrom` (from `./session`), `StoredSession`, `SessionIndexEntry` (Task 4).
- Produces: `migrateSessions(rootDir: string): { migrated: number; skipped: boolean }` — flag-guarded (`.sessions-migrated-v1`), idempotent; normalizes legacy entries, writes per-session jsonl files + `sessions-index.json`, renames `sessions.json` → `sessions.json.migrated-bak`, writes the flag.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/session-migrate.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrateSessions } from '../../src/main/agent/session-migrate'
import { SessionFileStore } from '../../src/main/agent/session-file-store'

describe('migrateSessions', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-mig-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function seedLegacy() {
    writeFileSync(path.join(root, 'sessions.json'), JSON.stringify([
      { id: 's1', agentId: 'a1', projectPath: '/p', title: 'One', items: [
        { kind: 'message', message: { id: 'm', role: 'user', text: 'hi', createdAt: 1 } },
        { kind: 'tool', tool: { id: 't', tool: 'bash', input: {}, permission: 'allowed' } }
      ], todos: [], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 }, createdAt: 10, updatedAt: 20 },
      // legacy entry: no agentId (falls back to id), no title/createdAt
      { id: 'legacy1', projectPath: '/p', items: [
        { kind: 'message', message: { id: 'm2', role: 'user', text: 'Hello world', createdAt: 1 } }
      ], updatedAt: 100 }
    ]))
  }

  it('migrates every session to a per-project jsonl file and marks done', () => {
    seedLegacy()
    const res = migrateSessions(root)
    expect(res).toEqual({ migrated: 2, skipped: false })
    expect(existsSync(path.join(root, '.sessions-migrated-v1'))).toBe(true)
    expect(existsSync(path.join(root, 'sessions.json'))).toBe(false)
    expect(existsSync(path.join(root, 'sessions.json.migrated-bak'))).toBe(true)

    const store = new SessionFileStore(root)
    expect(store.list().map(e => e.id).sort()).toEqual(['legacy1', 's1'])
    expect(store.get('s1')?.items).toHaveLength(2)
    const legacy = store.get('legacy1')!
    expect(legacy.agentId).toBe('legacy1')     // fell back to id
    expect(legacy.title).toBe('Hello world')   // derived from first user message
    expect(legacy.createdAt).toBe(100)          // fell back to updatedAt
  })

  it('is idempotent: a second run is a no-op', () => {
    seedLegacy()
    migrateSessions(root)
    const res2 = migrateSessions(root)
    expect(res2).toEqual({ migrated: 0, skipped: true })
  })

  it('marks done on a fresh install with no legacy file', () => {
    const res = migrateSessions(root)
    expect(res).toEqual({ migrated: 0, skipped: false })
    expect(existsSync(path.join(root, '.sessions-migrated-v1'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-migrate.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/agent/session-migrate.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session-migrate.ts tests/unit/session-migrate.test.ts
git commit -m "feat(agent): add one-time sessions.json -> jsonl migration"
```

---

### Task 8: Wire into the app + run migration at startup

Trigger the migration inside `SessionFileStore`'s constructor (guaranteeing it runs before any read and before the ready-handler's model-reset), and replace the sessions store wiring in `index.ts`.

**Files:**
- Modify: `src/main/agent/session-file-store.ts` (run migration in constructor, best-effort)
- Modify: `src/main/index.ts:146` (construct `SessionStore` with `SessionFileStore`)

**Interfaces:**
- Consumes: `migrateSessions` (Task 7).

- [ ] **Step 1: Run migration in the SessionFileStore constructor**

In `src/main/agent/session-file-store.ts`, import the migration and call it before the store is first used. Add:

```ts
import { migrateSessions } from './session-migrate'
```

and at the end of the constructor body:

```ts
    // One-time move of the legacy sessions.json into per-session jsonl files.
    // Best-effort: a failure must not break store construction (app boot).
    try { migrateSessions(rootDir) } catch { /* best effort */ }
```

Store `rootDir` as a field (or run the migration before computing `projectsDir`/`indexFile`) so the constructor has it. Minimal change: keep the existing field assignments, then add the migration call as the last statement using the `rootDir` parameter still in scope.

- [ ] **Step 2: Add a regression test for constructor-triggered migration**

```ts
// append to tests/unit/session-file-store.test.ts
import { writeFileSync as wf, existsSync as ex } from 'node:fs'

describe('SessionFileStore constructor migration', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-fsmig-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('migrates a legacy sessions.json on first construction', () => {
    wf(path.join(root, 'sessions.json'), JSON.stringify([
      { id: 's1', agentId: 'a1', projectPath: '/p', title: 'One',
        items: [{ kind: 'message', message: { id: 'm', role: 'user', text: 'hi', createdAt: 1 } }],
        todos: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, createdAt: 1, updatedAt: 2 }
    ]))
    const store = new SessionFileStore(root)
    expect(store.list().map(e => e.id)).toEqual(['s1'])
    expect(ex(path.join(root, '.sessions-migrated-v1'))).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/unit/session-file-store.test.ts`
Expected: PASS (migration runs in the constructor, then the index scan finds `s1`).

- [ ] **Step 4: Rewire index.ts**

In `src/main/index.ts`, add the import near the other agent imports:

```ts
import { SessionFileStore } from './agent/session-file-store'
```

Replace line ~146:

```ts
    store: new SessionStore(createJsonStore<StoredSession>(path.join(app.getPath('userData'), 'sessions.json'), { debounceMs: 250 })),
```

with:

```ts
    store: new SessionStore(new SessionFileStore(app.getPath('userData'), { debounceMs: 250 })),
```

If `StoredSession` is now unused in `index.ts`, remove it from its import; leave `createJsonStore` (still used by snapshots/permissions/learned-limits). Leave the ready-handler model-reset block (`~line 989`) as-is: after migration the `clearSessions` `rmSync('sessions.json')` is a harmless no-op (the file is now `sessions.json.migrated-bak`), and `resetToSingleSession` still trims workspaces; any session files for trimmed agents become unreferenced but harmless.

- [ ] **Step 5: Typecheck, full suite, manual smoke, commit**

```bash
npm run typecheck
npm run test
```

Expected: typecheck clean; all tests pass.

Manual smoke (do once, describe results in the PR):

```bash
npm run dev
```

Verify: (1) existing sessions still appear in the sidebar and open with their transcripts; (2) `userData/projects/<encoded>/<id>.jsonl` files now exist and `sessions.json.migrated-bak` is present; (3) sending a new message appends to the session's jsonl (line count grows) and the sidebar title/updatedAt update.

```bash
git add src/main/agent/session-file-store.ts src/main/index.ts tests/unit/session-file-store.test.ts
git commit -m "feat(agent): store sessions as per-session jsonl and migrate on startup"
```

---

## Self-Review

**1. Spec coverage:**
- On-disk layout `projects/<encoded>/<id>.jsonl` + `sessions-index.json` + backup + flag → Tasks 2, 4, 5, 7, 8. ✓
- Path encoding (Claude CLI scheme) → Task 2. ✓
- Record schema (meta/message/tool/title/todos/usage, `parentUuid`, latest-wins, crash-tolerant load) → Task 3. ✓
- `SessionStore` public API unchanged; append hot path; rewrite for undo/compact/steer; index for list/latest/listAll → Task 6. ✓
- Index + lazy transcript read + self-heal rebuild → Task 4. ✓
- Migration: idempotent, flag-guarded, backup, auto-run at startup, script → Task 7 (module) + Task 8 (startup trigger). The "standalone script" is realized as the startup-triggered migration because `app.getPath('userData')` is Electron-only; a manual re-run = delete `.sessions-migrated-v1` and relaunch (documented in Task 8 smoke). ✓
- Cutover (remove old wiring, keep backup) → Task 8. ✓
- Testing (store units, round-trip, index, migration idempotency, encoding, crash tolerance) → Tasks 1-7. ✓
- `getStats`/`listAll` needs only summary+usage → Task 6 `listAll` returns summary-only StoredSessions. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has concrete code. The one deliberate note ("standalone script realized as startup migration") is a design decision, stated with its reason, not a gap.

**3. Type consistency:** `SessionRecord`, `SessionIndexEntry`, `StoredSession`, `migrateSessions`, `encodeProjectPath`, `serializeSessionJsonl`/`parseSessionJsonl`, `writeFileAtomic`, and the `SessionFileStore` methods (`list`/`get`/`create`/`append`/`rewrite`/`reindex`/`remove`/`flush`) are used with the same names and signatures across Tasks 3-8. `SessionStore` constructor changes to `(store: SessionFileStore)` consistently in code and both updated test files.
