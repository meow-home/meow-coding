# Keep-Alive Workspaces + Instant Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching between open projects no longer unmounts panes or reloads transcripts — hidden projects' chat feeds stay live (their agents keep running in main), reactivation toggles instantly, and cold-opening a session renders only a ~50-item transcript tail that grows on demand.

**Architecture:** The renderer keeps every loaded project's workspace panes mounted, hiding the inactive ones with `display:none` (`.workspace-hidden`) so their ChatPanels keep consuming the main-process `onChatEvent` stream (`main` broadcasts all events to the window regardless of activeProject). Activation for an already-loaded project goes over a new lightweight IPC `WorkspaceActivate(path)` that repoints `activeProject` + git/file pollers and closes terminals, but does **not** re-register agents or re-run `prepareWorkspace`. Cold open gets faster because `SessionStore.transcriptWindow(id, {limit, beforeId})` returns `{ items, hasMore }` and ChatPanel loads the tail + a "Load earlier" button that prepends older items. LRU keeps at most `MAX_KEEP_ALIVE = 5` projects alive (never evicting one whose agent is running).

**Tech Stack:** Electron main (`SessionStore`, `MainApp`, `ipcMain`), preload bridge, React 19 renderer (`App.tsx`, `ChatPanel`, `useChatScroll`), Vitest unit tests, plain CSS.

**Spec:** docs/superpowers/specs/2026-09-06-keep-alive-workspace-design.md

## Global Constraints

- `MAX_KEEP_ALIVE = 5` constant in `src/renderer/src/App.tsx`.
- Transcript tail-window default `limit = 50`.
- Contract changes update 4 places in sync: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `tests/unit/ipc-contract.test.ts`. Never hardcode channel strings — use `Channels`.
- `WorkspaceActivate` must NOT re-register agents / re-run `prepareWorkspace`: no `addAgent`, no `meowAgent.init(ws.agents)`, no PTY start. Only: `closeAllTerminals()`, `activeProject = path`, `meowAgent.setProjectPath(path)`, `startGitPoll(path)`, `startFileWatcher(path)`, return `runtimeFor(ws)`.
- Terminal/PTY is not keep-alive — behavior unchanged (closed on every switch).
- `isChatRunning` / `getPendingPrompt` stay cold-mount-only (ChatPanel mount effect), never re-called on activation.
- Eviction never stops an agent — it only unmounts the renderer panel (the agent loop keeps running in main).
- `.chat-msg` already carries `content-visibility: auto; contain-intrinsic-size: auto 80px;` (styles.css:805) — do not add more `content-visibility`; the only render-light change is lazy images.
- Commits on `master`, message prefix `scope: description`, `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer, and keep AGENTS.md files in sync with contract changes.
- Verify per task: `npm run typecheck` (node + web + extension + server) and targeted vitest runs (`npx vitest run tests/unit/<file>.test.ts`).

---

### Task 1: `SessionStore.transcriptWindow` (windowed read) + unit tests

Foundation: a windowed transcript reader on `SessionStore`. No IPC, no renderer. Pure TDD.

**Files:**
- Modify: `src/shared/types.ts` — add `TranscriptWindow` + `TranscriptWindowOpts` (next to `ChatTranscriptItem`, ~line 175)
- Modify: `src/main/agent/session.ts` — add `transcriptWindow` next to `transcript` (line 136)
- Test: `tests/unit/session-store.test.ts` — new `describe('transcriptWindow', ...)` block

**Interfaces:**
- Produces: `SessionStore.transcriptWindow(id: string, opts?: { limit?: number; beforeId?: string }): TranscriptWindow`
- Produces: `interface TranscriptWindow { items: ChatTranscriptItem[]; hasMore: boolean }` and `interface TranscriptWindowOpts { limit?: number; beforeId?: string }`
- Consumes: existing `SessionStore.get(id)` / `appendMessage` / `appendTool`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/session-store.test.ts`. It already imports `ChatMessage`; add `import type { ChatMessage, ToolCallData } from '../../src/shared/types'`.

```ts
describe('transcriptWindow', () => {
  const msg = (id: string, role: 'user' | 'assistant' = 'user') =>
    ({ id, role, text: `msg-${id}`, createdAt: Date.now() })
  const tool = (id: string): ToolCallData =>
    ({ id, tool: 'bash', input: {}, permission: 'approved' })

  it('returns the last `limit` items in order with hasMore when older exist', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 12; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id, { limit: 5 })
    expect(w.hasMore).toBe(true)
    expect(w.items.map(it => it.message.id)).toEqual(['m7', 'm8', 'm9', 'm10', 'm11'])
  })

  it('defaults to a 50-item tail window', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 51; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id)
    expect(w.items).toHaveLength(50)
    expect(w.hasMore).toBe(true)
    expect(w.items[0]?.message.id).toBe('m1')
  })

  it('window ends at beforeId inclusive and flags hasMore only when older items exist', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 10; i++) store.appendMessage(s.id, msg(`m${i}`))
    const mid = store.transcriptWindow(s.id, { beforeId: 'm7', limit: 4 })
    expect(mid.items.map(it => it.message.id)).toEqual(['m4', 'm5', 'm6', 'm7'])
    expect(mid.hasMore).toBe(true)
    const head = store.transcriptWindow(s.id, { beforeId: 'm2', limit: 4 })
    expect(head.items.map(it => it.message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(head.hasMore).toBe(false)
    const tail = store.transcriptWindow(s.id, { beforeId: 'm9', limit: 4 })
    expect(tail.items.map(it => it.message.id)).toEqual(['m6', 'm7', 'm8', 'm9'])
    expect(tail.hasMore).toBe(true)
  })

  it('matches beforeId against tool items too', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, msg('m0'))
    store.appendTool(s.id, tool('t1'))
    store.appendMessage(s.id, msg('m2'))
    const w = store.transcriptWindow(s.id, { beforeId: 't1', limit: 2 })
    expect(w.items).toHaveLength(2)
    expect(w.items[1].kind === 'tool' && w.items[1].tool.id).toBe('t1')
    expect(w.hasMore).toBe(false)
  })

  it('unknown beforeId falls back to the tail window', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 6; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id, { beforeId: 'nope', limit: 3 })
    expect(w.items.map(it => it.message.id)).toEqual(['m3', 'm4', 'm5'])
    expect(w.hasMore).toBe(true)
  })

  it('shorter transcript returns everything with hasMore=false; empty returns empty', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    expect(store.transcriptWindow(s.id, { limit: 50 })).toEqual({ items: [], hasMore: false })
    store.appendMessage(s.id, msg('m0'))
    const w = store.transcriptWindow(s.id, { limit: 50 })
    expect(w.items).toHaveLength(1)
    expect(w.hasMore).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/session-store.test.ts`
Expected: FAIL — `transcriptWindow is not a function` / type error.

- [ ] **Step 3: Add the types to `src/shared/types.ts`**

Next to the `ChatTranscriptItem` definition (around line 175):

```ts
export interface TranscriptWindowOpts {
  limit?: number
  beforeId?: string
}

export interface TranscriptWindow {
  items: ChatTranscriptItem[]
  hasMore: boolean
}
```

- [ ] **Step 4: Implement `transcriptWindow` in `src/main/agent/session.ts`**

Add `TranscriptWindow`, `TranscriptWindowOpts` to the existing type import from `@shared/types`, then right below `transcript` (line 136):

```ts
// Windowed read for paged feed rendering: `beforeId` matches a ChatMessage or
// ToolCallData id, and the returned window runs up to AND INCLUDING that item,
// with `hasMore` true when older items exist before the window.
transcriptWindow(
  id: string,
  opts?: TranscriptWindowOpts
): TranscriptWindow {
  const items = this.get(id)?.items ?? []
  const limit = Math.max(1, opts?.limit ?? 50)
  if (!opts?.beforeId) {
    return { items: items.slice(-limit), hasMore: items.length > limit }
  }
  const index = items.findIndex(it =>
    (it.kind === 'message' ? it.message.id : it.tool.id) === opts.beforeId
  )
  if (index < 0) {
    return { items: items.slice(-limit), hasMore: items.length > limit }
  }
  const start = Math.max(0, index - limit + 1)
  return { items: items.slice(start, index + 1), hasMore: start > 0 }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/session-store.test.ts`
Expected: PASS (all prior `SessionStore` tests + the new block).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/shared/types.ts src/main/agent/session.ts tests/unit/session-store.test.ts
git commit -m "feat(chat): windowed transcript read (transcriptWindow)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Paged transcript over IPC — cold open loads a tail window

Change `listChatTranscript(agentId)` → `listChatTranscript(agentId, opts?)` returning `TranscriptWindow`, wire it through main + preload + tests, and make ChatPanel load the tail + keep `hasMore`. Also lazy-load chat images.

**Files:**
- Modify: `src/main/meow-agent-manager.ts` — add `listTranscriptWindow` next to `listTranscript` (line 535)
- Modify: `src/shared/ipc.ts` — `AgentApi.listChatTranscript` (line 259) signature + return
- Modify: `src/preload/index.ts` — `listChatTranscript` (line 134) passes opts through
- Modify: `src/main/index.ts` — handle `(agentId, opts)` and call `listTranscriptWindow` (line 888)
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` — `loadTranscript` (line 209) window + `hasMore` state; `FeedMessage` img lazy attrs (lines 86-96); new module-level `toFeedItem` helper
- Modify: `tests/unit/ipc-contract.test.ts` — stub (line 108) returns a `TranscriptWindow`

**Interfaces:**
- Consumes: `TranscriptWindow`, `TranscriptWindowOpts` from Task 1; `SessionStore.transcriptWindow`.
- Produces: `meowAgent.listTranscriptWindow(agentId: string, opts?: TranscriptWindowOpts): TranscriptWindow`; `AgentApi.listChatTranscript(agentId: string, opts?: TranscriptWindowOpts): Promise<TranscriptWindow>`.
- Produces in ChatPanel: state `hasMore: boolean`; module-level `toFeedItem(it: ChatTranscriptItem): FeedItem`.

- [ ] **Step 1: Add `listTranscriptWindow` to `src/main/meow-agent-manager.ts`**

Import `TranscriptWindow`, `TranscriptWindowOpts` (shared types). Below `listTranscript` (line 535-537):

```ts
listTranscriptWindow(agentId: string, opts?: TranscriptWindowOpts): TranscriptWindow {
  return this.deps.store.transcriptWindow(this.activeSessionId(agentId), opts)
}
```

- [ ] **Step 2: Update the shared contract in `src/shared/ipc.ts`**

Line 259 — replace:

```ts
listChatTranscript(agentId: string): Promise<ChatTranscriptItem[]>
```

with:

```ts
listChatTranscript(agentId: string, opts?: TranscriptWindowOpts): Promise<TranscriptWindow>
```

(`TranscriptWindowOpts` is already exported by `types.ts`; update the import if the name is not already imported.)

- [ ] **Step 3: Pass opts through in `src/preload/index.ts`**

`TranscriptWindowOpts` comes from `@shared/types` — the preload already imports shared types; add it to that import if the name is not already present.

Line 134 — replace:

```ts
listChatTranscript: (agentId: string) => ipcRenderer.invoke(Channels.ChatListTranscript, agentId),
```

with:

```ts
listChatTranscript: (agentId: string, opts?: TranscriptWindowOpts) =>
  ipcRenderer.invoke(Channels.ChatListTranscript, agentId, opts),
```

- [ ] **Step 4: Update the main handler in `src/main/index.ts`**

Add `TranscriptWindowOpts` to the shared-types import at the top of `index.ts` if not already present.

Line 888 — replace:

```ts
ipcMain.handle(Channels.ChatListTranscript, (_e, agentId: string) => mainApp.meowAgent.listTranscript(agentId))
```

with:

```ts
ipcMain.handle(Channels.ChatListTranscript, (_e, agentId: string, opts?: TranscriptWindowOpts) =>
  mainApp.meowAgent.listTranscriptWindow(agentId, opts))
```

(`listTranscript` is now unused by the handler — leave the method in place.)

- [ ] **Step 5: Update the ipc-contract stub**

In `tests/unit/ipc-contract.test.ts` line 108, replace `listChatTranscript: async () => [],` with:

```ts
listChatTranscript: async () => ({ items: [], hasMore: false }),
```

- [ ] **Step 6: Rewrite ChatPanel to load the tail window**

In `src/renderer/src/components/chat/ChatPanel.tsx`:

Add `ChatTranscriptItem` to the `@shared/types` import (line 3).

Add a module-level helper (above `FeedMessage`, around line 40) — extracted verbatim from the existing inline mapping so `loadOlder` (Task 3) can reuse it:

```ts
function toFeedItem(it: ChatTranscriptItem): FeedItem {
  return it.kind === 'message'
    ? {
        kind: 'message', id: it.message.id, role: it.message.role,
        text: it.message.displayText ?? it.message.text,
        reasoning: it.message.reasoning, images: it.message.images
      }
    : { kind: 'tool', id: it.tool.id, call: { ...it.tool } }
}
```

Add a `hasMore` state next to the other `useState` items:

```ts
const [hasMore, setHasMore] = useState(false)
```

Replace `loadTranscript` (lines 209-231) with:

```ts
const loadTranscript = useCallback(() => {
  void window.api.listChatTranscript(agentId).then(({ items: tail, hasMore }) => {
    setItems(tail.map(toFeedItem))
    setHasMore(hasMore)
    // Mức chiếm dụng context = token của assistant message cuối cùng có output,
    // giống cách opencode chọn (subagent-footer.tsx:35). Scans the loaded tail.
    let used: number | null = null
    for (let i = tail.length - 1; i >= 0; i--) {
      const it = tail[i]
      if (it.kind !== 'message') continue
      const t = it.message.tokens
      if (it.message.role === 'assistant' && t && t.output > 0) { used = contextTokens(t); break }
    }
    setContextUsed(used)
    scroll.pinSessionToEnd()
  })
}, [agentId, scroll.pinSessionToEnd])
```

- [ ] **Step 7: Lazy-load message images**

In `FeedMessage` (lines 88-94), add lazy attributes to the `<img>`:

```tsx
<img
  key={img.id}
  src={img.dataUrl}
  alt={img.name}
  className="chat-thumb"
  loading="lazy"
  decoding="async"
  onClick={() => onOpenImage?.(img.dataUrl)}
/>
```

- [ ] **Step 8: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS.

```bash
git add src/main/meow-agent-manager.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts src/renderer/src/components/chat/ChatPanel.tsx tests/unit/ipc-contract.test.ts
git commit -m "feat(chat): paginated transcript over IPC (tail window + hasMore)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: "Load earlier" — prepend older transcript pages

Adds on-demand prepending: an exposed `leaveFollowMode()` on the scroll controller, a `loadOlder` callback that fetches `{ beforeId: <first transcript item id> }`, prepends deduped items, preserves the viewport, and a button shown when `hasMore`.

**Files:**
- Modify: `src/renderer/src/components/chat/useChatScroll.ts` — expose `leaveFollowMode` in `ChatScrollController` + return
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` — `loadOlder`, button in the feed content, CSS class
- Modify: `src/renderer/src/styles.css` — `.chat-load-earlier` style

**Interfaces:**
- Consumes: Task 2's `listChatTranscript(agentId, opts)` + `toFeedItem` + `hasMore` state.
- Produces: `loadOlder(): void`; button element `{hasMore && <button className="chat-load-earlier" ...>}` as the first child of `.chat-feed-content` (line 845-846).

- [ ] **Step 1: Expose `leaveFollowMode` on the scroll controller**

In `src/renderer/src/components/chat/useChatScroll.ts`:

Add to the `ChatScrollController` interface (near `pinSessionToEnd`, line 23):

```ts
leaveFollowMode(): void
```

Add a callback (after `enterManual`, line 209):

```ts
const leaveFollowMode = useCallback(() => { enterManual() }, [enterManual])
```

Add it to the returned object (near `pinSessionToEnd`, line 285):

```ts
leaveFollowMode,
```

This makes a prepend scroll-preserving (Task 3 Step 3) — `ResizeObserver` fires `reconcile` when the content grows; in follow mode it would snap to the bottom, undoing the prepend.

- [ ] **Step 2: Add the `loadOlder` callback in ChatPanel**

After `loadTranscript` (line 231), but only when not already loading (guard with a ref to avoid double-clicks):

```ts
const loadingOlderRef = useRef(false)
const loadOlder = useCallback(() => {
  if (loadingOlderRef.current) return
  const first = items.find(i => i.kind === 'message' || i.kind === 'tool')
  if (!first) return
  loadingOlderRef.current = true
  scroll.leaveFollowMode()
  const prevScrollHeight = scroll.feedRef.current?.scrollHeight ?? 0
  void window.api.listChatTranscript(agentId, { limit: 50, beforeId: first.id })
    .then(({ items: older, hasMore }) => {
      setItems(prev => {
        const existing = new Set(prev.map(i => `${i.kind}:${i.id}`))
        const fresh = older.map(toFeedItem).filter(i => !existing.has(`${i.kind}:${i.id}`))
        return [...fresh, ...prev]
      })
      setHasMore(hasMore)
      // Everything below the insert point shifted down by the height of the
      // prepended rows; move scrollTop by that much to keep the viewport anchored.
      requestAnimationFrame(() => {
        const feed = scroll.feedRef.current
        if (feed) feed.scrollTop += feed.scrollHeight - prevScrollHeight
      })
    })
    .finally(() => { loadingOlderRef.current = false })
}, [agentId, items, scroll])
```

`first.id` equals `it.message.id` / `it.tool.id` (from `toFeedItem`) — the exact id `transcriptWindow` matches on.

- [ ] **Step 3: Render the button at the top of the feed content**

At `src/renderer/src/components/chat/ChatPanel.tsx` line 845-846, immediately before `{items.map(...)}`, inside `.chat-feed-content`:

```tsx
<div className="chat-feed-content" ref={scroll.contentRef}>
  {hasMore && (
    <button className="chat-load-earlier" onClick={loadOlder}>Load earlier</button>
  )}
  {items.map(item => {
    ...
```

- [ ] **Step 4: Style the button in `src/renderer/src/styles.css`**

```css
.chat-load-earlier {
  width: 100%;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted, inherit);
  font-size: 12px;
  cursor: pointer;
}
.chat-load-earlier:hover { color: var(--accent, inherit); }
```

(`--muted`/`--accent` already exist in the theme; keep the fallback if unsure.)

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck`
Expected: PASS. (Manual smoke: long session loads 50, scroll to top, click button, older items appear, viewport stays put.)

```bash
git add src/renderer/src/components/chat/useChatScroll.ts src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css
git commit -m "feat(chat): load earlier transcript pages on demand

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Lightweight `workspace:activate` IPC

New IPC slot so the renderer can re-activate an already-loaded project without the full `WorkspaceOpen` work (no agent re-registration, no tools/MCP init, no PTY start).

**Files:**
- Modify: `src/shared/ipc.ts` — `Channels.WorkspaceActivate` + `AgentApi.activateWorkspace`
- Modify: `src/preload/index.ts` — `activateWorkspace` impl
- Modify: `src/main/index.ts` — `MainApp.activateWorkspace` method + `ipcMain.handle` for the channel
- Modify: `tests/unit/ipc-contract.test.ts` — required list + stub + channel mapping

**Interfaces:**
- Consumes: existing `MainApp.workspaces`, `activeProject`, `meowAgent.setProjectPath`, `startGitPoll`, `startFileWatcher`, `closeAllTerminals`, `runtimeFor`.
- Produces: `Channels.WorkspaceActivate = 'workspace:activate'`; `AgentApi.activateWorkspace(projectPath: string): Promise<WorkspaceRuntime>`; `MainApp.activateWorkspace(projectPath: string): Promise<WorkspaceRuntime>`.

- [ ] **Step 1: Add the channel in `src/shared/ipc.ts`**

Next to `WorkspaceOpen: 'workspace:open'` (line 15):

```ts
WorkspaceActivate: 'workspace:activate',
```

- [ ] **Step 2: Add the `AgentApi` method**

Next to `openWorkspace` (line 186):

```ts
activateWorkspace(projectPath: string): Promise<WorkspaceRuntime>
```

- [ ] **Step 3: Implement in `src/preload/index.ts`**

Next to the `openWorkspace` impl:

```ts
activateWorkspace: (projectPath: string) => ipcRenderer.invoke(Channels.WorkspaceActivate, projectPath),
```

- [ ] **Step 4: Add the main method in `src/main/index.ts`**

Directly below `openWorkspace` (line 457):

```ts
// Lightweight activation for an already-open workspace: unlike openWorkspace,
// it does NOT re-register agents, re-run prepareWorkspace (tools/MCP), or start
// PTY processes — it only repoints activeProject and the git/file pollers so the
// UI toggles back instantly while the hidden project's agent loop keeps running.
async activateWorkspace(projectPath: string): Promise<WorkspaceRuntime> {
  const ws = this.workspaces.get(projectPath)
  if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
  this.closeAllTerminals()
  this.activeProject = projectPath
  this.meowAgent.setProjectPath(projectPath)
  const rt = this.runtimeFor(ws)
  this.startGitPoll(projectPath)
  this.startFileWatcher(projectPath)
  return rt
}
```

- [ ] **Step 5: Register the handler**

Next to `Channels.WorkspaceOpen` (line 719):

```ts
ipcMain.handle(Channels.WorkspaceActivate, (_e, projectPath: string) =>
  mainApp.activateWorkspace(projectPath))
```

- [ ] **Step 6: Update `tests/unit/ipc-contract.test.ts`**

1. Add `'activateWorkspace'` to the `required` array right after `'openWorkspace'` (line 10).
2. Add the stub next to `openWorkspace` (line 40):

```ts
activateWorkspace: async () => ({ workspace: { projectPath: '', name: '', agents: [] }, agents: [], git: null }),
```

3. Add the channel mapping (near line 169):

```ts
expect(Channels.WorkspaceActivate).toBe('workspace:activate')
```

- [ ] **Step 7: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS — including the new channel mapping and `activateWorkspace` stub.

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(ipc): lightweight workspace activation channel

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Keep-alive renderer — multi-runtime + WorkspaceView + fast activate

The core refactor. Replace the single `runtime` with `runtimes: Record<projectPath, WorkspaceRuntime>` + LRU `keepAliveOrder`, extract the pane shell into a reusable `WorkspaceView` component, render hidden projects in `display:none` containers so their ChatPanels keep streaming, route App-level events to the right project entry, and make activation a fast toggle using Task 4's IPC. No eviction yet (Task 6).

**Files:**
- Modify: `src/renderer/src/App.tsx` — state refactor, `WorkspaceView`, `openWorkspace`/`activate`, event routing, `removeWorkspace`/`removeAgent`, render
- Modify: `src/renderer/src/styles.css` — `.workspace-hidden { display: none; }`

**Interfaces:**
- Consumes: `AgentApi.activateWorkspace` (Task 4).
- Produces: module-level `WorkspaceView` component; App helpers `setRuntimes`, `setKeepAliveOrder`, `setActivePath`, `openWorkspace(path)`, `activate(path)`, `handleWorkspaceActiveChange(path, id)`; refs `runtimesRef`, `orderRef`, `activePathRef`.

- [ ] **Step 1: Replace the single-runtime state with a per-project map**

Replace line 31 (`const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null)`) and line 66-67 (`runtimeRef`) with:

```ts
// Loaded project workspaces kept alive so switching back is instant — hidden
// ones stay mounted (CSS display:none) and keep consuming ChatEvents.
const [runtimes, setRuntimesState] = useState<Record<string, WorkspaceRuntime>>({})
const [activePath, setActivePathState] = useState<string | null>(null)
const [keepAliveOrder, setKeepAliveOrderState] = useState<string[]>([])
// Refs mirror the state for use inside stable mount-once subscriptions / callbacks.
const runtimesRef = useRef<Record<string, WorkspaceRuntime>>({})
const orderRef = useRef<string[]>([])
const activePathRef = useRef<string | null>(null)

const setRuntimes = useCallback((updater: (prev: Record<string, WorkspaceRuntime>) => Record<string, WorkspaceRuntime>) => {
  setRuntimesState(prev => {
    const next = updater(prev)
    runtimesRef.current = next
    return next
  })
}, [])

const setKeepAliveOrder = useCallback((updater: (prev: string[]) => string[]) => {
  setKeepAliveOrderState(prev => {
    const next = updater(prev)
    orderRef.current = next
    return next
  })
}, [])

const setActivePath = useCallback((path: string | null) => {
  activePathRef.current = path
  setActivePathState(path)
}, [])
```

`activePathRef` mirrors `activePath` so the mount-once `onActivateAgent` effect and events never read a stale value.

- [ ] **Step 2: Route App-level event handlers to the owning project**

In the mount effect (lines 97-168), replace the three `setRuntime`-based handlers:

`onAgentState` (lines 106-110) — update the entry whose workspace owns the agent, and drop the entry update into `setRuntimes`:

```ts
const offState = window.api.onAgentState(({ agentId, state }) => {
  const path = Object.keys(runtimesRef.current).find(p =>
    runtimesRef.current[p].workspace.agents.some(a => a.id === agentId))
  if (!path) return
  setRuntimes(prev => ({
    ...prev,
    [path]: { ...prev[path], agents: prev[path].agents.map(a => (a.agentId === agentId ? state : a)) }
  }))
})
```

(`runningAgentsRef` maintenance lives in Task 6.)

`onGitStatus` (lines 111-115) — key by projectPath directly:

```ts
const offGit = window.api.onGitStatus(({ projectPath, git }) => {
  setRuntimes(prev => (prev[projectPath] ? { ...prev, [projectPath]: { ...prev[projectPath], git } } : prev))
})
```

`onAgentConfig` (lines 119-129) — find the owning entry:

```ts
const offConfig = window.api.onAgentConfig(({ agentId, config }) => {
  const path = Object.keys(runtimesRef.current).find(p =>
    runtimesRef.current[p].workspace.agents.some(a => a.id === agentId))
  if (!path) return
  setRuntimes(prev => ({
    ...prev,
    [path]: {
      ...prev[path],
      workspace: {
        ...prev[path].workspace,
        agents: prev[path].workspace.agents.map(a => a.id === agentId ? config : a)
      }
    }
  }))
})
```

The other subscriptions (`onPtyData`, `onAgentBackground`, `onTerminalExit`, `onArtifactsChanged`, `onUpdaterStatus`, `onBrowser*`) already key by agentId/projectPath — leave them as-is.

- [ ] **Step 3: Rewrite `openWorkspace` and add `activate`**

Replace `openWorkspace` (lines 211-225) and keep `openWorkspaceRef`. Add `activate` below it:

```ts
const openWorkspace = useCallback(async (path: string) => {
  for (const t of terminals) {
    termsRef.current.delete(t.id)
    buffersRef.current.delete(t.id)
  }
  const rt = await window.api.openWorkspace(path)
  const list = await window.api.listArtifacts(path)
  setRuntimes(prev => ({ ...prev, [path]: rt }))
  setActivePath(path)
  // Most recently used at the head of keepAliveOrder.
  setKeepAliveOrder(prev => [path, ...prev.filter(p => p !== path)])
  setTerminals([])
  setArtifacts(prev => ({ ...prev, [path]: list }))
  setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
  for (const id of buffersRef.current.keys()) {
    if (!rt.workspace.agents.some(a => a.id === id)) buffersRef.current.delete(id)
  }
}, [terminals])

// Fast toggle for an already-loaded project: main only repoints activeProject +
// pollers and closes terminals (closed terminals clear their xterm state here).
const activate = useCallback((path: string) => {
  if (!runtimesRef.current[path]) {
    void openWorkspace(path)
    return
  }
  for (const t of terminals) {
    termsRef.current.delete(t.id)
    buffersRef.current.delete(t.id)
  }
  setTerminals([])
  setActivePath(path)
  setKeepAliveOrder(prev => [path, ...prev.filter(p => p !== path)])
  void window.api.activateWorkspace(path).then(rt => {
    // Refresh the cached entry's agent states (statuses may have moved while hidden).
    setRuntimes(prev => (prev[path] ? { ...prev[path], agents: rt.agents } : prev))
  })
}, [openWorkspace, terminals])
const activateRef = useRef(activate)
activateRef.current = activate
```

- [ ] **Step 4: Extract `WorkspaceView` and switch the notification handler to `activate`**

Add `PaneTabs`/`BackgroundPanel`/`EmptyState` are already imported. Remove the inline `panes`/`activeId` memos (lines 298-323) and `handleActiveChange` (lines 278-282), and add this module-level component (place it above `App`, after the `PaneModel` export):

```tsx
function WorkspaceView({
  runtime, terminals, backgrounds, activeTabByPath,
  onActiveChange, onRemovePane, onRegisterTerminal, onUnregisterTerminal, isTerminal
}: {
  runtime: WorkspaceRuntime
  terminals: TerminalInfo[]
  backgrounds: Record<string, boolean>
  activeTabByPath: Record<string, string>
  onActiveChange: (path: string, id: string) => void
  onRemovePane: (path: string, id: string) => void
  onRegisterTerminal: (agentId: string, term: Terminal) => void
  onUnregisterTerminal: (agentId: string) => void
  isTerminal: (id: string) => boolean
}) {
  const panes: PaneModel[] = useMemo(() => {
    const agentPanes = runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'spawning', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    }))
    const terminalPanes: PaneModel[] = terminals.map(term => ({
      agent: { id: term.id, name: term.name, templateId: '__terminal__', cwd: term.cwd, kind: 'pty' as const },
      state: { agentId: term.id, status: 'running' as const, exitCode: null, lastOutputAt: null, alert: 'normal' as const },
      git: runtime.git
    }))
    return [...agentPanes, ...terminalPanes]
  }, [runtime, terminals])

  const activeId = useMemo(() => {
    if (panes.length === 0) return null
    const remembered = activeTabByPath[runtime.workspace.projectPath]
    return remembered && panes.some(p => p.agent.id === remembered) ? remembered : (panes[0]?.agent.id ?? null)
  }, [panes, runtime.workspace.projectPath, activeTabByPath])

  if (panes.length === 0) return <EmptyState hasWorkspace />

  return (
    <>
      <PaneTabs
        panes={panes}
        activeId={activeId}
        onActiveChange={id => onActiveChange(runtime.workspace.projectPath, id)}
        backgrounds={backgrounds}
        isTerminal={isTerminal}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
        onRegisterTerminal={onRegisterTerminal}
        onUnregisterTerminal={onUnregisterTerminal}
      />
      <BackgroundPanel
        panes={panes}
        backgrounds={backgrounds}
        onOpen={agentId => void window.api.setAgentBackground(agentId, false)}
        onStop={agentId => {
          const pane = panes.find(p => p.agent.id === agentId)
          if (pane?.agent.kind === 'native') void window.api.stopChat(agentId)
          else void window.api.stopAgent(agentId)
        }}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
      />
    </>
  )
}
```

Add App-level handlers (place near the old `handleActiveChange`):

```ts
const handleWorkspaceActiveChange = useCallback((path: string, id: string) => {
  setActiveTabByPath(prev => (prev[path] === id ? prev : { ...prev, [path]: id }))
}, [])

const handleRemovePane = useCallback((path: string, id: string) => {
  if (terminals.some(t => t.id === id)) removeTerminal(id)
  else void removeAgent(path, id)
}, [terminals, removeTerminal, removeAgent])
```

Rewrite `removeAgent` (lines 251-264) to take the project path and update the map entry:

```ts
const removeAgent = useCallback(async (path: string, agentId: string) => {
  try {
    await window.api.removeAgent(path, agentId)
  } catch {
    /* surface via pane menu later; still refresh */
  }
  termsRef.current.delete(agentId)
  buffersRef.current.delete(agentId)
  const rt = await window.api.openWorkspace(path)
  // Merge the fresh runtime in, but keep the cached git snapshot (runtimeFor
  // returns git:null — do not clobber a real status we already show).
  setRuntimes(prev => (prev[path]
    ? { ...prev[path], ...rt, git: rt.git ?? prev[path].git }
    : { ...prev, [path]: rt }))
  setWorkspaces(await window.api.listWorkspaces())
}, [])
```

In the notification effect (line 196), replace the `openWorkspaceRef` call with the fast toggle:

```ts
if (activePathRef.current !== projectPath) {
  void activateRef.current(projectPath)
}
```

- [ ] **Step 5: Update `removeWorkspace`**

Replace `removeWorkspace` (lines 229-249):

```ts
const removeWorkspace = useCallback(async (path: string) => {
  const rt = runtimesRef.current[path]
  if (rt) {
    for (const agent of rt.workspace.agents) {
      termsRef.current.delete(agent.id)
      buffersRef.current.delete(agent.id)
    }
  }
  try {
    await window.api.removeWorkspace(path)
  } catch {
    /* surface via sidebar later; still refresh list */
  }
  setRuntimes(prev => {
    if (!(path in prev)) return prev
    const next = { ...prev }
    delete next[path]
    return next
  })
  setKeepAliveOrder(prev => prev.filter(p => p !== path))
  setActiveTabByPath(prev => {
    if (!(path in prev)) return prev
    const next = { ...prev }
    delete next[path]
    return next
  })
  if (activePathRef.current === path) {
    // Main already reset activeProject (WorkspaceRemove). Repoint at the next
    // most recently used remaining project, or clear.
    const next = (orderRef.current.filter(p => p !== path))[0] ?? null
    setActivePath(next)
    if (next) void window.api.activateWorkspace(next)
  }
  void refreshWorkspaces()
}, [refreshWorkspaces])
```

- [ ] **Step 6: Rewrite the render to mount every kept-alive project**

Replace the `<main className="main">` block (lines 343-371):

```tsx
<main className="main">
  {activePath && runtimes[activePath] && (
    <div className="workspace-active">
      <WorkspaceView
        runtime={runtimes[activePath]}
        terminals={terminals}
        backgrounds={backgrounds}
        activeTabByPath={activeTabByPath}
        onActiveChange={handleWorkspaceActiveChange}
        onRemovePane={handleRemovePane}
        onRegisterTerminal={registerTerminal}
        onUnregisterTerminal={unregisterTerminal}
        isTerminal={id => terminals.some(t => t.id === id)}
      />
    </div>
  )}
  {/* Hidden projects stay mounted (display:none) so their ChatPanels keep
      consuming ChatEvents and the transcript stays live. No terminals: they
      are closed on switch and never kept alive. */}
  {keepAliveOrder
    .filter(p => p !== activePath && runtimes[p])
    .map(p => (
      <div className="workspace-hidden" key={p} aria-hidden="true">
        <WorkspaceView
          runtime={runtimes[p]}
          terminals={[]}
          backgrounds={backgrounds}
          activeTabByPath={activeTabByPath}
          onActiveChange={handleWorkspaceActiveChange}
          onRemovePane={handleRemovePane}
          onRegisterTerminal={registerTerminal}
          onUnregisterTerminal={unregisterTerminal}
          isTerminal={() => false}
        />
      </div>
    ))}
</main>
```

- [ ] **Step 7: Point the App-level chrome at the active runtime**

Replace remaining `runtime?....projectPath ?? null` usages with `activePath`/`runtimes[activePath]`:

- `Sidebar` (line 333): `activePath={activePath}`
- `RightPanel` (lines 372-385): `root={activePath ?? null}`, `artifacts={artifacts[activePath ?? ''] ?? []}`, and `onClearArtifacts` uses `activePath`.
- `StatusBar` (lines 387-394): introduce `const activeRuntime = activePath ? (runtimes[activePath] ?? null) : null` before `return`, then use `activeRuntime?.workspace.name`, `activeRuntime?.git`, `activeRuntime?.agents`, and `onGitClick={activeRuntime ? () => void window.api.gitOpenViewer(activeRuntime.workspace.projectPath) : undefined}`.
- `SettingsDialog` (lines 411-420): `projectPath={activePath ?? undefined}`, `agentId={activePath ? (runtimes[activePath]?.workspace.agents[0]?.id) : undefined}`.

If nothing else references the removed `runtime`/`panes`/`activeId` after this, delete the leftover `runtimeRef` (lines 66-67).

- [ ] **Step 8: Hide inactive views via CSS**

In `src/renderer/src/styles.css`:

```css
/* Keep-alive workspace panes that stay mounted but hidden; they stream
   ChatEvents in the background and toggle back instantly. */
.workspace-hidden { display: none; }
```

- [ ] **Step 9: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

Manual smoke:
1. Open project A, send a message, then open project B. Switch back to A → feed renders instantly (no reload flash), same scroll position.
2. While B is active, start a long turn in A (switch to A, send, immediately switch to B). Switch back to A mid-turn → the turn's output is already rendered from the kept-alive panel.
3. Terminal pane still opens/closes normally and is closed on project switch (unchanged behavior).

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(chat): keep-alive workspace panes (multi-runtime, instant reactivation)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: LRU eviction — `MAX_KEEP_ALIVE = 5`, never evict a running agent

Bound keep-alive memory. Track `runningAgents`, evict the LRU project when the map exceeds `MAX_KEEP_ALIVE`, skip any whose agent is running and retry when its turn ends.

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `runtimesRef`, `orderRef`, `activePathRef`, `setRuntimes`, `setKeepAliveOrder` (Task 5).
- Produces: `MAX_KEEP_ALIVE` const; `runningAgentsRef: MutableRefObject<Set<string>>`; `evictIfNeeded(): void`.

- [ ] **Step 1: Declare the constant and the running set**

At module scope (near `PaneModel`) and inside `App` (near the other refs):

```ts
export const MAX_KEEP_ALIVE = 5
```

```ts
// agentIds with a turn in flight — eviction skips projects owning any of these.
const runningAgentsRef = useRef<Set<string>>(new Set())
```

- [ ] **Step 2: Maintain `runningAgentsRef`**

In the mount effect's `onAgentState` handler (replacing the Task 5 Step 2 version):

```ts
const offState = window.api.onAgentState(({ agentId, state }) => {
  if (state.status === 'running') runningAgentsRef.current.add(agentId)
  else runningAgentsRef.current.delete(agentId)
  const path = Object.keys(runtimesRef.current).find(p =>
    runtimesRef.current[p].workspace.agents.some(a => a.id === agentId))
  if (!path) return
  setRuntimes(prev => ({
    ...prev,
    [path]: { ...prev[path], agents: prev[path].agents.map(a => (a.agentId === agentId ? state : a)) }
  }))
})
```

Add a new effect so eviction also retries the moment a hidden project's turn ends
(`evictIfNeeded` is stable, so it is safe in the deps list):

```ts
useEffect(() => {
  return window.api.onChatEvent((e) => {
    if (e.agentId == null) return
    if (e.type === 'turn-started') runningAgentsRef.current.add(e.agentId)
    else if (e.type === 'done' || e.type === 'error') {
      runningAgentsRef.current.delete(e.agentId)
      evictIfNeeded()
    }
  })
}, [evictIfNeeded])
```

- [ ] **Step 3: Add `evictIfNeeded`**

Below `activate` / `activateRef` (Task 5 Step 3):

```ts
// Keeps at most MAX_KEEP_ALIVE projects mounted. Only the single LRU project
// (tail of keepAliveOrder, never the active one) is a candidate; if its agent is
// still running the eviction waits — stepping aside means dropping the one
// project the user just switched away from, which is usually the least safe to
// unmount. Retry happens on 'done'/'error' via evictIfNeeded().
const evictIfNeeded = useCallback((): void => {
  const victims: string[] = []
  const order = [...orderRef.current]
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i]
    if (p === activePathRef.current) continue
    const rt = runtimesRef.current[p]
    if (rt && rt.workspace.agents.some(a => runningAgentsRef.current.has(a.id))) break
    victims.push(p)
    if (order.length - victims.length <= MAX_KEEP_ALIVE) break
  }
  if (victims.length === 0) return
  for (const p of victims) {
    for (const a of runtimesRef.current[p]?.workspace.agents ?? []) {
      termsRef.current.delete(a.id)
      buffersRef.current.delete(a.id)
    }
  }
  const victimSet = new Set(victims)
  setRuntimes(prev => {
    const next = { ...prev }
    for (const p of victimSet) delete next[p]
    return next
  })
  setKeepAliveOrder(prev => prev.filter(p => !victimSet.has(p)))
}, [setRuntimes, setKeepAliveOrder])
```

(No agents are stopped — this only unmounts the panel; the main loop keeps running, matching the pre-keep-alive behavior for a project not currently shown.)

- [ ] **Step 4: Call `evictIfNeeded` after every mount / activation**

At the end of `openWorkspace` and `activate` (Task 5 Step 3), after the `setKeepAliveOrder(...)` calls:

```ts
evictIfNeeded()
```

`evictIfNeeded` is stable (`useCallback` with stable deps) so it can appear in both closures and the `onChatEvent` effect without stale reads.

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck`
Expected: PASS.

Manual smoke (spec §5 item 4): open 6 projects → the oldest (non-active, non-running) project is evicted without crash; a project whose agent is mid-turn is NOT evicted until the turn ends; eviction keeps working after `done` arrives.

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(chat): keep-alive LRU eviction (max 5, skip running agents)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `src/shared/AGENTS.md` — record the `WorkspaceActivate` channel and the changed `listChatTranscript` signature
- Modify: any other `AGENTS.md`/`CLAUDE.md` that describes App state or the IPC contract if found stale (search first)

- [ ] **Step 1: Update `src/shared/AGENTS.md`**

In the "Conventions" section, note the two contract changes:

```markdown
- `Channels.WorkspaceActivate` (`workspace:activate`) is a lightweight re-activation
  for an already-loaded workspace: repoints `activeProject` + git/file pollers and closes
  terminals, but does NOT re-register agents or re-run workspace preparation.
- `listChatTranscript(agentId, opts?)` returns `{ items, hasMore }` (a `TranscriptWindow`
  tail of `limit`, default 50); pass `beforeId` to page older items.
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS (1161+ tests). If `session-store` or `ipc-contract` regressions appear, fix before proceeding.

- [ ] **Step 3: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS for node, web, extension, server.

- [ ] **Step 4: Manual smoke — full spec §5 checklist**

1. Open 2 projects A, B; run agent A, switch to B → A's feed keeps advancing in the background (visible when you switch back).
2. Switch back to A → no empty/standing feed; transcript shows instantly without reload.
3. In A, open a long session (many tools/images) → cold open renders fast (50-item tail); "Load earlier" pages in older items.
4. Open > 5 projects → oldest evicted (no crash); running-agent project survives eviction.
5. Terminal is still closed on project switch (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add src/shared/AGENTS.md
git commit -m "docs: AGENTS.md — keep-alive workspace + paged transcript contract

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---
