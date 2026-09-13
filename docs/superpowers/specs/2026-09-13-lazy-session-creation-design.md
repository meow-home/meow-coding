# Lazy Session Creation Design

## Goal

Defer backend session creation until the user sends their first message in a newly initialized or requested session. Clicking "New session" or opening an empty workspace displays an unpersisted "draft" session interface without creating a backend record in `workspaces.json`.

## User Value

- Eliminates empty / unused sessions from the workspace and sidebar.
- Prevents cluttering persistent storage (`workspaces.json`) when creating sessions that are never used.
- Provides an immediate, clean draft chat UI that materializes into a real session seamlessly upon sending the first prompt.

## Design Details

### 1. Draft Session State (`App.tsx`)

- Define a special constant identifier for draft session state: `DRAFT_SESSION_ID = 'draft'`.
- When clicking **"New session"** (in Sidebar header or project `+` button), `onNewSession(projectPath)` sets `activeSessionByPath[projectPath] = DRAFT_SESSION_ID`.
- No backend IPC (`window.api.addAgent`) call is triggered at this point.
- The active session is tracked purely in React state.

### 2. Sidebar Presentation (`Sidebar.tsx`)

- The session list filters out `DRAFT_SESSION_ID` or renders only persisted sessions in `ws.agents`.
- No draft session row is rendered in the sidebar (hidden from Sidebar until sent).
- Active status for the project header remains highlighted if the project is selected.

### 3. Draft Session Pane (`SessionPanes.tsx` & `Pane.tsx`)

- When `activeId === DRAFT_SESSION_ID`, `SessionPanes` renders a draft `Pane` view.
- Header title displays `"New session"`.
- Pane header controls (e.g. stop/delete) are simplified or hidden for draft state.
- `ChatPanel` mounts with an empty feed, ready to accept user input and attachments.

### 4. Materialization on First Message (`App.tsx` & `ChatPanel.tsx`)

When the user submits a message while in `DRAFT_SESSION_ID`:
1. `onSendDraftMessage(projectPath, text, attachments)` is called.
2. Invokes IPC `window.api.addAgent(projectPath, { name: 'New session', templateId: 'meow', cwd: projectPath, kind: 'native' })`.
3. Upon receiving the newly created agent record (e.g., ID `agent-xyz`), updates `activeSessionByPath[projectPath] = 'agent-xyz'`.
4. Instantly dispatches `window.api.sendChat('agent-xyz', text, attachments)`.
5. The sidebar automatically updates to show the persisted `"New session"` row.

### 5. Switching Away & Discard Logic

- If the user switches to an existing session in the sidebar or selects another project while on `DRAFT_SESSION_ID`, the unsent draft state is discarded.
- `activeSessionByPath[projectPath]` resets to the last active real session ID, or `null` if no real sessions exist.
- Clicking "New session" again re-enters `DRAFT_SESSION_ID`.

### 6. Empty Workspaces Invariant (`session-guard.ts` & `App.tsx`)

- Opening a workspace with 0 sessions or deleting the final session in a workspace transitions the project into `DRAFT_SESSION_ID` instead of auto-creating a backend session.
- `session-guard.ts` is updated to allow deleting the last persisted session: removing the last session sets `activeSessionByPath[projectPath]` to `DRAFT_SESSION_ID` without auto-invoking `addAgent`.

## Verification Plan

- Run `npm run typecheck` to ensure all React components and callbacks match TypeScript signatures.
- Run `npm test` to verify Vitest tests (including `session-guard.test.ts`).
