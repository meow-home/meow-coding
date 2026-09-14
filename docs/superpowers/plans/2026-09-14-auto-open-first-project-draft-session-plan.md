# Auto-Open First Project and New Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically open the first workspace with a fresh draft session when launching the app so the chat pane is never left blank when projects exist.

**Architecture:** Update `App.tsx` startup logic in `refreshWorkspaces` so that if no workspace path is currently active (`activePathRef.current === null`) and `listWorkspaces()` returns projects, the first project path is activated and its active session set to `DRAFT_SESSION_ID`.

**Tech Stack:** React 19, TypeScript, Electron, Vitest.

## Global Constraints

- Source code language: English.
- No `Co-Authored-By` trailer in git commit messages.
- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Automatically open first workspace and new session on launch in `App.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx:210-380`

**Interfaces:**
- Consumes: `window.api.listWorkspaces()`, `DRAFT_SESSION_ID` from `@shared/types`.
- Produces: Auto-opened first workspace and draft session when `activePath` is null.

- [ ] **Step 1: Check existing behavior and rearrange `openWorkspace` before `refreshWorkspaces`**

In `src/renderer/src/App.tsx`, move `openWorkspace` definition above `refreshWorkspaces` so `refreshWorkspaces` can reference it directly.

```tsx
  const openWorkspace = useCallback(async (path: string) => {
    const rt = await window.api.openWorkspace(path)
    const list = await window.api.listArtifacts(path)
    setRuntimes(prev => ({ ...prev, [path]: rt }))
    setActivePath(path)
    // Most recently used at the head of keepAliveOrder.
    setKeepAliveOrder(prev => [path, ...prev.filter(p => p !== path)])
    setArtifacts(prev => ({ ...prev, [path]: list }))
    setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
    evictIfNeeded()
  }, [evictIfNeeded, setActivePath, setKeepAliveOrder])
```

- [ ] **Step 2: Update `refreshWorkspaces` to open first workspace with `DRAFT_SESSION_ID` if `activePathRef.current` is null**

```tsx
  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await window.api.listWorkspaces()
      setWorkspaces(list)
      if (!activePathRef.current && list.length > 0) {
        const firstPath = list[0].projectPath
        setActiveSessionByPath(prev => (prev[firstPath] ? prev : { ...prev, [firstPath]: DRAFT_SESSION_ID }))
        void openWorkspace(firstPath)
      }
    } catch {
      /* a rejected list leaves the last known sidebar intact; the next refresh retries */
    }
  }, [openWorkspace])
```

- [ ] **Step 3: Run typecheck to verify TypeScript compilation**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 4: Run unit tests to verify system tests pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(renderer): auto-open first workspace with new session on app startup"
```
