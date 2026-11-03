# Phase A — Session Terminals, Shell Mode & Worktree Sessions — Design

Date: 2026-11-02 · Status: draft
Context: Phase A of [the IDE-replacement gap analysis](../notes/2026-11-02-ide-replacement-gap-analysis.md).
Touches: `src/main/pty-manager.ts`, new `src/main/terminal-manager.ts`, new `src/main/worktree-service.ts`,
`src/main/index.ts`, `src/main/meow-agent-manager.ts`, `src/main/agent/saved-permissions.ts`,
`src/main/workspace-store.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`,
`src/renderer/src/components/{SessionPanes,PaneHeader,Sidebar}.tsx`, `components/chat/ChatInput.tsx`,
new `components/terminal/`.

## 1. Problem and evidence

Two gaps make users leave Meow for an IDE or a system terminal, and both are now standard in Claude Code
desktop, OpenCode V2 (v2.2.4 persistent session terminals, v2.0.27 worktree tools) and DeepSeek Harness
(`ui-sidebar-terminal`, `tool-worktree`):

1. **No terminal.** The in-app xterm panes were removed. Today the only paths are the pane menu's
   "open system terminal" (`Channels.SystemTerminalOpen`) or asking the agent to run `bash`. Running
   `npm run dev`, watching logs, or typing a quick `git log` means leaving the app. The runtime is still
   shipped and parked: `PtyManager` (`src/main/pty-manager.ts`) already knows a `kind: 'terminal'`,
   `@xterm/xterm` + `@xterm/addon-fit` are declared but unused.
2. **Parallel sessions share one checkout.** Meow's core value is several sessions running at once per
   project, but every session the UI creates gets `cwd: path` (`App.tsx` `onSendDraftMessage`). Two
   sessions editing the same tree overwrite each other, interleave in `git status`, and make per-turn
   undo (`agent/snapshot.ts`) unreliable. `AgentConfig.cwd` is already independent of
   `Workspace.projectPath`, and `Channels.AgentAdd` already accepts `input.cwd`, so the agent stack can
   run in another directory without changes to the loop.

## 2. Goals and success criteria

- **A1 Terminals:** each session owns up to 8 terminal tabs in a bottom dock of its pane. Tabs survive
  window close (tray), session switches and project switches; after an app restart the tabs come back
  with their previous scrollback and a fresh shell in the same directory.
- **A2 Shell mode:** typing `!<command>` in the composer runs the command without calling the LLM; the
  output is shown in the transcript and is visible to the model on the next turn.
- **A3 Worktree sessions:** a new session can be created in its own git worktree on its own branch;
  every agent surface (tools, file tree, git status, undo, LSP, instructions) follows the worktree;
  deleting the session cleans the worktree up safely.
- No orphan processes: every terminal's process tree is killed (`tree-kill`) on tab close, session
  delete and app quit.
- `npm run typecheck`, `npm test`, `npm run build && npm run e2e` pass.

Out of scope (later phases): agent tools that create/move worktrees (`worktree_*`), merging a worktree
branch back, commit/push/PR (Phase B), an agent tool that reads terminal tabs, terminals that survive an
app restart with the *same* process (would need a detached daemon), remote/SSH terminals.

## 3. Part A1 — Session terminals

### 3.1 Main process

New `TerminalManager` (`src/main/terminal-manager.ts`) owns terminals; `PtyManager` stays the low-level
spawner. `PtyManager` gets a public `startTerminal(id, cwd, shell)` that calls the existing private
`spawnSession(..., 'terminal')`; the Windows `buildSpawnCommand` shim is not applied to shells (they are
`.exe`). Only the main process spawns.

```ts
interface TerminalInfo {
  id: string            // 'term_<nanoid>'
  agentId: string       // owning session
  title: string         // auto: shell name or running command; overridden by userTitle
  userTitle?: string
  cwd: string
  status: 'running' | 'exited'
  exitCode?: number
  createdAt: number
}
```

- **Shell resolution:** `meow.json` → `terminal.shell` (path + args) if set; else Windows: Git Bash
  (same lookup the `bash` tool uses) falling back to `powershell.exe -NoLogo`; POSIX: `$SHELL -l`,
  falling back to `/bin/bash -l`. Env adds `TERM=xterm-256color`, `MEOW_SESSION_ID=<agentId>`.
- **Scrollback:** a per-terminal ring buffer of the last 512 KB of output in main. It serves renderer
  re-attach (§3.3) and persistence (§3.4). The renderer never owns the only copy.
- **Data batching:** output is coalesced per terminal and flushed every 16 ms (or at 64 KB) as one
  `EventTerminalData` push, so a noisy `npm install` cannot flood IPC. Data is only pushed for
  terminals the renderer has attached (same subscribe model as `BackgroundProcSubscribe`).
- **Limits:** 8 terminals per session; the 9th create returns an error the UI shows as a toast.
- **Lifecycle:** close tab → `pty.stop(id)` (tree-kill, 3 s force fallback already in `PtyManager.stop`).
  `Channels.AgentRemove` → kill all of that session's terminals and delete its persisted files.
  App quit → `stopAll()` already runs; persistence flush runs before it.

### 3.2 IPC (`src/shared/ipc.ts`, `AgentApi`)

| Channel | Shape |
|---|---|
| `TerminalList` | `(agentId) → TerminalInfo[]` |
| `TerminalCreate` | `(agentId, opts?: { cwd?, command? }) → TerminalInfo` — `command` is typed into the new shell (used by worktree setup, §5.4) |
| `TerminalAttach` / `TerminalDetach` | `(id) → { scrollback: string }` / `void` |
| `TerminalWrite` | `(id, data)` |
| `TerminalResize` | `(id, cols, rows)` |
| `TerminalRename` | `(id, userTitle \| null)` |
| `TerminalRestart` | `(id) → TerminalInfo` |
| `TerminalKill` | `(id)` |
| `EventTerminalData` | `{ id, data }` |
| `EventTerminalsChanged` | `{ agentId, terminals: TerminalInfo[] }` (create, exit, rename, kill) |

The parked `Pty*` channels are left as they are; their removal stays the separate deferred plan.

### 3.3 Renderer

- **Dock placement:** a bottom dock inside the pane, under `ChatPanel`, toggled by `Ctrl+\`` (`Cmd+\`` on
  macOS) and a terminal button in `PaneHeader`. Resizable height (120 px – 70 % of the pane, default
  240 px, persisted as `meow.terminal.height`). Right-docked Files/Processes overlays keep working
  above it. Bottom was chosen over a third right-docked overlay because the chat and a running dev server
  are watched at the same time; a right overlay would cover the chat.
- **Tabs:** tab strip with title, status dot (exited = grey + exit code), double-click to rename, `+`,
  `✕`. Exited tabs stay until closed and offer **Restart** (new shell, same cwd, scrollback kept).
- **xterm instances** live in `components/terminal/TerminalView.tsx`. Hidden panes stay mounted (house
  rule), but xterm instances are created only for the **selected** session's dock and disposed when
  that session is hidden; re-showing calls `TerminalAttach`, writes the scrollback, then streams. This
  keeps memory flat with many sessions.
- **Theme:** xterm colors read from the existing CSS variables and update on the dark/light toggle.
- **Chat bridge:** terminal context menu → **Send selection to chat** and **Send last 100 lines to chat**
  insert a fenced block into the composer (not sent automatically).
- Popups and menus use `BaseDropdown` / `BaseSelect`.

### 3.4 Persistence across restart

On create/rename/exit and every 30 s while running, write
`userData/terminals/<agentId>/index.json` (`TerminalInfo[]`) and `<termId>.log` (scrollback, capped at
512 KB) via `atomic-write.ts`. On session open after a restart, tabs are listed as `exited` with their
scrollback and a dim line `[meow] Restored after restart — press Restart to start a new shell.`; nothing
is spawned until the user restarts a tab. Lazy restart avoids launching dozens of shells at boot.

## 4. Part A2 — Shell mode in the composer

- A composer starting with `!` enters shell mode: the input gets a `$` badge and monospace text; `Esc`
  with an empty command or deleting the `!` leaves it. Slash-command and `@` suggestions are off in this
  mode.
- **Execution** reuses the `bash` tool's executor (Git Bash on Windows, session `cwd`, 120 s timeout,
  tree-kill on abort), not a PTY: the output has to be captured deterministically for the model, and
  detecting "command finished" in an interactive PTY is unreliable. Long-running or interactive commands
  belong in a terminal tab; the shell-mode error on timeout says so.
- **Transcript:** the run is persisted as a `tool` transcript item named `bash` with a new optional
  `origin: 'user'` field. The chat renders it as a user shell block (`$ cmd` + output, streaming).
  `toLlmMessages` sends it to the model on the next turn as a user-authored command and output, subject
  to the normal tool-output truncation. Undo of the next turn does not remove it; deleting it is not
  offered in Phase A.
- **Permissions:** none — the user typed it. Plan mode does not block it (plan mode restricts the agent,
  not the user).
- **While a turn is running** shell mode is disabled (send button tooltip: "Stop the turn or wait for it
  to finish to run a shell command"). Injecting a user tool item mid-turn would break step ordering.
- `Ctrl+Shift+X` toggles shell mode (matches OpenCode V2).

## 5. Part A3 — Worktree sessions

### 5.1 Creating one

- The draft-session composer gets a **Run in** selector (`BaseSelect`), shown only when the project is a
  git repository: `Project folder` (default) or `New worktree`. Choosing `New worktree` reveals a
  **Base** branch picker (default: the project's current branch; local and remote branches from
  `GitService.getBranches`).
- The choice is remembered per project in `localStorage` (`meow.runIn.<encodedPath>`).
- On first send, the renderer calls new `Channels.WorktreeCreate(projectPath, { base })` and then the
  existing `addAgent` with `cwd` = the returned path and the new `worktree` metadata. If creation fails,
  the draft is kept and the git error is shown; no agent is created.

### 5.2 `WorktreeService` (`src/main/worktree-service.ts`)

- **Location:** `userData/worktrees/<encodeProjectPath(projectPath)>/<slug>` — outside the repository so
  the project's file tree, file watcher, `glob`/`grep`, artifacts and other sessions never see it, and no
  `.gitignore` edit is needed. `<slug>` is `<yyMMdd>-<4 random chars>` to keep Windows paths short.
- **Branch:** `meow/<slug>`, created with `git worktree add -b meow/<slug> <path> <base>`. All git calls
  go through `execFile('git', …)` with a timeout, like `GitService`.
- **Setup file:** an optional committed `.meow/worktree.json`:
  ```json
  { "copy": [".env", ".env.local"], "setup": "npm install" }
  ```
  `copy` lists gitignored files copied from the main checkout (glob patterns, files only, missing ones
  skipped). `setup` runs in a new terminal tab of the session (A1) titled `setup`, so the user sees it and
  can stop it; the session is usable immediately.
- `AgentConfig` gains `worktree?: { path: string; branch: string; base: string; createdAt: number }`,
  persisted in `workspaces.json`.
- **Startup:** `git worktree prune` per workspace; a session whose worktree path is gone shows a pane
  banner (`[meow] This session's worktree no longer exists.`) with **Recreate from branch** (if the branch
  still exists) or **Delete session**.

### 5.3 What follows the worktree

Everything already keyed by `agent.cwd` works unchanged: tools, `AGENTS.md`/`CLAUDE.md` instructions,
skills and `.meow/commands` (read from the worktree's committed copy), undo/redo snapshots, subagents,
`@`-suggestions, LSP clients. Required changes:

| Surface | Today | Change |
|---|---|---|
| Saved "always allow" permissions | keyed by `agent.cwd` (`savedPermissions.save(agent.cwd, …)`) | key by the workspace `projectPath`, so a worktree session inherits and contributes to the project's rules |
| Git status in `PaneHeader` / status bar | polled for `projectPath` only (`index.ts` `startGitPoll`) | also poll the selected session's `cwd` when it differs; emit `{ projectPath, agentId?, git }` |
| Files overlay root, "Open in VS Code", system terminal | project path | session `cwd` |
| Sidebar row | name | adds a branch glyph + `meow/<slug>` tooltip for worktree sessions |
| `delegate_session` | target runs in its own `cwd` | unchanged, but the tool output names the target's worktree branch so the caller knows the files differ |

### 5.4 Deleting a worktree session

Before `AgentRemove`, the renderer asks `Channels.WorktreeInspect(agentId)` →
`{ dirty: number; unpushedCommits: number; branchMerged: boolean }` and shows `ConfirmDialog`:

- **Remove worktree and branch** — default when clean and the branch is merged or has no commits.
- **Remove worktree, keep branch** — default when there are commits not merged into `base`.
- **Keep both** — only unregisters the session.

Dirty files force an extra confirmation naming the count. Removal runs `git worktree remove --force
<path>` and, when chosen, `git branch -D meow/<slug>`. Terminals of the session are killed first (a
running shell holds the directory open on Windows and makes removal fail).

## 6. Rejected alternatives

- **Terminal as a right-docked overlay** like Files/Processes: consistent, but hides the chat while a
  server runs. Bottom dock matches every IDE and the market tools.
- **Keeping shells alive across restart with a detached daemon** (OpenCode can, because its server is a
  separate process): a large lifecycle and security surface for Meow's single-process main. Restoring
  scrollback + lazy restart covers most of the value.
- **Shell mode through a PTY tab:** visible and interactive, but output capture for the model is
  unreliable. Terminals cover the interactive case.
- **Worktrees inside the repo** (`.meow/worktrees/`, as Claude Code does with `.claude/worktrees`): easy to
  find, but leaks into the project file tree, watcher, `grep` and other sessions unless every surface
  filters it, and needs a `.gitignore` edit. `userData` avoids all of that; "Reveal in Folder" and the
  pane header expose the path.

## 7. Testing

- **Unit:** shell resolution per platform; scrollback ring buffer cap; data batching flush rules;
  terminal persistence round-trip; `WorktreeService` slug/branch naming, `worktree.json` parsing and copy
  globbing, inspect classification (dirty / unpushed / merged) against a temp git repo; saved-permission
  keying by `projectPath`; shell-mode transcript item → `toLlmMessages` output.
- **Integration:** create terminal → write `echo hi` → receive data → kill → no live pid (`tree-kill`);
  `AgentRemove` kills terminals; worktree create → agent `cwd` is the worktree → delete with each option
  leaves the expected `git worktree list` / branches.
- **e2e (Playwright):** open the dock, run a command, see output; switch sessions and back, scrollback
  restored; create a worktree session and see its branch in the pane header.
- Windows manual check: ConPTY with Git Bash and PowerShell; removing a worktree while a terminal was open
  in it.

## 8. Documentation to update in the same change

`AGENTS.md` (root: in-app terminals are back; module `AGENTS.md` for `src/main`, `src/renderer/.../components`,
`chat`), `docs/reference/01-product-overview.md` (feature inventory), `02-architecture.md`,
`05-ipc-contract.md` (new channels), `06-data-and-storage.md` (`userData/terminals/`, `userData/worktrees/`,
`AgentConfig.worktree`, `.meow/worktree.json`, `terminal.shell`), `09-ui-guide.md` (terminal dock, shell
mode, Run in selector), `04-tool-catalog.md` (user-origin `bash` items).

## 9. Delivery order

1. A1 terminals (main + IPC + dock + persistence).
2. A2 shell mode (independent of A1 at runtime; ships after it only to share the review).
3. A3 worktrees (uses A1 for the `setup` command).

Each is a separate implementation plan in `docs/superpowers/plans/`.

## 10. Open questions

- Should a worktree session be convertible back to the project folder (or an existing session moved into
  a new worktree, carrying uncommitted changes via `git stash`)? Proposed: Phase B, together with merge.
- Default for **Run in** on projects where several sessions already exist: keep `Project folder`, or
  suggest `New worktree` when another session is running? Proposed: keep the remembered choice, show a
  one-line hint when another session in the same folder is running.
