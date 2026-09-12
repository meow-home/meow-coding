# Sessions in Sidebar — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan

## Summary

Restructure the app from a **project → agents (tabs)** model into a
**project → sessions (sidebar)** model, and reduce the app to a single agent
type (the built-in "meow" agent). Sessions run in parallel; switching between
them never stops the deactivated one. The in-pane tab bar and the in-chat
session bar are removed; session management moves into the project sidebar.

## Goals

1. **Remove the tab feature.** Sessions replace tabs as the parallel runnable
   unit. Switching a session must NOT stop or pause any other session's run.
2. **Single agent type.** Remove the `pty` agent kind entirely — CLI agents
   (claude, opencode, aider, …), the template system, "Add Agent", and in-app
   terminals. Only the native meow agent remains.
3. **Sidebar-driven sessions.** Each project is one collapsible row. Expanding
   it lists that project's sessions. Each session row shows a running-status
   dot, has a `...` menu (Rename / Delete / Stop), and each project row has a
   `+` button (next to `...`) to create a new session.
4. **Remove the session component from the chat frame** (`SessionBar`).

## Non-goals

- No data migration/conversion from the old model. On upgrade we do a **fresh
  start** (see Migration).
- No re-keying of backend run state from `agentId` to `sessionId` (see Approach).
- No change to the meow agent's turn/tool/streaming internals, the right panel,
  git integration, providers, MCP, hooks, or the background-run feature.

## Approach: relabel the per-agent engine as "session"

The current parallel unit is the **agent** (rendered as a tab). Run state,
concurrency, keep-alive mounting, and status already work **per-agent**
(`running: Set<agentId>`, `controllers: Map<agentId,…>`, App-level keep-alive
mounts every agent's `ChatPanel` and only shows the active one). Switching tabs
already does not stop other agents.

Therefore: **one native agent == one UI "session".** A project holds N native
meow agents; the sidebar presents them as sessions. This reuses the proven
engine with minimal risk.

- The **nested** per-agent multi-session concept (in-chat `SessionBar`,
  `createSession` / `switchSession` / `deleteSession` / `renameSession` on the
  chat session, `newChatSession`) is **retired**. Each agent keeps exactly one
  auto-created store session for its transcript (as it already does via
  `activeSessionId`).
- The backend keeps the internal identifier **`agent`** (a full rename to
  `session` is high-churn and risky). The **UI** vocabulary is "session". This
  intentional split is documented in the relevant `AGENTS.md`.

**Rejected alternative:** re-key `running`, `controllers`, `queues`, `modes`,
etc. from `agentId` to `sessionId` so a single agent owns multiple parallel
sessions. Same UX, much larger and riskier backend rewrite. Not pursued.

## Detailed design

### 1. Sidebar (`src/renderer/src/components/Sidebar.tsx`)

Each expanded project row shows its session list. New per-project UI:

- **Expand/collapse chevron** on the project row. Collapsed/expanded state is
  per-project, persisted in `localStorage` (e.g. `meow.sidebar.expanded`).
- **`+` button** next to the existing `...` button → creates a new session
  (`addAgent({ templateId: 'meow', kind: 'native' })`) and activates it.
- **Session rows** (children of the project group):
  - Status dot: 🟢 green = a turn is in flight (`state.status === 'running'`);
    🟡 yellow = waiting on the user (agent id is in `needsInput[path]`);
    ⚪ gray = idle/otherwise.
  - Session name; click to activate (opens the project if needed, selects the
    session as the active pane).
  - Per-row `...` menu: **Rename**, **Delete**, **Stop** (Stop shown only while
    running). Delete is blocked when it is the project's last session (or it
    immediately creates a fresh empty session so a project is never empty).
- Session data source:
  - `WorkspaceSummary` (from `listWorkspaces`) is **extended** to include
    `sessions: { id: string; name: string }[]` (derived from the project's
    persisted native agents), replacing the bare `agentCount`. This lets the
    sidebar render session rows for **every** project — expanding does **not**
    force the project to activate.
  - **Live** status dots (running/waiting) come from the existing
    `WorkspaceRuntime` (`agents[]` states) + `needsInput` for the active and
    kept-alive projects. Sessions of a not-yet-opened project render with the
    idle (gray) dot until the project is opened. Clicking a session opens the
    project if needed and activates that session.
- The collapsed-rail mode keeps showing one avatar per project (no session
  rows); the needs-input badge stays.

### 2. Main area (`src/renderer/src/App.tsx`)

- Remove `PaneTabs`. The active project's `WorkspaceView` renders **all** its
  sessions' `ChatPanel`s mounted, showing only the active one (reuse the
  existing mount-all + CSS-hide pattern from `agent-pane-container`, driven by
  the active-session id instead of a tab bar).
- The active session per project (`activeTabByPath`, renamed conceptually to
  "active session per project") is set from the sidebar, still persisted.
- Keep-alive across projects is unchanged; hidden sessions keep streaming and
  running (this is what makes "switching does not stop the other" hold).
- Remove terminal plumbing from `App`: `terminals` state, `termsRef`,
  `buffersRef`, `onPtyData`, `onTerminalExit`, `registerTerminal`,
  `removeTerminal`, terminal panes in `WorkspaceView`.

### 3. Chat frame

- Remove `SessionBar` from `ChatPanel` and its handlers
  (`handleCreateSession`, `handleSelectSession`, `handleDeleteSession`,
  `handleRenameSession`, `reloadSessions` wiring for the bar). The chat frame no
  longer shows or switches sessions.
- Delete `src/renderer/src/components/chat/SessionBar.tsx`.

### 4. Remove the `pty` kind and terminals

- `AgentKind` becomes effectively `native`-only. Remove `'pty'` usages: agent
  spawn-via-PTY path, template lookup for agents, `AddAgentDialog`, terminal
  panes (`XtermHost`), terminal IPC (`onPtyData`, `writeInput`, `resizePty`,
  `closeTerminal`, `onTerminalExit`, open/create-terminal), and
  `BackgroundPanel`'s pty branch.
- Keep the project menu's **"Open Terminal"** (`openSystemTerminal`) and
  **"Open in VS Code"** — these are external and unrelated to pty panes.
- Templates: remove the templates system used to define CLI agents (the
  `templates` settings tab is already not shown; remove the store/IPC/dialog and
  `Template` wiring where it only served CLI agents). The `'meow'` template used
  to seed a native agent is replaced by a direct native-agent create.
- Add IPC `renameAgent(path, agentId, name)` for session rename (no such API
  exists today).

### 5. Settings (`src/renderer/src/components/settings/…`)

- Remove the `templates` tab id and any template CRUD UI.
- Simplify the **Agents** tab: drop agent-kind/template selection; keep meow
  agent configuration (model, default mode, etc.). Permissions, MCP, Context,
  Commands, Providers, Updates, Personalize tabs are unchanged.

### 6. Status semantics

Green/Yellow/Gray derive from data App already has:

- `running` (green): `AgentState.status === 'running'`.
- `waiting` (yellow): agent id present in `needsInput[projectPath]` (already
  tracked via `onPromptState`).
- `idle` (gray): everything else (`idle`, `spawning`, `exited`, `stopped`,
  `error` render with their existing status classes but the sidebar dot maps to
  the three-state model above).

## Data & migration (fresh start)

On first launch of the new build:

- Drop all persisted CLI/pty agents and all old chat sessions.
- Reset each existing project (`workspaces.json`) so it has exactly **one** new
  native meow session; clear `sessions.json`.
- Implement as a one-time, versioned reset (guard flag in userData) so it runs
  once, not every launch. No conversion of old transcripts.

## IPC / contract changes

- **Remove:** `traceList`/… already gone; remove terminal channels
  (`writeInput`, `resizePty`, `closeTerminal`, `onPtyData`, `onTerminalExit`,
  create/list-terminal), template channels, `newChatSession`, and the nested
  session channels (`createSession`, `switchSession`, `deleteSession`,
  `renameSession`, `listSessions`) if fully unused after the chat-frame change.
- **Add:** `renameAgent(path, agentId, name)`. Extend `WorkspaceSummary` with
  `sessions: { id, name }[]` (replaces `agentCount`).
- Update `AgentApi` in `src/shared/ipc.ts` + `src/preload/index.ts` and the
  `ipc-contract` test in lockstep.

## Testing

- `npm run typecheck` clean (node + web + extension + server).
- `npm test` green; update/remove unit tests for templates, terminals, the
  nested session store methods, and `ipc-contract`'s required-method list.
- e2e: remove/replace tab and terminal specs; add a sidebar sessions spec
  (create session, switch without stopping a running one, status dot, delete)
  under `tests/e2e` — run `npm run build && npm run e2e` when touching e2e.
- Docs sync: update `AGENTS.md` (root + affected module dirs) and the matching
  `docs/reference/` pages (UI, agent runtime, IPC, storage) in the same commits.

## Risks & mitigations

- **Broad removal surface** (pty/templates/terminals touch many files) — do the
  removal in a dedicated commit, lean on typecheck + tests as the safety net.
- **Sidebar session data for non-open projects** — served by extending
  `WorkspaceSummary` with session id+name; live status is absent (gray) until
  the project is opened, which is acceptable.
- **Fresh-start reset** must be idempotent and run exactly once; a wrong guard
  could wipe data on every launch — cover with a unit test on the reset guard.

## Resolved decisions

- Migration: **fresh start** (no conversion).
- In-app terminals: **removed** (system "Open Terminal" stays).
- Status dot: **green = running, yellow = waiting on user, gray = idle**.
- Session controls: **per-row `...` menu** (Rename / Delete / Stop).
- A project always has **≥ 1 session**; deleting the last creates a fresh one.
- Background-run feature: **unchanged**.
