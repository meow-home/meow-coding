# Sort Project Sessions Newest First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort sessions listed under each project item in the sidebar so that the newest session is displayed at the top.

**Architecture:** Update `WorkspaceStore.list()` in `src/main/workspace-store.ts` to return `sessions` in reverse order of `w.agents` array (since new sessions are pushed to the end of `w.agents`). This ensures `WorkspaceSummary.sessions` delivered over IPC to the renderer is ordered newest first.

**Tech Stack:** TypeScript, Electron, React 19, Vitest.

## Global Constraints

- Source code, UI labels, system-style notifications must be English.
- No `Co-Authored-By` trailer in git commit messages.
- Always run `npm run typecheck` and `npm test` to verify changes.

---

### Task 1: Update WorkspaceStore.list and Unit Test

**Files:**
- Modify: `src/main/workspace-store.ts:19-25`
- Modify: `tests/unit/workspace-store.test.ts`

**Interfaces:**
- Consumes: `Workspace` model (`agents: AgentConfig[]`)
- Produces: `WorkspaceSummary` with `sessions: SessionMeta[]` ordered newest first

- [ ] **Step 1: Write the failing unit test**

Edit `tests/unit/workspace-store.test.ts` to add a test verifying that `store.list()` returns sessions in reverse order of creation (newest first):

```ts
  it('lists session id+name metas per project in newest-first order', () => {
    store.add('/proj/a', 'Project A')
    store.addAgent('/proj/a', { name: 'Session 1', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    store.addAgent('/proj/a', { name: 'Session 2', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const list = store.list()
    expect(list[0].sessions).toHaveLength(2)
    expect(list[0].sessions[0].name).toBe('Session 2')
    expect(list[0].sessions[1].name).toBe('Session 1')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: FAIL (because currently `store.list()` returns `Session 1` first, not `Session 2`).

- [ ] **Step 3: Update WorkspaceStore.list implementation**

In `src/main/workspace-store.ts`, update `list()`:

```ts
  list(): WorkspaceSummary[] {
    return this.store.load().map(w => ({
      projectPath: w.projectPath,
      name: w.name,
      sessions: w.agents.slice().reverse().map(a => ({ id: a.id, name: a.name }))
    }))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace-store.ts tests/unit/workspace-store.test.ts
git commit -m "feat: sort project sessions newest first in workspace store list"
```

---

### Task 2: Update Documentation and Verification

**Files:**
- Modify: `src/main/AGENTS.md` (if updating TODOs or store description)

- [ ] **Step 1: Run typecheck and unit test suite**

Run: `npm run typecheck && npm test`
Expected: PASS (0 errors)

- [ ] **Step 2: Update AGENTS.md if applicable**

Check if `src/main/AGENTS.md` needs documentation updates according to project instructions.

- [ ] **Step 3: Commit remaining changes if any**

```bash
git add src/main/AGENTS.md
git commit -m "docs: update main AGENTS.md for session sorting"
```
