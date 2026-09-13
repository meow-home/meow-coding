# Lazy Session Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer backend session creation until the user sends their first message in a draft session chat pane.

**Architecture:** Introduce `DRAFT_SESSION_ID = 'draft'` in renderer UI state (`App.tsx`). Clicking "New session" or opening an empty workspace sets the active session state to `'draft'` without making a backend IPC call (`window.api.addAgent`). When the user sends their first prompt in the draft chat pane, create the session on the backend and dispatch the message.

**Tech Stack:** React 19, TypeScript, Vitest, Electron IPC (`window.api.addAgent`, `window.api.sendChat`).

## Global Constraints

- Source code, comments, UI labels, and commit messages must be in English.
- Do not add `Co-Authored-By` trailers to git commits.
- Run `npm run typecheck` and `npm test` to verify changes.

---

### Task 1: Update session-guard and unit tests for draft session state

**Files:**
- Modify: `src/renderer/src/session-guard.ts`
- Modify: `tests/unit/session-guard.test.ts`

**Interfaces:**
- Consumes: `isLastSession(projectPath: string, sessionId: string, runtimes: Record<string, WorkspaceRuntime>, workspaces: WorkspaceSummary[])`
- Produces: Updated `isLastSession` function that supports draft session transitions when removing the final session.

- [ ] **Step 1: Write updated unit tests in `tests/unit/session-guard.test.ts`**

Add tests for draft session behavior when removing sessions.

```ts
import { describe, expect, it } from 'vitest'
import { isLastSession } from '../../src/renderer/src/session-guard'
import type { AgentConfig, WorkspaceRuntime, WorkspaceSummary } from '../../src/shared/types'

function session(id: string, cwd = '/p'): AgentConfig {
  return { id, name: id, templateId: 'meow', cwd, kind: 'native' }
}

function runtime(path: string, ids: string[]): WorkspaceRuntime {
  return {
    workspace: { projectPath: path, name: path, agents: ids.map(id => session(id, path)) },
    agents: [],
    git: null
  }
}

function summary(path: string, ids: string[]): WorkspaceSummary {
  return { projectPath: path, name: path, sessions: ids.map(id => ({ id, name: id })) }
}

describe('isLastSession', () => {
  it('reports the only session of an open project as the last one', () => {
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1'])])).toBe(true)
  })

  it('does not report either session of a two-session open project as the last one', () => {
    const runtimes = { '/p': runtime('/p', ['s1', 's2']) }
    const workspaces = [summary('/p', ['s1', 's2'])]
    expect(isLastSession('/p', 's1', runtimes, workspaces)).toBe(false)
    expect(isLastSession('/p', 's2', runtimes, workspaces)).toBe(false)
  })

  it('reports the only session of a never-opened project (summary only) as the last one', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', ['s1'])])).toBe(true)
  })

  it('does not report a session of a never-opened two-session project as the last one', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', ['s1', 's2'])])).toBe(false)
  })

  it('does not report an unknown session id as the last one', () => {
    expect(isLastSession('/p', 'gone', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1'])])).toBe(false)
  })

  it('does not report a session as the last one when the project has none at all', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', [])])).toBe(false)
    expect(isLastSession('/p', 's1', {}, [])).toBe(false)
  })

  it('prefers the mounted runtime over the summary when both know the project', () => {
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1', 's2']) }, [summary('/p', ['s1'])])).toBe(false)
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1', 's2'])])).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify existing suite passes**

Run: `npx vitest run tests/unit/session-guard.test.ts`
Expected: PASS

- [ ] **Step 3: Commit task 1**

```bash
git add tests/unit/session-guard.test.ts src/renderer/src/session-guard.ts
git commit -m "test: verify session-guard tests pass"
```

---

### Task 2: Implement Draft Session handling in `App.tsx` & `Sidebar.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`

**Interfaces:**
- Export `DRAFT_SESSION_ID = 'draft'` from `App.tsx` (or shared constant).
- `onNewSession(path: string)`: switches `activeSessionByPath[path]` to `DRAFT_SESSION_ID` without calling IPC.
- `onSendDraftMessage(path: string, text: string, attachments?: string[])`: creates backend agent via `window.api.addAgent`, updates active session, and calls `window.api.sendChat`.

- [ ] **Step 1: Update `App.tsx` with draft session state and `onSendDraftMessage`**

In `src/renderer/src/App.tsx`:
1. Define `export const DRAFT_SESSION_ID = 'draft'`.
2. Update `onNewSession`:
   ```ts
   const onNewSession = useCallback(async (path: string): Promise<boolean> => {
     setActiveSessionByPath(prev => ({ ...prev, [path]: DRAFT_SESSION_ID }))
     return true
   }, [])
   ```
3. Add `onSendDraftMessage`:
   ```ts
   const onSendDraftMessage = useCallback(async (path: string, text: string, attachments?: string[]) => {
     const created = await window.api.addAgent(path, {
       name: 'New session', templateId: 'meow', cwd: path, kind: 'native'
     }).catch(() => null)
     if (!created) return
     setRuntimes(prev => (prev[path]
       ? { ...prev, [path]: { ...prev[path], ...created, git: created.git ?? prev[path].git } }
       : { ...prev, [path]: created }))
     const newId = created.workspace.agents[created.workspace.agents.length - 1]?.id
     if (newId) {
       setActiveSessionByPath(prev => ({ ...prev, [path]: newId }))
       await refreshWorkspaces()
       void window.api.sendChat(newId, text, attachments)
     }
   }, [refreshWorkspaces])
   ```
4. Update `removeAgent` / `removeSessionGuarded`:
   When deleting a session, if no sessions remain after deletion, set `setActiveSessionByPath(prev => ({ ...prev, [path]: DRAFT_SESSION_ID }))` instead of auto-creating a new backend session.
5. In workspace activation / initial setup:
   If `workspace.agents` is empty, default `activeSessionByPath[path]` to `DRAFT_SESSION_ID`.

- [ ] **Step 2: Ensure `Sidebar.tsx` hides `DRAFT_SESSION_ID` from the session list**

In `src/renderer/src/components/Sidebar.tsx`:
Ensure `ws.sessions` filters out any item with `id === DRAFT_SESSION_ID` (if present) and only lists persisted sessions.

- [ ] **Step 3: Run `npm run typecheck` to verify React types**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit task 2**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx
git commit -m "feat: implement lazy session state in App and Sidebar"
```

---

### Task 3: Support Draft Pane in `SessionPanes.tsx` & `Pane.tsx`

**Files:**
- Modify: `src/renderer/src/components/SessionPanes.tsx`
- Modify: `src/renderer/src/components/Pane.tsx`

**Interfaces:**
- `SessionPanes` accepts `onSendDraftMessage?: (path: string, text: string, attachments?: string[]) => void`.
- When `activeId === DRAFT_SESSION_ID` or no active agent model exists, render a draft `Pane` with an empty chat feed.

- [ ] **Step 1: Update `SessionPanes.tsx` to handle `DRAFT_SESSION_ID`**

In `src/renderer/src/components/SessionPanes.tsx`:
If `activeId === DRAFT_SESSION_ID` or `agents` list is empty, construct a synthetic draft pane model:
```ts
const DRAFT_PANE_MODEL: PaneModel = {
  agent: { id: DRAFT_SESSION_ID, name: 'New session', templateId: 'meow', cwd: projectPath, kind: 'native' },
  state: { agentId: DRAFT_SESSION_ID, projectPath, status: 'idle', history: [], pendingPrompt: null },
  git: null
}
```
When `Pane` submits input while `activeId === DRAFT_SESSION_ID`, route the message through `onSendDraftMessage(projectPath, text, attachments)`.

- [ ] **Step 2: Update `Pane.tsx` for draft session chat submit**

In `src/renderer/src/components/Pane.tsx`:
Ensure that when `model.agent.id === DRAFT_SESSION_ID`, submitting a chat message calls `onSendDraftMessage` instead of `window.api.sendChat`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit task 3**

```bash
git add src/renderer/src/components/SessionPanes.tsx src/renderer/src/components/Pane.tsx
git commit -m "feat: render draft pane view and handle first prompt send"
```

---

### Task 4: Full Verification and Cleanup

**Files:**
- Test all components, run Vitest tests, and verify TypeScript build.

- [ ] **Step 1: Run `npm run typecheck`**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 2: Run `npm test`**

Run: `npm test`
Expected: All unit and integration tests pass.

- [ ] **Step 3: Commit final verification**

```bash
git commit --allow-empty -m "chore: verify lazy session creation passes all tests"
```
