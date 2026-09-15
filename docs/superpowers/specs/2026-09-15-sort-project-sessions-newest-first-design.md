# Design Spec: Sort Project Sessions Newest First

## Context & Goal
In Meow Coding, sessions are listed under each project item in the sidebar. Currently, sessions are returned in chronological order of creation (oldest session at the top, newest at the bottom). The user requested that the session list under each project item be sorted with the **newest session at the top**, while keeping the project items list order as it currently is.

## Approved Approach
Sort sessions newest-first in the backend `WorkspaceStore.list()` method so that `WorkspaceSummary.sessions` delivered over IPC to the renderer is ordered newest first.

### Backend Changes (`src/main/workspace-store.ts`)
- In `WorkspaceStore.list()`:
  - When mapping over workspaces to construct `WorkspaceSummary`, map `w.agents` in reverse order:
    ```ts
    sessions: w.agents.slice().reverse().map(a => ({ id: a.id, name: a.name }))
    ```
  - Since new sessions are appended to `w.agents` array (`ws.agents.push(agent)`), the last element in `w.agents` is the newest created session. Reversing `w.agents` puts the newest session at index 0 (top of the session list).

### Frontend Behavior (`src/renderer/src/components/Sidebar.tsx`)
- The sidebar receives `workspaces: WorkspaceSummary[]`.
- Each workspace item `ws` has `ws.sessions` which will now have the newest session at the top.
- Rendering `ws.sessions.filter(s => s.id !== DRAFT_SESSION_ID)` displays sessions with newest on top without needing frontend array mutation or re-sorting.

### Testing Strategy
- **Unit Tests (`tests/unit/workspace-store.test.ts`)**:
  - Add unit test verifying that `WorkspaceStore.list()` returns `sessions` sorted newest first (most recently added agent first).
- **Verification**:
  - Run `npm run typecheck` and `npm test` to ensure all typechecks and unit tests pass.

## Self-Review
1. **Placeholder scan:** None.
2. **Internal consistency:** Matches requirement to keep project order intact and only sort sessions newest first.
3. **Scope check:** Small and focused change.
4. **Ambiguity check:** None.
