# Sessions in Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project→agents(tabs) model with a project→sessions(sidebar) model, and reduce the app to a single "meow" agent type (remove CLI/pty agents, templates, in-app terminals).

**Architecture:** One native agent == one UI "session". A project holds N native agents rendered as a collapsible session list in the sidebar. The existing per-agent parallel/keep-alive/status engine is reused unchanged — switching sessions never stops another. The backend keeps the identifier `agent`; only the UI vocabulary changes to "session".

**Tech Stack:** Electron 41, React 19, TypeScript (strict), Vitest, Playwright. 3 processes (`src/main`, `src/preload`, `src/renderer`) over the IPC contract in `src/shared/ipc.ts`. Alias `@shared` → `src/shared`.

**Spec:** `docs/superpowers/specs/2026-09-12-sessions-in-sidebar-design.md`

## Global Constraints

- Source, UI labels, notifications, and all docs are **English**. UI label for a unit is **"session"** (never "agent").
- Commit messages must **NOT** include a `Co-Authored-By` trailer (see root `AGENTS.md`).
- IPC: never hardcode channel strings — only use `Channels` from `src/shared/ipc.ts`. Keep `AgentApi` (`src/shared/ipc.ts`), the preload implementation (`src/preload/index.ts`), and `tests/unit/ipc-contract.test.ts` in lockstep on every IPC change.
- `src/shared` must not import Node/Electron.
- Only the main process spawns/kills processes; renderer uses `window.api`.
- Update `AGENTS.md` (root + touched module dirs) and matching `docs/reference/` pages in the same commit as the code change.
- After each task: `npm run typecheck` and `npm test` must pass before committing.

---

## File Structure

**Modify:**
- `src/shared/types.ts` — `WorkspaceSummary.agentCount` → `sessions: SessionMeta[]`; keep `AgentKind` but treat `native` as the only used value.
- `src/shared/ipc.ts` — add `AgentRename` channel + `renameAgent` to `AgentApi`; remove terminal/template/nested-session channels + methods.
- `src/preload/index.ts` — mirror the `AgentApi` changes.
- `src/main/workspace-store.ts` — `list()` returns `sessions` metas.
- `src/main/index.ts` — add `AgentRename` handler; simplify `AgentAdd`; remove terminal/template handlers & methods; add one-time fresh-start reset.
- `src/main/meow-agent-manager.ts` — remove nested-session methods (`listSessions`/`createSession`/`switchSession`/`deleteSession`) now unused.
- `src/renderer/src/App.tsx` — remove tabs/terminal plumbing; render active session.
- `src/renderer/src/components/Sidebar.tsx` — expand/collapse projects, session rows, `+`, per-row `...` menu.
- `src/renderer/src/components/chat/ChatPanel.tsx` — remove `SessionBar` + its handlers.
- `src/renderer/src/components/settings/SettingsDialog.tsx` — remove `templates` tab; simplify `agents` tab.
- `src/renderer/src/styles.css` — remove dead tab/terminal CSS; add session-row CSS.

**Create:**
- `src/renderer/src/components/SessionPanes.tsx` — mount-all pane renderer (replaces `PaneTabs`).

**Delete:**
- `src/renderer/src/components/PaneTabs.tsx`
- `src/renderer/src/components/AddAgentDialog.tsx`
- `src/renderer/src/components/XtermHost.tsx`
- `src/renderer/src/components/chat/SessionBar.tsx`
- `src/main/template-manager.ts`, `src/main/default-templates.ts`, `src/main/terminal-shell.ts` (verify no other importers first)
- Terminal/templates unit + e2e tests that no longer apply.

---

## Task 1: Extend `WorkspaceSummary` with session metadata

**Files:**
- Modify: `src/shared/types.ts:39-43`
- Modify: `src/main/workspace-store.ts:8-14`
- Test: `tests/unit/workspace-store.test.ts` (create if absent)

**Interfaces:**
- Produces: `interface SessionMeta { id: string; name: string }` and `WorkspaceSummary { projectPath: string; name: string; sessions: SessionMeta[] }`. `WorkspaceStore.list(): WorkspaceSummary[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workspace-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { WorkspaceStore } from '../../src/main/workspace-store'
import type { Workspace } from '../../src/shared/types'

function fakeStore(initial: Workspace[]) {
  let data = initial
  return { load: () => data, save: (d: Workspace[]) => { data = d } }
}

describe('WorkspaceStore.list', () => {
  it('returns session id+name metas per project', () => {
    const store = new WorkspaceStore(fakeStore([
      { projectPath: '/p', name: 'P', agents: [
        { id: 'a1', name: 'Session 1', templateId: 'meow', cwd: '/p', kind: 'native' }
      ] }
    ]) as never)
    expect(store.list()).toEqual([
      { projectPath: '/p', name: 'P', sessions: [{ id: 'a1', name: 'Session 1' }] }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: FAIL (`list` still returns `agentCount`).

- [ ] **Step 3: Update the type**

In `src/shared/types.ts`, replace lines 39-43:

```typescript
export interface SessionMeta {
  id: string
  name: string
}

export interface WorkspaceSummary {
  projectPath: string
  name: string
  sessions: SessionMeta[]
}
```

- [ ] **Step 4: Update the store**

In `src/main/workspace-store.ts`, replace `list()` (lines 8-14):

```typescript
  list(): WorkspaceSummary[] {
    return this.store.load().map(w => ({
      projectPath: w.projectPath,
      name: w.name,
      sessions: w.agents.map(a => ({ id: a.id, name: a.name }))
    }))
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix compile fallout (typecheck-driven)**

Run: `npx tsc --noEmit -p tsconfig.web.json`. Every `ws.agentCount` reference now errors. Fix each to derive from `sessions`:
- `src/renderer/src/components/Sidebar.tsx:170-172` — the `project-count` span: replace `{ws.agentCount} Agent…` with `{ws.sessions.length} Session{ws.sessions.length === 1 ? '' : 's'}`.
- Any other `agentCount` hit reported by tsc: replace with `ws.sessions.length`.

Run `npx tsc --noEmit -p tsconfig.node.json` too and fix any main-side `agentCount` use.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/workspace-store.ts src/renderer/src/components/Sidebar.tsx tests/unit/workspace-store.test.ts
git commit -m "feat(model): WorkspaceSummary carries session id+name metas"
```

---

## Task 2: Add `renameAgent` IPC

**Files:**
- Modify: `src/shared/ipc.ts` (Channels ~line 122 area, `AgentApi` ~line 295 area)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts` (handler near `AgentRemove` ~line 801)
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Produces: `renameAgent(projectPath: string, agentId: string, name: string): Promise<void>`; channel `Channels.AgentRename = 'agent:rename'`.
- Consumes: `WorkspaceStore.updateAgent(projectPath, agentId, patch)` (exists, `src/main/workspace-store.ts:54`); `Channels.EventAgentConfig` re-send pattern (`src/main/index.ts:570`).

- [ ] **Step 1: Add the failing contract expectation**

In `tests/unit/ipc-contract.test.ts`, add `'renameAgent'` to the `required` method-name array and add a stub in the `api` object:

```typescript
      renameAgent: async () => {},
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL (`renameAgent` missing from `AgentApi`).

- [ ] **Step 3: Declare the channel + API method**

In `src/shared/ipc.ts`, add to the `Channels` object (next to `AgentRemove`):

```typescript
  AgentRename: 'agent:rename',
```

Add to the `AgentApi` interface (next to other agent methods):

```typescript
  renameAgent(projectPath: string, agentId: string, name: string): Promise<void>
```

- [ ] **Step 4: Implement in preload**

In `src/preload/index.ts`, add to the `api` object:

```typescript
  renameAgent: (projectPath: string, agentId: string, name: string) =>
    ipcRenderer.invoke(Channels.AgentRename, projectPath, agentId, name),
```

- [ ] **Step 5: Implement the main handler**

In `src/main/index.ts`, next to the `AgentRemove` handler (~line 801):

```typescript
  ipcMain.handle(Channels.AgentRename, (_e, projectPath: string, agentId: string, name: string) => {
    const ws = mainApp.workspaces.updateAgent(projectPath, agentId, { name })
    const agent = ws.agents.find(a => a.id === agentId)
    if (agent) win?.webContents.send(Channels.EventAgentConfig, { agentId, config: agent })
  })
```

- [ ] **Step 6: Run tests + typecheck to verify pass**

Run: `npx vitest run tests/unit/ipc-contract.test.ts && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(ipc): add renameAgent for session rename"
```

---

## Task 3: One-time fresh-start reset

**Files:**
- Modify: `src/main/index.ts` (boot sequence; the app-ready block that currently purges `traces`, ~line 974)
- Test: `tests/unit/fresh-start-reset.test.ts` (create)

**Interfaces:**
- Produces: `resetToSingleSession(store: WorkspaceStore, opts: { alreadyDone: boolean; clearSessions: () => void; now: () => AgentConfig }): boolean` — pure helper in a new file `src/main/fresh-start.ts`; returns `true` if it performed the reset. Extract logic so it is unit-testable without Electron.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fresh-start-reset.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { resetToSingleSession } from '../../src/main/fresh-start'
import type { Workspace } from '../../src/shared/types'

function fakeStore(initial: Workspace[]) {
  let data = initial
  return { load: () => data, save: (d: Workspace[]) => { data = d }, _data: () => data }
}

describe('resetToSingleSession', () => {
  it('gives each project exactly one native session and clears sessions once', () => {
    const store = fakeStore([
      { projectPath: '/p', name: 'P', agents: [
        { id: 'x', name: 'claude', templateId: 'claude', cwd: '/p', kind: 'pty' },
        { id: 'y', name: 'meow', templateId: 'meow', cwd: '/p', kind: 'native' }
      ] }
    ])
    const clearSessions = vi.fn()
    let n = 0
    const done = resetToSingleSession(store as never, {
      alreadyDone: false,
      clearSessions,
      now: () => ({ id: `n${n++}`, name: 'Session 1', templateId: 'meow', cwd: '/p', kind: 'native' })
    })
    expect(done).toBe(true)
    expect(clearSessions).toHaveBeenCalledOnce()
    const ws = store._data()[0]
    expect(ws.agents).toEqual([{ id: 'n0', name: 'Session 1', templateId: 'meow', cwd: '/p', kind: 'native' }])
  })

  it('is a no-op when already done', () => {
    const store = fakeStore([])
    const clearSessions = vi.fn()
    const done = resetToSingleSession(store as never, { alreadyDone: true, clearSessions, now: () => ({ id: 'z', name: 'Session 1', templateId: 'meow', cwd: '/', kind: 'native' }) })
    expect(done).toBe(false)
    expect(clearSessions).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/fresh-start-reset.test.ts`
Expected: FAIL (`src/main/fresh-start` not found).

- [ ] **Step 3: Implement the helper**

Create `src/main/fresh-start.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import type { AgentConfig, Workspace } from '../shared/types'

interface StoreLike {
  load(): Workspace[]
  save(w: Workspace[]): void
}

export function makeSession(cwd: string): AgentConfig {
  return { id: randomUUID(), name: 'Session 1', templateId: 'meow', cwd, kind: 'native' }
}

/**
 * v0.37 model switch: drop CLI/pty agents and legacy multi-sessions. Each
 * project is reset to exactly one fresh native session. Runs once (guarded by
 * `alreadyDone`); returns whether it performed the reset.
 */
export function resetToSingleSession(
  store: StoreLike,
  opts: { alreadyDone: boolean; clearSessions: () => void; now?: () => AgentConfig }
): boolean {
  if (opts.alreadyDone) return false
  const make = opts.now ?? ((/* cwd bound below */) => makeSession(''))
  const all = store.load()
  for (const ws of all) {
    ws.agents = [opts.now ? make() : makeSession(ws.projectPath)]
  }
  store.save(all)
  opts.clearSessions()
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/fresh-start-reset.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into boot**

In `src/main/index.ts`, in the app-ready block right after the existing `rmSync(... 'traces' ...)` line (~line 975), add:

```typescript
  // v0.37 model switch: one-time reset to a single native session per project.
  const resetFlag = path.join(app.getPath('userData'), '.sessions-model-reset')
  resetToSingleSession(mainApp.workspaces, {
    alreadyDone: existsSync(resetFlag),
    clearSessions: () => rmSync(path.join(app.getPath('userData'), 'sessions.json'), { force: true }),
    now: undefined
  }) && writeFileSync(resetFlag, String(Date.now()))
```

Add imports at the top of `src/main/index.ts` if missing: `existsSync`, `writeFileSync` from `node:fs` (join `rmSync` already imported), and `import { resetToSingleSession } from './fresh-start'`.

> Note: `resetToSingleSession` with `now: undefined` uses `makeSession(ws.projectPath)` per project (correct cwd). The test passes an explicit `now` only to assert ids.

- [ ] **Step 6: Fix the helper for the real cwd path**

Adjust `resetToSingleSession` so the no-`now` branch binds cwd per workspace:

```typescript
  for (const ws of all) {
    ws.agents = [opts.now ? opts.now() : makeSession(ws.projectPath)]
  }
```

Re-run: `npx vitest run tests/unit/fresh-start-reset.test.ts` → PASS. Run `npx tsc --noEmit -p tsconfig.node.json` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/fresh-start.ts src/main/index.ts tests/unit/fresh-start-reset.test.ts
git commit -m "feat(main): one-time fresh-start reset to a single native session per project"
```

---

## Task 4: Remove in-app terminals (backend + IPC)

**Files:**
- Modify: `src/main/index.ts` (methods `openTerminal`/`closeTerminal`/`closeAllTerminals` ~403-419, exit handler ~242-253, handlers `TerminalOpen`/`TerminalClose` ~787-788)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Modify: `src/main/pty-manager.ts` (remove `startTerminal`/`isTerminal`/`terminalIds` only if unused after)
- Delete: `src/main/terminal-shell.ts` (if no other importer)
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Removes IPC: `TerminalOpen`, `TerminalClose`, `EventTerminalExit`, `EventPtyData`, `writeInput`, `resizePty`; `AgentApi` methods `openTerminal`, `closeTerminal`, `onTerminalExit`, `onPtyData`, `writeInput`, `resizePty`. Keep `SystemTerminalOpen`/`openSystemTerminal`.

- [ ] **Step 1: Enumerate the exact surface**

Run: `git grep -n "Terminal\|terminal\|onPtyData\|writeInput\|resizePty\|EventPtyData" src/main/index.ts src/shared/ipc.ts src/preload/index.ts` and note every line. `SystemTerminalOpen`/`openSystemTerminal` STAY; everything else terminal/pty-data related is removed.

- [ ] **Step 2: Update the contract test first (red)**

In `tests/unit/ipc-contract.test.ts`, remove from the `required` array and the `api` stub object: `openTerminal`, `closeTerminal`, `onTerminalExit`, `onPtyData`, `writeInput`, `resizePty`. Keep `openSystemTerminal`.

Run: `npx vitest run tests/unit/ipc-contract.test.ts` → FAIL (api still declares them / main still references channels). This test now drives the removal.

- [ ] **Step 3: Remove from the contract + preload**

In `src/shared/ipc.ts`: delete the channel constants `TerminalOpen`, `TerminalClose`, `EventTerminalExit`, `EventPtyData`, and the `AgentApi` methods listed above. Delete the `TerminalExitEvent`/`PtyDataEvent` types if unused elsewhere (check with `git grep`).
In `src/preload/index.ts`: delete the matching `api` methods and any `TerminalInfo`/pty-data imports left unused.

- [ ] **Step 4: Remove from main**

In `src/main/index.ts`: delete `openTerminal`, `closeTerminal`, `closeAllTerminals`, their call sites (~419, 446, 580), the `TerminalOpen`/`TerminalClose` handlers (~787-788), and the terminal branch in the pty-exit handler (~242-253) — keep the agent-exit path. Remove `resolveShell` import (line 12) and delete `src/main/terminal-shell.ts` if `git grep resolveShell` shows no other user. In `src/main/pty-manager.ts`, remove `startTerminal`/`isTerminal`/`terminalIds` if `git grep` shows no remaining callers.

- [ ] **Step 5: Verify green**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS. (Renderer still references terminals — fixed in Task 7/8; if `tsconfig.web.json` fails here, that is expected and resolved in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove in-app terminals (pty data channels, openTerminal); keep system terminal"
```

---

## Task 5: Remove the CLI/template agent system (backend + IPC)

**Files:**
- Modify: `src/main/index.ts` (`AgentAdd` ~791-796, `TemplateList/Save/Remove` ~849-851, non-native spawn path ~372-403, template import ~8-9,113-114, exit/register branches referencing `kind`)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Delete: `src/main/template-manager.ts`, `src/main/default-templates.ts`
- Test: `tests/unit/ipc-contract.test.ts`, remove `tests/unit/*template*` if any

**Interfaces:**
- `AgentAdd` becomes: always create a native meow session, ignoring any incoming template/kind. Signature stays `addAgent(projectPath, input)` for now (input `name`/`cwd` used; `templateId`/`kind` forced to meow/native).
- Removes IPC: `TemplateList`, `TemplateSave`, `TemplateRemove` + `AgentApi` `listTemplates`/`saveTemplate`/`removeTemplate`.

- [ ] **Step 1: Contract test red**

In `tests/unit/ipc-contract.test.ts` remove `listTemplates`, `saveTemplate`, `removeTemplate` from `required` + `api` stub. Run → FAIL.

- [ ] **Step 2: Simplify `AgentAdd` in main**

Replace the `AgentAdd` handler body (~791-796) so it never consults templates:

```typescript
  ipcMain.handle(Channels.AgentAdd, async (_e, projectPath: string, input: NewAgentInput) => {
    const ws = mainApp.workspaces.addAgent(projectPath, {
      name: input.name,
      templateId: 'meow',
      cwd: input.cwd,
      kind: 'native'
    })
    const added = ws.agents[ws.agents.length - 1]
    mainApp.meowAgent.addAgent(added)
    return added
  })
```

- [ ] **Step 3: Remove templates + non-native spawn**

In `src/main/index.ts`: delete the `TemplateList/Save/Remove` handlers (~849-851), the `templates = new TemplateManager(...)` field (~113-114), imports (~8-9), and the entire non-native PTY spawn path (`if (agent.kind === 'native') return` guard block ~372-403 and any `this.templates.list()` lookups ~263,373). Native agents never spawn a PTY. In the register/openWorkspace path (~427) keep only `this.meowAgent.addAgent(agent)`.
In `src/shared/ipc.ts` + `src/preload/index.ts`: remove the template channels + `AgentApi` methods.
Delete `src/main/template-manager.ts` and `src/main/default-templates.ts` (confirm no importers via `git grep`).

- [ ] **Step 4: Verify green (node side)**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove CLI/template agents; new session is always native meow"
```

---

## Task 6: Remove the in-chat `SessionBar` + nested-session IPC

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` (import line 11, JSX ~861, handlers `handleCreateSession`/`handleSelectSession`/`handleDeleteSession`/`handleRenameSession` ~664-690, `sessions`/`activeSessionId` state ~171-172, `reloadSessions` ~300-303)
- Delete: `src/renderer/src/components/chat/SessionBar.tsx`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` (SessionList/Create/Switch/Delete/Rename ~909-912 + newChatSession), `src/main/meow-agent-manager.ts` (`listSessions`/`createSession`/`switchSession`/`deleteSession` ~253-292)
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- The renderer no longer creates/switches sessions from the chat frame. `activeSessionId`/`sessions` state and `reloadSessions` are removed from `ChatPanel`; anything that only fed the `SessionBar` goes with it. Keep session **cost/tokens** state (`sessionCost`, `sessionTokens`) — those are per-turn readouts, not the session list.
- Removes IPC: `SessionList`, `SessionCreate`, `SessionSwitch`, `SessionDelete`, `SessionRename`, `ChatSessionNew`(`newChatSession`) — verify each is unused elsewhere with `git grep` first; `deleteSession`/`renameSession` on the store stay (used by the manager internally).

- [ ] **Step 1: Contract test red**

In `tests/unit/ipc-contract.test.ts` remove the nested-session methods that exist in the `required` list (`listSessions`, `createSession`, `switchSession`, `deleteSession`, `renameSession`, `newChatSession`) from both `required` and the `api` stub. Run → FAIL.

- [ ] **Step 2: Strip `SessionBar` from `ChatPanel`**

Remove `import SessionBar from './SessionBar'` (line 11) and the `<SessionBar .../>` JSX (~861). Remove `sessions`/`activeSessionId` state (~171-172), the four session handlers (~664-690), and the `reloadSessions` calls/definition (~300-303 and its call sites) **only where they feed the removed bar** — keep the transcript reload logic that reloads the active session's messages if it is reused for the feed. If `reloadSessions` is only used for the bar, delete it and its calls. Let typecheck guide which references remain.

- [ ] **Step 3: Delete the file + remove IPC**

Delete `src/renderer/src/components/chat/SessionBar.tsx`.
In `src/shared/ipc.ts` + `src/preload/index.ts`: remove the nested-session channels + `AgentApi` methods verified unused in Step 1.
In `src/main/index.ts`: remove the handlers (~909-912 + newChatSession).
In `src/main/meow-agent-manager.ts`: remove the now-unused public methods `listSessions`, `createSession`, `switchSession`, `deleteSession` (keep the private `activeSessionId` — the transcript store still needs one session per agent).

- [ ] **Step 4: Verify green**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS. (If `App.tsx` still imports terminals/PaneTabs, web typecheck fails — proceed to Task 7 which fixes App; you may do Tasks 6+7 back-to-back before the web typecheck is fully green.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove in-chat SessionBar and nested-session IPC"
```

---

## Task 7: App main-area — render active session, drop tabs/terminals

**Files:**
- Create: `src/renderer/src/components/SessionPanes.tsx`
- Modify: `src/renderer/src/App.tsx` (`WorkspaceView` 32-95, terminal state/effects/handlers throughout)
- Delete: `src/renderer/src/components/PaneTabs.tsx`, `src/renderer/src/components/XtermHost.tsx`
- Modify: `src/renderer/src/components/BackgroundPanel.tsx` (drop pty branch if any)

**Interfaces:**
- `SessionPanes` props: `{ panes: PaneModel[]; activeId: string | null; onActiveChange: (id: string) => void; backgrounds: Record<string, boolean>; onRemove: (id: string) => void }`. Renders every pane mounted; only `activeId` is visible (`hidden` on the rest). No tab bar, no terminals.
- `PaneModel` stays `{ agent: AgentConfig; state: AgentState; git: GitStatus | null }`.

- [ ] **Step 1: Create `SessionPanes`**

Create `src/renderer/src/components/SessionPanes.tsx`:

```typescript
import { useEffect } from 'react'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  activeId: string | null
  onActiveChange: (id: string) => void
  backgrounds: Record<string, boolean>
  onRemove: (id: string) => void
}

// All sessions stay mounted (hidden when inactive) so a hidden session keeps
// streaming/running — switching never stops another.
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove }: Props) {
  useEffect(() => {
    if (panes.length === 0) return
    if (activeId && panes.some(p => p.agent.id === activeId)) return
    onActiveChange(panes[0].agent.id)
  }, [panes, activeId, onActiveChange])

  const active = panes.find(p => p.agent.id === activeId) ?? panes[0]

  return (
    <div className="session-panes">
      {panes.map(pane => (
        <div key={pane.agent.id} className="pane-slot" hidden={pane.agent.id !== active?.agent.id}>
          <Pane
            pane={pane}
            background={Boolean(backgrounds[pane.agent.id])}
            isTerminal={false}
            active={pane.agent.id === active?.agent.id}
            onFocus={() => onActiveChange(pane.agent.id)}
            onRemove={() => onRemove(pane.agent.id)}
            onRegisterTerminal={() => {}}
            onUnregisterTerminal={() => {}}
          />
        </div>
      ))}
    </div>
  )
}
```

> `Pane`'s `onRegisterTerminal`/`onUnregisterTerminal`/`isTerminal` props become vestigial; leave the props on `Pane` for now (no-ops) to keep this task small — a later cleanup can drop them.

- [ ] **Step 2: Add CSS for the pane slots**

In `src/renderer/src/styles.css`, near the removed `.agent-pane-container` rules, add:

```css
.session-panes { flex: 1; display: flex; min-width: 0; min-height: 0; }
.session-panes .pane-slot { flex: 1; display: flex; min-width: 0; min-height: 0; }
.session-panes .pane-slot[hidden] { display: none !important; }
```

- [ ] **Step 3: Rewrite `WorkspaceView`**

In `src/renderer/src/App.tsx`, replace `WorkspaceView` (lines 32-95) with a version that drops terminals and uses `SessionPanes`:

```typescript
function WorkspaceView({
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane
}: {
  runtime: WorkspaceRuntime
  backgrounds: Record<string, boolean>
  activeSessionByPath: Record<string, string>
  onActiveChange: (path: string, id: string) => void
  onRemovePane: (path: string, id: string) => void
}) {
  const panes: PaneModel[] = useMemo(() =>
    runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'idle', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    })), [runtime])

  const activeId = useMemo(() => {
    if (panes.length === 0) return null
    const remembered = activeSessionByPath[runtime.workspace.projectPath]
    return remembered && panes.some(p => p.agent.id === remembered) ? remembered : (panes[0]?.agent.id ?? null)
  }, [panes, runtime.workspace.projectPath, activeSessionByPath])

  if (panes.length === 0) return <EmptyState hasWorkspace />

  return (
    <>
      <SessionPanes
        panes={panes}
        activeId={activeId}
        onActiveChange={id => onActiveChange(runtime.workspace.projectPath, id)}
        backgrounds={backgrounds}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
      />
      <BackgroundPanel
        panes={panes}
        backgrounds={backgrounds}
        onOpen={agentId => void window.api.setAgentBackground(agentId, false)}
        onStop={agentId => void window.api.stopChat(agentId)}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
      />
    </>
  )
}
```

Update the import at the top: replace `import PaneTabs from './components/PaneTabs'` with `import SessionPanes from './components/SessionPanes'`. Rename the `activeTabByPath` state and `handleWorkspaceActiveChange` usages to `activeSessionByPath` (keep the localStorage key `meow.activeTabByPath` to preserve persistence, or rename to `meow.activeSessionByPath` — pick rename; it is wiped anyway). Update both `<WorkspaceView>` call sites (active + hidden) to pass `activeSessionByPath` and drop the removed `terminals`/`isTerminal`/`onRegisterTerminal`/`onUnregisterTerminal` props.

- [ ] **Step 4: Remove terminal plumbing from `App`**

Delete: `terminals` state (117), `termsRef`/`buffersRef` (139-140), the `onPtyData`/`onTerminalExit` subscriptions (199-206, 245-249), `registerTerminal`/`unregisterTerminal` (477-489), `removeTerminal` (461-466), the terminal loops in `openWorkspace`/`activate` (321-324, 347-350), and `handleRemovePane`'s terminal branch (468-471 → just `void removeAgent(path, id)`). Delete `src/renderer/src/components/PaneTabs.tsx` and `src/renderer/src/components/XtermHost.tsx`.

- [ ] **Step 5: Verify green**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS (Sidebar still compiles; it is rebuilt in Task 8 but current props remain valid). Run `npm test`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(app): render active session (mount-all), remove tab bar and terminals"
```

---

## Task 8: Sidebar — collapsible projects with session rows

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx` (pass runtimes/states + `onNewSession`/`onSelectSession`/`onRenameSession`/`onDeleteSession`/`onStopSession` down)
- Delete: `src/renderer/src/components/AddAgentDialog.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Sidebar new props (add to `Props`): `runtimes: Record<string, WorkspaceRuntime>`, `activeSessionByPath: Record<string, string>`, `onNewSession: (path: string) => void`, `onSelectSession: (path: string, id: string) => void`, `onRenameSession: (path: string, id: string, name: string) => void`, `onDeleteSession: (path: string, id: string) => void`, `onStopSession: (id: string) => void`. Existing `needsInput`, `workspaces`, `activePath`, `onOpen`, project menu props stay. Remove `templates` and `AddAgentDialog` usage.
- Status helper: `sessionStatus(path, sessionId): 'running' | 'waiting' | 'idle'` — `running` if the session's `AgentState.status === 'running'` in `runtimes[path].agents`; else `waiting` if `needsInput[path]?.includes(sessionId)`; else `idle`.

- [ ] **Step 1: Add per-session state helpers + expand state**

In `Sidebar.tsx`, add expand state:

```typescript
const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
  try { return JSON.parse(localStorage.getItem('meow.sidebar.expanded') ?? '{}') } catch { return {} }
})
useEffect(() => { localStorage.setItem('meow.sidebar.expanded', JSON.stringify(expanded)) }, [expanded])

const sessionStatus = (path: string, id: string): 'running' | 'waiting' | 'idle' => {
  const st = runtimes[path]?.agents.find(a => a.agentId === id)
  if (st?.status === 'running') return 'running'
  if (needsInput[path]?.includes(id)) return 'waiting'
  return 'idle'
}
```

- [ ] **Step 2: Render the project header + session list (reference-image layout)**

**Visual target** (see `docs/superpowers/specs` reference image): the project is a
*lightweight group header* — project name, then a **trailing** chevron, then
hover-revealed `+` (new session) and menu icons on the right. **No** path line,
**no** "N Sessions" count (path moves to the row `title`). The current-open
project's name is bright (`--text-strong`); others are dim (`--text-dim`).
Session rows are indented with a **hollow status ring** glyph (idle = ring;
running = solid green + glow; waiting = solid yellow), the name, and a trailing
`⋮` (vertical dots) that appears on hover / when active. The active session is a
full-width rounded pill (`--bg-hover`).

Add these lucide imports to `Sidebar.tsx`: `ChevronDown, ChevronRight, Plus, MoreVertical`.

Replace the `project-info`/`project-menu` block with:

```tsx
<div className="project-row" onClick={() => onOpen(ws.projectPath)} title={ws.projectPath}
  onContextMenu={/* unchanged */}>
  <span className="project-name">{ws.name}</span>
  <button
    className="project-expand"
    aria-label={expanded[ws.projectPath] ? 'Collapse' : 'Expand'}
    onClick={e => { e.stopPropagation(); setExpanded(p => ({ ...p, [ws.projectPath]: !p[ws.projectPath] })) }}
  >{expanded[ws.projectPath] ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}</button>
  {inputCount > 0 && <span className="project-badge" title={`${inputCount} session(s) need your reply/approval`}>{inputCount}</span>}
  <div className="project-actions" onClick={e => e.stopPropagation()}>
    <button className="btn ghost small" title="New session" aria-label={`new session ${ws.name}`}
      onClick={() => onNewSession(ws.projectPath)}><Plus size={14} aria-hidden="true" /></button>
    <button className="btn ghost small" title="Project menu" aria-label={`menu ${ws.name}`}
      onClick={e => { /* existing project-menu open logic, unchanged */ }}>
      <span className="btn-icon"><MoreIcon /></span>
    </button>
    {/* existing project menu portal — remove ONLY the "Add Agent" item */}
  </div>
</div>
{expanded[ws.projectPath] && (
  <ul className="session-list">
    {ws.sessions.map(s => {
      const status = sessionStatus(ws.projectPath, s.id)
      const activeSession = activeSessionByPath[ws.projectPath] === s.id && ws.projectPath === activePath
      return (
        <li key={s.id} className={`session-row ${activeSession ? 'active' : ''}`}
          onClick={() => onSelectSession(ws.projectPath, s.id)}>
          <span className={`session-dot session-status-${status}`} aria-label={status} />
          <span className="session-name">{s.name}</span>
          <SessionRowMenu
            running={status === 'running'}
            onRename={name => onRenameSession(ws.projectPath, s.id, name)}
            onDelete={() => onDeleteSession(ws.projectPath, s.id)}
            onStop={() => onStopSession(s.id)}
          />
        </li>
      )
    })}
  </ul>
)}
```

The current-project brightness comes from CSS: keep the outer `<li className={ws.projectPath === activePath ? 'active' : ''}>` wrapper so `.project-list li.active .project-name` can brighten it (Step 5).
```

Remove the "Add Agent" menu item (lines ~202-207) and the `handleAddAgent`/`addAgentPath`/`AddAgentDialog` code (33, 96-106, 252-259) and imports (`AddAgentDialog`, `NewAgentInput`, `Template`). Delete `src/renderer/src/components/AddAgentDialog.tsx`.

- [ ] **Step 3: Add the `SessionRowMenu` sub-component**

Add to `Sidebar.tsx` (bottom of file) a small menu component with Rename (inline prompt), Delete (confirm), Stop (if running). Use a portaled dropdown consistent with the project menu, or a minimal inline implementation:

```tsx
function SessionRowMenu({ running, onRename, onDelete, onStop }:
  { running: boolean; onRename: (n: string) => void; onDelete: () => void; onStop: () => void }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <span className="session-menu" onClick={e => e.stopPropagation()}>
      <button className="btn ghost small" aria-label="Session menu" onClick={() => setOpen(v => !v)}>
        <MoreVertical size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="sidebar-menu-dropdown session-menu-dropdown">
          <button className="menu-item" onClick={() => { setOpen(false); setRenaming(true) }}>Rename</button>
          {running && <button className="menu-item" onClick={() => { setOpen(false); onStop() }}>Stop</button>}
          <button className="menu-item danger" onClick={() => { setOpen(false); onDelete() }}>Delete</button>
        </div>
      )}
      {renaming && (
        <input className="input session-rename-input" autoFocus placeholder="Session name"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onRename(name.trim()); setRenaming(false); setName('') } if (e.key === 'Escape') { setRenaming(false); setName('') } }}
          onBlur={() => { setRenaming(false); setName('') }} />
      )}
    </span>
  )
}
```

`MoreVertical` is imported in Step 2. (Outside-click closing for this menu can reuse the existing document mousedown effect by adding `.session-menu`/`.session-menu-dropdown` to its closest checks.)

- [ ] **Step 4: Wire handlers in `App` and pass to `Sidebar`**

In `App.tsx`, add callbacks and pass them + `runtimes` + `activeSessionByPath` to `<Sidebar>`:

```typescript
const onNewSession = useCallback((path: string) => {
  void window.api.addAgent(path, { name: 'New session', templateId: 'meow', cwd: path, kind: 'native' })
    .then(() => removeAgent /* reuse refresh */ )
}, [])
```

Concretely, reuse the existing `openWorkspace(path)` refresh pattern: after `addAgent`, call `void window.api.openWorkspace(path).then(rt => setRuntimes(...))` and `refreshWorkspaces()` (mirror `removeAgent` at 444-459). `onSelectSession(path, id)` = activate the project if not active then `handleWorkspaceActiveChange(path, id)`. `onRenameSession` = `window.api.renameAgent(path, id, name).then(refreshWorkspaces)`. `onDeleteSession` = reuse `removeAgent(path, id)` but if it was the last session, immediately `onNewSession(path)`. `onStopSession(id)` = `window.api.stopChat(id)`.

- [ ] **Step 5: Add sidebar CSS**

In `src/renderer/src/styles.css`, replace the old `.project-row`/`.project-info`/`.project-path`/`.project-count`/`.project-menu` rules and any placeholder session rules with the reference-image styling below. (`--green #4ade9f`, `--yellow #ffb454`, `--bg-hover #1c1c20`, `--bg-raised #161618`, `--text-faint #707076` already exist in `:root` — do not add new tokens.)

```css
/* Project = lightweight group header; actions reveal on hover / when current */
.project-row { display: flex; align-items: center; gap: 5px; padding: 5px 8px; cursor: pointer; border-radius: var(--radius); }
.project-row:hover { background: var(--bg-raised); }
.project-name { color: var(--text-dim); font-weight: var(--fw-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-list li.active .project-name { color: var(--text-strong); }
.project-expand { display: inline-flex; align-items: center; background: none; border: none; color: var(--text-faint); cursor: pointer; padding: 0; }
.project-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity 120ms ease; }
.project-row:hover .project-actions, .project-list li.active .project-actions { opacity: 1; }
.project-actions .btn { border: none; background: transparent; padding: 2px 4px; color: var(--text-faint); }
.project-actions .btn:hover { background: var(--bg-hover); color: var(--text); }

/* Session rows — indented so the ring sits under the project name */
.session-list { list-style: none; margin: 0 0 6px; padding: 0 0 0 16px; display: flex; flex-direction: column; gap: 1px; }
.session-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; cursor: pointer; border-radius: var(--radius); color: var(--text-dim); }
.session-row:hover { background: var(--bg-raised); color: var(--text); }
.session-row.active { background: var(--bg-hover); color: var(--text); }
.session-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-md); }

/* Status glyph: idle = hollow ring; running/waiting = solid + glow */
.session-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; box-sizing: border-box; border: 1.5px solid var(--text-faint); background: transparent; }
.session-dot.session-status-running { border-color: var(--green); background: var(--green); box-shadow: 0 0 7px rgba(74, 222, 159, 0.45); }
.session-dot.session-status-waiting { border-color: var(--yellow); background: var(--yellow); box-shadow: 0 0 7px rgba(255, 180, 84, 0.4); }
.session-dot.session-status-idle { border-color: var(--text-faint); background: transparent; }

/* Session menu button: hidden until hover / active */
.session-menu { position: relative; display: inline-flex; }
.session-menu .btn { opacity: 0; border: none; background: transparent; padding: 2px 3px; color: var(--text-faint); transition: opacity 120ms ease; }
.session-row:hover .session-menu .btn, .session-row.active .session-menu .btn { opacity: 1; }
.session-menu .btn:hover { background: var(--bg-active); color: var(--text); }
.session-menu-dropdown { position: absolute; right: 0; top: 100%; z-index: 1000; }
.session-rename-input { position: absolute; right: 0; top: 100%; z-index: 1001; width: 160px; }
```

- [ ] **Step 6: Verify green**

Run: `npx tsc --noEmit -p tsconfig.web.json && npm test`
Expected: PASS.

- [ ] **Step 7: Manual smoke (optional but recommended)**

Run `npm run dev`; verify: expand/collapse, `+` adds a session, clicking switches without stopping a running one (start a turn in session A, switch to B, A keeps running — green dot stays), rename/delete/stop work, deleting the last session yields a fresh one.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sidebar): collapsible projects with parallel session rows, +/rename/delete/stop"
```

---

## Task 9: Settings cleanup + dead CSS + docs

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `AGENTS.md`, `src/renderer/AGENTS.md`, `src/main/AGENTS.md` (as applicable), `docs/reference/*`
- Modify/Delete: e2e specs under `tests/e2e` that cover tabs/terminals

**Interfaces:** none new.

- [ ] **Step 1: Remove the templates settings tab**

In `SettingsDialog.tsx`: remove `'templates'` from the `TabId` union and from any template UI branch. Read the file first; remove only template CRUD and agent-kind/template pickers from the `agents` tab, keeping meow model/mode config. Remove `templates`/`onTemplatesChange` props if now unused (update `App.tsx` `<SettingsDialog>` call site — drop `templates`/`onTemplatesChange` and the App `templates` state + `listTemplates()` load).

- [ ] **Step 2: Remove dead CSS**

In `src/renderer/src/styles.css` delete rules only used by removed UI: `.agent-tabs-view`, `.agent-tab*`, `.agent-pane-container`, any xterm/terminal-pane rules. Verify each selector is unreferenced with `git grep 'agent-tab'` etc. across `src/renderer`.

- [ ] **Step 3: Update docs**

Update `AGENTS.md` (root): under Structure/Conventions, state that the app has a single native "meow" agent and that the parallel unit is a **session** (UI term) backed by the internal `agent` runtime; note in-app terminals and CLI/template agents were removed. Update `src/renderer/AGENTS.md` and `src/main/AGENTS.md` module tables to drop `PaneTabs`, `XtermHost`, `SessionBar`, `AddAgentDialog`, `template-manager`, `terminal-shell` and add `SessionPanes`, `fresh-start`. Update the matching `docs/reference/` pages (UI, agent runtime, IPC, storage) per the docs-sync rule.

- [ ] **Step 4: Fix e2e specs**

`git grep -l -i "tab\|terminal" tests/e2e` — remove or rewrite specs that assert the old tab bar / terminal panes. Add a minimal `tests/e2e/sidebar-sessions.spec.ts` covering create + switch-without-stop + status dot if e2e is in scope for this change.

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test`
Expected: both PASS. If touching e2e: `npm run build && npm run e2e`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: settings/CSS/docs cleanup for the single-agent session model"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** goals 1-4 → Tasks 7/8 (tabs→sessions, parallel), Task 5 (single agent), Task 8 (sidebar rows, +, per-row menu, status), Task 6 (remove SessionBar). Removals → Tasks 4/5/6. Fresh start → Task 3. Settings → Task 9. WorkspaceSummary/renameAgent → Tasks 1/2.
- **Placeholder scan:** removal tasks intentionally use "typecheck/contract-test-driven" enumeration because the exact line set shifts as edits land; each such step names the exact symbols and the command that proves completion. New logic (Tasks 1,2,3,7,8) has full code.
- **Type consistency:** `SessionMeta`/`WorkspaceSummary.sessions` (Task 1) used consistently in Sidebar (Task 8) and store; `renameAgent` signature identical in ipc/preload/main (Task 2); `SessionPanes` props match its call site (Task 7).
