# Session Terminals (Phase A1) Implementation Plan

**Goal:** Give every session a dock of persistent terminal tabs under its chat, so users stop leaving
Meow for a system terminal. Spec: [Phase A design §3](../specs/2026-11-02-phase-a-terminal-worktree-design.md#3-part-a1--session-terminals).

**Architecture:**

- `src/main/terminal-shell.ts` — pure shell resolution (`meow.json` `terminal.shell` → Git Bash /
  PowerShell on Windows → `$SHELL -l` on POSIX).
- `src/main/terminal-buffer.ts` — pure scrollback ring buffer + output batcher.
- `src/main/terminal-manager.ts` — `TerminalManager` owns terminal metadata, buffers, subscriptions,
  persistence and limits. It holds **its own `PtyManager` instance**: the app's `mainApp.pty` emits
  `data`/`exit` into agent handlers in `src/main/index.ts` (`logs.append`, `setState`, exit alerts),
  and terminal ids must never reach those.
- `src/main/terminal-store.ts` — persistence under `userData/terminals/<agentId>/`.
- `Channels.Terminal*` IPC + `AgentApi` methods + preload.
- Renderer `components/terminal/` — `TerminalDock` (tabs + resize), `TerminalView` (one xterm), wired
  into `Pane.tsx` below `pane-body`.

**Tech Stack:** Electron 41, `@lydell/node-pty` (already shipped), `@xterm/xterm` + `@xterm/addon-fit`
(already declared), React 19, TypeScript strict, Vitest, Playwright.

## Global Constraints

- Source code, UI labels, notices (`[meow]` prefix), test names and docs are in **English**.
- Git commits: **do not** add a `Co-Authored-By` trailer.
- IPC strings only via `Channels` in `src/shared/ipc.ts`; `src/shared` imports no Node/Electron.
- Only the main process spawns/kills. Every terminal exit path goes through `PtyManager.stop`
  (tree-kill + 3 s force fallback) — tab close, session delete, app quit. No orphans.
- Do **not** change `buildSpawnCommand` or the parked `Pty*` channels.
- Menus/popups use `BaseDropdown` / `BaseSelect`; no custom overlay positioning.
- Hidden panes stay mounted (house rule), but xterm instances exist only for the selected session.
- Every code change updates the matching `AGENTS.md` entry and `docs/reference/*` page in the same
  commit, touching only the entries that changed and keeping each file's format.
- Before completion: `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
- Single test file: `npx vitest run <path>`.

## Design

### Types (`src/shared/types.ts`)

```ts
export type TerminalStatus = 'running' | 'exited'

export interface TerminalInfo {
  id: string            // 'term_' + 10 random base36 chars
  agentId: string
  title: string         // shell basename until the user renames
  userTitle?: string
  cwd: string
  status: TerminalStatus
  exitCode?: number
  restored?: boolean    // true when loaded from disk after an app restart
  createdAt: number
}

export interface TerminalCreateOptions { cwd?: string; command?: string; title?: string }
```

### Constants (`terminal-manager.ts`)

| Name | Value |
|---|---|
| `MAX_TERMINALS_PER_SESSION` | 8 |
| `SCROLLBACK_BYTES` | 512 * 1024 |
| `FLUSH_INTERVAL_MS` | 16 |
| `FLUSH_MAX_BYTES` | 64 * 1024 |
| `PERSIST_INTERVAL_MS` | 30_000 |

### IPC (`src/shared/ipc.ts`)

| Channel | `AgentApi` method | Returns |
|---|---|---|
| `TerminalList: 'terminal:list'` | `terminalList(agentId)` | `TerminalInfo[]` |
| `TerminalCreate: 'terminal:create'` | `terminalCreate(agentId, opts?)` | `TerminalInfo` (throws at the cap) |
| `TerminalAttach: 'terminal:attach'` | `terminalAttach(id)` | `{ scrollback: string }` |
| `TerminalDetach: 'terminal:detach'` | `terminalDetach(id)` | `void` |
| `TerminalWrite: 'terminal:write'` | `terminalWrite(id, data)` | `void` |
| `TerminalResize: 'terminal:resize'` | `terminalResize(id, cols, rows)` | `void` |
| `TerminalRename: 'terminal:rename'` | `terminalRename(id, userTitle \| null)` | `void` |
| `TerminalRestart: 'terminal:restart'` | `terminalRestart(id)` | `TerminalInfo` |
| `TerminalKill: 'terminal:kill'` | `terminalKill(id)` | `void` (removes the tab) |
| `EventTerminalData: 'terminal:data'` | `onTerminalData(cb)` | `{ id, data }` |
| `EventTerminalsChanged: 'terminal:changed'` | `onTerminalsChanged(cb)` | `{ agentId, terminals }` |

`TerminalRestart` is not in the spec's table; it backs the spec's **Restart** button and is added to
the spec in Task 9.

## Review Focus

1. **Terminal output never reaches agent handlers.** Separate `PtyManager` instance; asserted by an
   integration test that `mainApp`-style `data` listeners on the agent instance see nothing.
2. **No orphan shells.** Kill on tab close, on `AgentRemove`, on `before-quit` (after the persistence
   flush, before `app.exit`), and when `restart` replaces a running process.
3. **Attach is race-free.** `terminalAttach` returns the scrollback snapshot and marks the terminal
   subscribed in the same synchronous main-process call, so no chunk is lost or duplicated between
   the snapshot and the first `EventTerminalData`.
4. **Ring buffer cuts on a safe boundary.** Trimming must not split a UTF-16 surrogate pair; ANSI state
   at the cut is accepted as cosmetic (first line may render oddly).
5. **Windows input.** `PtyManager.write` rewrites `\n` → `\r` on win32 — correct for agent prompt
   injection, wrong for raw xterm keystrokes (pasting multi-line text). Terminals use a raw write path.

## Task 1: Shell resolution

- [x] Export `gitBashPath()` from `src/main/agent/tools/bash.ts` (no behavior change).
- [x] `src/main/agent/config.ts`: `MeowConfig.terminal?: { shell?: string; args?: string[] }`, parsed
      leniently in `mergeDefaults` (non-string `shell` → ignored).
- [x] `src/main/terminal-shell.ts`:
      ```ts
      export interface ResolvedShell { file: string; args: string[]; name: string }
      export function resolveTerminalShell(input: {
        platform: NodeJS.Platform
        env: NodeJS.ProcessEnv
        configured?: { shell?: string; args?: string[] }
        gitBash: () => string | null
        exists: (p: string) => boolean
      }): ResolvedShell
      ```
      Order: configured (if `exists`) → win32: Git Bash `['--login', '-i']`, else
      `powershell.exe ['-NoLogo']` → POSIX: `env.SHELL` `['-l']`, else `/bin/bash ['-l']`.
      `name` is the basename without `.exe` (used as the default tab title).
- [x] `tests/unit/terminal-shell.test.ts`: each branch, configured-but-missing falls through,
      `MEOW_GIT_BASH_PATH` honored via the injected `gitBash`.

## Task 2: Scrollback buffer and batcher

- [x] `src/main/terminal-buffer.ts`:
      - `class ScrollbackBuffer { constructor(maxBytes); append(s); snapshot(): string; clear() }` —
        stores chunks, tracks total length, drops whole chunks from the head and then slices the
        oldest remaining chunk; if the slice starts on a low surrogate, drop one more char.
      - `class OutputBatcher { constructor(flush: (s: string) => void, intervalMs, maxBytes, timers?);
        push(s); flushNow(); dispose() }` — first push arms one timer; reaching `maxBytes` flushes
        synchronously.
- [x] `tests/unit/terminal-buffer.test.ts`: cap respected, newest bytes kept, surrogate safety,
      batching coalesces within the interval (fake timers), size-triggered flush, `dispose` drops the
      timer and pending data is flushed by `flushNow`.

## Task 3: `PtyManager` terminal spawn path

- [x] `startTerminal(id, cwd, shell: ResolvedShell, env?)` → calls the existing private
      `spawnSession(id, shell.name, shell.file, shell.args, cwd, 'terminal', env)`. No
      `buildSpawnCommand`.
- [x] `writeRaw(id, data)` — writes without newline normalization (Review Focus 5).
- [x] Extend `tests/integration/pty-manager.test.ts`: start a terminal with the resolved shell for the
      platform, `writeRaw('echo TERM_OK\r')`, observe output, `stop` → `isRunning` false and the pid
      is gone (`process.kill(pid, 0)` throws).

## Task 4: `TerminalManager`

- [x] `src/main/terminal-manager.ts`:
      ```ts
      interface TerminalManagerDeps {
        pty: PtyManager                       // dedicated instance
        store: TerminalStore                  // Task 5
        resolveShell: () => ResolvedShell
        emitData: (e: { id: string; data: string }) => void
        emitChanged: (e: { agentId: string; terminals: TerminalInfo[] }) => void
        now?: () => number
      }
      ```
      Methods: `list(agentId)`, `create(agentId, defaultCwd, opts?)`, `attach(id)`, `detach(id)`,
      `write(id, data)`, `resize(id, cols, rows)`, `rename(id, title|null)`, `restart(id)`,
      `kill(id)`, `removeSession(agentId)` (kill all + `store.removeSession`), `flush()` (persist
      all), `stopAll()`.
      - `create`: enforce cap (throw `Error('[meow] A session can have at most 8 terminals.')`),
        cwd = `opts.cwd ?? defaultCwd`, env `{ TERM: 'xterm-256color', MEOW_SESSION_ID: agentId }`,
        then `writeRaw(opts.command + '\r')` when `command` is given.
      - pty `data` → `buffer.append` and, only when attached, `batcher.push`.
      - pty `exit` → status `exited`, `exitCode`, flush batcher, append
        `\r\n[meow] Process exited with code N\r\n` to the buffer, `emitChanged`, persist.
      - `restart`: stop the old process if running, keep the buffer, append a separator line, spawn
        again with the same cwd; clears `restored`.
      - `kill`: stop, drop buffer/batcher/metadata, `emitChanged`, persist.
      - `list` for a session never seen this run loads from `store` (restored entries are `exited`,
        `restored: true`, buffer seeded from the saved log plus the spec's dim restore line).
      - A `setInterval(PERSIST_INTERVAL_MS)` persists sessions with running terminals; cleared in
        `stopAll`.
- [x] `tests/unit/terminal-manager.test.ts` with a fake `PtyManager` (EventEmitter): cap, cwd default,
      `command` typed, data buffered while detached but not emitted, attach returns snapshot then
      streams, exit marks status + notice, restart keeps scrollback and spawns once, kill removes,
      `removeSession` kills every terminal of that agent only, restored entries from the store.

## Task 5: Persistence

- [x] `src/main/terminal-store.ts`: `class TerminalStore { constructor(rootDir) ; load(agentId):
      { info: TerminalInfo[]; logs: Record<string, string> } ; save(agentId, info, logs) ;
      removeSession(agentId) }`. Files: `<root>/<agentId>/index.json` and `<termId>.log`, written
      with `writeFileAtomic`; stale `.log` files not in the index are deleted on save. Corrupt JSON →
      empty list (log a warning via the injected logger), never throw.
- [x] `tests/unit/terminal-store.test.ts`: round-trip, log cap applied by the caller is preserved,
      stale logs removed, corrupt index tolerated, `removeSession` deletes the folder.

## Task 6: IPC, preload, main wiring

- [x] Add the channels, `AgentApi` methods and event payload types (`src/shared/ipc.ts`).
- [x] `src/preload/index.ts`: methods + `onTerminalData` / `onTerminalsChanged` via the existing
      `subscribe` helper.
- [x] `src/main/index.ts`:
      - `terminals = new TerminalManager({ pty: new PtyManager(), store: new TerminalStore(
        path.join(app.getPath('userData'), 'terminals')), resolveShell: () => resolveTerminalShell({...,
        configured: loadMeowConfig(configPath).terminal }), emitData/emitChanged → win?.webContents.send })`.
      - `ipcMain.handle` for each channel; `TerminalCreate` resolves `defaultCwd` from the agent's
        `cwd` (`findWorkspaceByAgent`), rejecting unknown agents.
      - `Channels.AgentRemove`: `await mainApp.terminals.removeSession(agentId)` before
        `workspaces.removeAgent`.
      - `before-quit`: `mainApp.terminals.flush()` first, then `terminals.stopAll()` joined with
        `mainApp.pty.stopAll()` before `app.exit(0)`.
- [x] `tests/integration/terminal-manager.test.ts` (real `PtyManager`): create → write → data event →
      kill → pid gone; output from the terminal instance never fires listeners on a second
      `PtyManager` instance standing in for `mainApp.pty` (Review Focus 1).

## Task 7: Renderer dock

- [x] `components/terminal/TerminalView.tsx`: owns one `Terminal` + `FitAddon`; on mount
      `terminalAttach(id)` → `term.write(scrollback)` → listen to `onTerminalData` filtered by id;
      `term.onData` → `terminalWrite`; `ResizeObserver` → `fit()` → `terminalResize` (debounced 50 ms);
      on unmount `terminalDetach` + `dispose`. Theme: read `--bg-chat`, `--fg`, `--accent`,
      selection colors from `getComputedStyle(document.documentElement)`; re-apply when `data-theme`
      changes (`MutationObserver` on `<html>`). Font: the app's mono stack.
- [x] `components/terminal/TerminalDock.tsx`: props `{ agentId, visible }`. Tab strip (title, status
      dot, exit code, double-click rename inline input, `✕` → `terminalKill`, `+` →
      `terminalCreate`), **Restart** button on exited tabs, top-edge drag to resize (120 px – 70 % of
      the pane, default 240, `localStorage` `meow.terminal.height`, wrapped in try/catch). Lists via
      `terminalList` on mount and `onTerminalsChanged`. Renders `TerminalView` only for the selected
      tab and only while `visible`. Empty dock auto-creates one terminal when first opened.
      Errors (cap reached) show via the existing toast/notice pattern.
- [x] `Pane.tsx`: `terminalOpen` state (per pane, persisted in `localStorage`
      `meow.terminal.open.<agentId>`), render `<TerminalDock agentId visible={active && !background &&
      terminalOpen} />` after `pane-body`; the dock is not rendered for draft sessions.
- [x] `PaneHeader.tsx`: terminal toggle button (lucide `SquareTerminal`) with tooltip
      `Terminal (Ctrl+\`)`; `⌘` on macOS.
- [x] Shortcut: `Ctrl+\`` / `Cmd+\`` handled in `Pane` only when `active`, ignored while focus is in
      an input other than the xterm textarea.
- [x] CSS in `styles.css`: dock, tab strip, resize handle, using existing tokens and the
      `--hairline`/`--radius-lg` card treatment (check the border-radius trap in
      `docs/reference/09-ui-guide.md` §9.5).
- [x] `tests/unit/terminal-dock.test.tsx` (jsdom, mocked `window.api`, xterm mocked): tabs render from
      list, `+` calls create, rename commits on Enter / cancels on Esc, exited tab shows Restart,
      `visible=false` mounts no `TerminalView`.

## Task 8: Send terminal text to chat

- [x] `TerminalView` context menu (`BaseDropdown` anchored at the cursor): **Copy**, **Paste**,
      **Send selection to chat** (disabled without a selection), **Send last 100 lines to chat**
      (read from `term.buffer.active`), **Clear**.
- [x] Dispatch `window.dispatchEvent(new CustomEvent('meow:composer-insert', { detail: { agentId,
      text } }))` — same pattern as `meow:model-changed`. `ChatPanel` listens, and `ChatInput` inserts
      a fenced ```` ```text ```` block at the caret without sending.
- [x] Extend `tests/unit/chat-panel-events.test.ts`: event for this agent inserts, other agent ignored.

## Task 9: e2e and docs

- [x] `tests/e2e/terminal.spec.ts`: open a project session, toggle the dock with the shortcut, type
      `echo E2E_TERM`, see it; switch to another session and back, the line is still there; close the
      tab, no tab remains.
- [x] Docs (only the affected entries):
      - root `AGENTS.md`: in-app terminals are back (session terminal dock); xterm no longer "declared
        but unused".
      - `src/main/AGENTS.md`, `src/renderer/src/components/AGENTS.md`, `components/chat/AGENTS.md`,
        `tests/AGENTS.md` as relevant.
      - `docs/reference/01-product-overview.md` (feature inventory row), `02-architecture.md`
        (TerminalManager, dedicated PtyManager), `05-ipc-contract.md` (channels/events),
        `06-data-and-storage.md` (`userData/terminals/`, `meow.json` `terminal.shell`),
        `09-ui-guide.md` (dock layout, shortcut, persistence keys), `10-build-test-release.md` if the
        e2e list is enumerated there.
      - Spec: add `TerminalRestart` to the §3.2 table.
- [x] `npm run typecheck`, `npm test`, `npm run build && npm run e2e`; Windows manual check with Git Bash,
      with Git Bash hidden (`MEOW_GIT_BASH_PATH` pointing nowhere → PowerShell), and quitting from the
      tray with a running `npm run dev` leaves no `node.exe` behind.

## Commit plan

One commit per task (Tasks 1–2 may share one), each with its docs. Suggested prefixes:
`feat(terminal): …`, `test(terminal): …`, `docs: …`.
