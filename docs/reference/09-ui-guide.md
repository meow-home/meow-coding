# 09 — UI Guide (Renderer)

React 19 + TypeScript, no UI framework, no CSS-in-JS. All data flows through `window.api`
(typed `AgentApi`). **Never import `electron` or `node:*` in the renderer.**

## 9.1 Entry point and window routing

`src/renderer/src/main.tsx` routes by query string — the same bundle serves three window types:

| Condition | Renders |
|---|---|
| `window.api` missing | A fallback telling the user preload did not load |
| `?file=<path>&root=<dir>` | `<FileViewer>` in a popup `BrowserWindow` |
| otherwise | `<App>` — the main window |

Every renderer calls `applyTheme()` and `watchTheme()` before first paint, so popups inherit the
main window's theme (see [9.6](#96-theming)).

## 9.2 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar (frameless: drag region + min/max/close)                    │
├────────┬─────────────────────────────────────────────────────────────┤
│Sidebar │ SessionPanes                                                │
│        │  ┌────────────────────────────────────────────────────────┐ │
│ work-  │  │ ChatPanel (active session)                             │ │
│ spaces │  │   (session dot/name/⋮ live in the title bar)           │ │
│        │  │                                                        │ │
│ theme  │  └────────────────────────────────────────────────────────┘ │
├────────┴─────────────────────────────────────────────────────────────┤
│ StatusBar (workspace · git branch · running count · app version)     │
└──────────────────────────────────────────────────────────────────────┘
```

Overlays: `SettingsDialog` (centered modal size xl tabbed),
`BrowserDialog`, `InstallGuideDialog`, `UpdateDialog`, `UpdateToast`, `FileContextMenu`.

### Files overlay

The title bar's **Files** button opens an in-app explorer docked on the right of the pane area — the
slot the old right panel used (never an OS window, so the title bar, sidebar and status bar stay visible). It
reads like a code viewer: open files are header tabs (with maximize/restore and close on the right), the
editor sits below them on the left, and a filterable, lazily loaded directory tree is the right column —
dotfiles and `node_modules` are listed. A per-file bar under the header spans the full panel width above
both columns (the editor and the tree start below it) and shows the open file's path relative to the
project — in the UI face, not the popup's mono — and, on the right, its Markdown toggle, a single
**Fold all** / **Unfold all** toggle (code files only), a **Toggle file tree** button and the `⋮` Files menu
(Focus filter, Refresh, Collapse all, Close all tabs, Copy path, Reveal in Folder, Open in VS Code). With no
open file the bar still renders with an empty path in the same place, so the toggle and menu stay reachable
and the bar does not jump when the first file opens. Hiding the tree persists in `localStorage` as
`meow.files.treeHidden`, and the tree is hidden rather than unmounted, so its expanded folders survive the
toggle; **Focus filter** shows the tree first when it is hidden, then focuses the input. Tabs follow the
preview rule: a single click in the tree or on a search hit opens an italic **preview** that the next single
click replaces, while a double click opens a permanent tab (a double click on a tab promotes it) and a file
that becomes dirty is promoted, so a replacement can never drop edits. The pin button — visible on hover and
on the active tab, filled once pinned — makes a tab permanent and sorts it first; **Close all tabs** keeps
pinned tabs, and the X still closes any tab. Code files also get a `+` in a gutter left of the line numbers
(hover a line to reveal it): clicking it sends that line — or the selected lines, when the click is inside the
selection — to the composer of the panel's own project's active session, as a fenced block headed by the
project-relative `path:line`; the markdown preview, images and the popup file window have no gutter. A
directory row is its chevron plus the name — no folder icon —
and a file row puts its typed icon (code, JSON, Markdown, image, styles, config, `.gitignore`, generic
fallback) in that same slot, so at a given depth both start at the same x; the open-file tabs use the same
icon. Rows are 2.166667rem tall rounded pills inset from the tree edges (`--menu-hover` on hover,
`--menu-active` for the active file and for a row whose context menu is open), indented 1rem per level. In a
git repository a changed file tints its name and shows its letter — `M`, `A`, `D`, `R`, `T` or `U` — at the
row's right edge, while a directory holding changes shows a dot; `.git` and ignored files stay clean. In the dark theme the editor and its gutter paint `--bg-chat` instead of One
Dark's own background, so the code area reads as part of the panel. Typing in the filter narrows the tree by
name; a `?` prefix searches file contents instead and lists `path:line` hits. Docked, the panel
fills its cell of the shared right-side grid. The grid (`src/renderer/src/right-panels-layout.ts`) fills its
cells **column by column**, spreading each column's panels over the rows, so a short column's panel spans the
rows the others left: with three panels the first two stack in the left column and the third spans both rows
of the right column, and no cell is ever left empty. The column's own splitter (`.right-panels-resizer`,
320–1600px, persisted in `localStorage` as `meow.rightPanels.width`) resizes every docked panel at once, and
a row splitter (`.right-panels-row-resizer`) appears wherever a column holds two or more panels — one per
column that really splits at that row boundary, so a spanning panel has none. Dragging it trades height
between the two neighbours (each keeps at least 6rem); the row heights are fractions of the grid, reset to
equal when the number of rows changes. `⤢` expands the
panel over the whole pane area and restore docks it again — the tree, tabs and open files survive both
directions. Every right-side panel is a **square, flush surface** (no border, radius or shadow): the grid's
hairline shows through 1px gaps as the only divider between cells, one 1px rule separates the column from the
chat, and a maximized panel covers the pane area edge to edge. `Esc` and `✕` close it, and switching to another project closes it.

The previous `RightPanel` (directory tree + artifacts) is parked in the source — its components, CSS, state and
the artifact store/IPC remain, but nothing renders it.

### Files panel: saving

Open files are tabs in the panel header and stay mounted while hidden, so switching tabs keeps unsaved edits. Ctrl/Cmd+S saves the active file, and an unsaved file shows a dot after its name. Closing an unsaved tab or the panel asks to discard the edits, whether from the close button, the title bar button or a project switch; keeping them after a switch returns to that project. Escape does not close the panel while anything is unsaved. Expanding the panel keeps tabs, edits and undo, because its React tree stays in one portal and only the DOM node moves. Quitting the app does not ask. The popup file window keeps its Save, Open in VS Code and Copy buttons, since it has no tab or panel menu.

### Tasks panel

The title bar's **Toggle tasks** button opens the session's **Tasks** panel in the right-hand column —
the same docked slot as Files, Terminal and Sub-agents. It replaces the old Processes overlay (one tab per
shell plus a `Monitors` tab) and the background-session strip with **one list**: background sessions,
background shells, polled commands and delegations. Every task is a **card**, grouped `Active` /
`Finished` under a plain caption (label + count, no rule under it): an **identity badge** that says what
is running, a title line that wraps, a secondary `kind · id` line, and on the right the state chip above
the elapsed/age. The badge is the Meow mark for a native session, `Users` for a sub-session or a
sub-session delegation, `Terminal` for a background shell, `RefreshCw` for a polled command and the
Antigravity logo for a CLI delegation (the watch's `cliAgentId`, shown as `antigravity · <id>`). It
carries **identity, not state** — there is no state dot on the card; the chip is the state. A live card
also carries a **stop icon button** that runs the same action as its open card's stop action, so a task
can be stopped without expanding it. The panel header is minimal — `Tasks`, the total count,
maximize and close; the cards carry the state. There are no tabs: the list itself is the navigation, so
eight shells no longer mean eight tabs.

Clicking a card expands it in place (multi-open) to its facts — mode/model/cwd/session id for a session,
command/cwd/started/exit for a shell, kind/until/started/session/finished for a watch — then its content:
the last two messages (`listChatMessages`) for a session, the live output box for a shell
(`backgroundProcSubscribe` on expand, `backgroundProcUnsubscribe` on collapse — never consuming the
agent's `bash_output` read offset), or the tinted result box for a resolved watch. The action row follows
the kind: Open session / Stop / Delete (behind a confirm), Kill process (a labelled button, never a tab ×),
Stop watching / Dismiss (`monitorsCancel`), and Open session for a delegation watch whose sub-session is
in the project. Stop/kill actions are red (`.tasks-act.stop`). Cards never use a left accent rule: state
is the dot, the chip and the surface tint.

Docked it is a cell of the shared `.right-panels-grid` (the column splitter sets the width), `⤢` expands it
over the whole pane area like Files, `Esc` closes the open rows first and then the panel, and the lists
poll `backgroundProcsList`/`monitorsList` every ~1.5s while open. A `focus` prop (`{ monitorId?, seq }`)
from the chat's background tasks card expands that watch once and reports back through `onFocusApplied`.

### Background tasks card

A session with at least one watch shows a **Background tasks** card at the **bottom of its chat feed, right
above the todo list** (`chat/BackgroundTasksCard.tsx`, `chat-tasks-*` classes). It is inline, not sticky: it
scrolls with the transcript (so it is never pinned over the composer) and keeps one stable position, so a watch
starting or resolving never appends a row or moves the reader. The header reads `Background tasks` with `N running · M done`, one dot per watch (pulsing accent while
watching, green resolved, yellow on timeout), **Open pane** and a collapse caret; each row shows the kind icon
(shell/poll/delegation), its label, the target (`proc <id>` or the `until` condition), `waiting <elapsed>` or the
reason plus how long ago, and a `✕` that calls `monitorsCancel` without opening the pane. A row click opens the
Tasks panel with that watch expanded. The card refetches on the `procs:monitors-changed`
push event (plus a 1s tick for the elapsed times) instead of polling, and renders nothing as soon as **no watch is
running** — it only exists while the session has something in flight. A row that resolves keeps its `completed` /
`timeout` line only while another watch is still running; once the last one resolves the card disappears, and the
resolved watch stays reachable in the Tasks panel until dismissed.

### Session terminal panel

The session terminal is a right-hand panel (`TerminalOverlay`) hosting interactive shell tabs powered by xterm.js (`TerminalView`) and dedicated `PtyManager` processes in the main process.
- **Toggle & shortcut**: Toggled via `Ctrl+\`` (`Cmd+\`` on macOS) in the active pane or the Terminal button in the title bar (`PanelToolbar`). `App` owns `terminalOpenFor` (the session the panel shows, or `null`) and `terminalFull`; toggling from another session switches the panel to that session. It is not persisted.
- **Layout**: Uses the shared panel chrome — `.files-overlay` surface and `common/PanelHeader`: tabs in the header with no title (status dot, exit code, double-click rename, close), `+` new terminal, Restart when the selected tab exited, expand/restore, close. Docked, it joins the shared `.right-panels-grid` next to the Files and Subagent panels (auto rows/columns, shared width splitter and per-column row splitters); expanded (`full`), it overlays the whole pane area like Files. The chat keeps its full height.
- **Mount gating**: Only one terminal panel exists and its xterm is created only for the selected tab, so hidden sessions never allocate xterm instances. Removing the session closes the panel.
- **Run from chat**: A shell fence in an assistant message renders as a command box (`Run in terminal` / `Copy command`; see the chat conventions). Run raises `terminalRunRequest` in `App` (`{ agentId, command, seq }`), opens this session's panel and hands the request to `TerminalOverlay`, which consumes it once: the selected tab when it is running, else the first running tab, else the selected/first tab after a restart, else a new tab created with the command. The command reaches the PTY through `toTerminalInput` (CRLF → LF, one trailing `\r`), so a multi-line block goes in as a single paste. A request that is still pending at mount suppresses the panel's own auto-create, so a chat command never opens a second empty tab.
- **Context menu & clipboard**: Right-clicking the terminal view opens a context menu with Copy, Paste, Clear Buffer, and "Send Selection to Chat". "Send Selection to Chat" dispatches a `meow:composer-insert` custom window event containing the formatted selection (```text ... ```), which `ChatInput.tsx` listens for and appends to the composer.
- **Always dark**: The terminal ignores the app theme. Its colors come from `--terminal-bg` / `--terminal-fg` (defined once on `:root`, never overridden by `[data-theme="light"]`) plus `--font-mono`, read once when the xterm is created. `styles.css` paints `.terminal-overlay-body`, `.xterm` and `.xterm-viewport` with `--terminal-bg`, because `xterm.css` paints the viewport `#000` and it shows below the last row.

### Built-in browser panel

The built-in browser is a right-hand panel (`BrowserOverlay`) showing one session's tabs; the page itself is a native `WebContentsView` owned by main, so the panel only supplies the chrome and the bounds.
- **Toggle & state**: The Globe button in the title bar (`PanelToolbar`) toggles it for the active session; `App` owns `browserOpenFor` (session id or `null`) and `browserFull`. An agent tab request (`onBrowserPanelRequest`) opens it only when that session is the active session of the active project; closing it keeps it closed until the next request. A dot on that button shows while the session has a tab in `agent` or `approval`.
- **Layout**: Same chrome as the terminal: `.files-overlay` + `common/PanelHeader` (tabs with a globe or agent dot, a `BaseDropdown` context menu with Close, Close others, Reload, then `+`, console toggle, a menu with Open in default browser, expand/restore, close). Below it, back, forward, reload and a centered address field. Docked it joins `.right-panels-grid` before the terminal (two panels fill one column, so the grid stacks them vertically behind a row splitter); expanded it overlays the pane area. The panel, its viewport and their ancestors are square because the native view is a rectangle.
- **Toolbar**: Back, forward, reload/stop, the address field and "Open in default browser" (`browserOpenExternal`, http(s) only). Back/forward/reload/address are disabled while the agent owns the tab. Bare hosts normalize to `https://`, loopback hosts to `http://` (`normalizeUrlInput`); `file:`/`javascript:`/spaces show an inline error.
- **Control banner**: `agent` → "Meow is using this tab" + **Take over**; `user` → "You have control..." + **Hand back**, or the handoff reason + **I'm signed in**; `approval` → "Meow is waiting for your approval in chat."; `idle` → none.
- **Viewport**: attaches the panel on mount and detaches on unmount, sends the placeholder rect (rounded CSS px) on resize (rAF-coalesced, skipped when unchanged/zero). A crashed tab freezes the view away and shows "This tab crashed." with a Reload that navigates to the tab URL (re-enables the debugger). No tabs → "No open tabs" + New tab. Tabs live in main, so expand/restore remounts the panel without reloading the page.
- **Browser dialog**: opened from the status-bar pill. **Agent browser** picks the default backend (`Built-in` or `Chrome`) and, for Built-in, the site-approval policy (`Ask before acting on a new site` / `Don't ask`, with the consequence spelled out) plus **Clear browsing data** behind a `ConfirmDialog` (cookies, storage and cache; open pages are reloaded). Saves are read-modify-write through `getSettings`/`saveSettings`, so other settings survive. The Chrome extension status, install and trusted list stay below, and a pending approval is never hidden. A confirm over this dialog stacks as a second modal: Escape closes only the top one and the native view stays hidden until both close.
- **Drawer**: the head's `Console and network` toggle opens a 12rem drawer under the viewport with Console and Network tabs, polling `browserTabLogs` every 1.5 s only while open (paused when the document is hidden, no overlapping requests, no re-render when nothing changed). Rows are plain text in mono, `error` in red, warnings in yellow, failed/≥400 requests in red; the Console tab carries an error count. **Send to chat** inserts the last 100 entries as a fenced block into the composer and never sends it. The viewport shrinks, so the native view follows through its ResizeObserver.
- **Terminal links**: loopback http(s) URLs printed in the session terminal are links (`findLoopbackLinks`, `isLoopback` from `src/shared/loopback.ts`); a left click creates a tab for the session and opens the panel with it active. Lookalike hosts and non-http schemes stay plain text.
- **Keyboard**: with focus in the page, `` Ctrl/Cmd+` `` toggles the terminal, `Ctrl/Cmd+Shift+B` toggles the panel, `Ctrl/Cmd+L` focuses the URL bar, and `Ctrl/Cmd+R` reloads the tab (the app does not reload). While the agent's shield is up only the app-level shortcuts work.
- **Occlusion**: the native view paints above HTML, so `useBrowserOcclusion` hides it while an overlay is open. Reasons are independent (`overlay` menus/modals need a captured image; `cover` reasons — crashed tab, another panel expanded, project switched away — hide without one). 0→1 captures, paints the image in the placeholder, then hides; 1→0 shows and drops the image on the next frame. `BaseModal` always counts, `BaseDropdown` only when its measured rect intersects the placeholder, and the right-panels/files resizers count during a drag. Nothing is captured while no panel is attached. Main keeps the panel hidden across tab switches and places a new tab hidden, so there is no renderer re-freeze.

## 9.3 `App.tsx` — the state hub

Owns: workspaces, the mounted `WorkspaceRuntime`s (one per kept-alive project),
background flags, browser status, update status, sidebar collapsed state (`sidebarCollapsed`), parked
right-panel state, artifacts, the Files panel state (`filesOpenFor` — closed by default, closed on project
switch; `filesFull` — docked by default; `filesWidth` — docked width, persisted in `localStorage`), the
terminal panel state (`terminalOpenFor`, `terminalFull`, and `terminalRunRequest` — the command a chat
command box asked to run, cleared by the panel once consumed), and the active session per project
(`activeSessionByPath`).

```ts
export interface PaneModel { agent: AgentConfig; state: AgentState; git: GitStatus | null }
```

`runtimesRef` mirrors the mounted runtimes, `activePathRef` the active project and `orderRef` the
keep-alive order, so the mount-once event subscriptions and the callbacks they invoke never read a
stale value.

Event subscriptions set up in `App`: `onAgentState`, `onGitStatus`,
`onAgentBackground`, `onAgentConfig`, `onBrowserStatus`, `onBrowserOpenInstallGuide`,
`onUpdaterStatus`, `onArtifactsChanged`. Every one returns an unsubscribe function
that must be called in the effect cleanup. (The Tasks panel subscribes to
`onBackgroundProcData` itself, per expanded shell row, so the app hub does not.)

## 9.3.1 `App.tsx` — the Tasks panel state

The Tasks panel is keyed by **agent id** (the title bar's Tasks button), not project path: `tasksOpenFor`
(the session whose list is shown, `null` when closed) and `tasksFull` (maximized). Like the Files panel it
renders in one of two places, chosen by `full`: docked, it is a child of the right-panels grid next to
Files/Terminal/Browser/Sub-agents/Git; expanded, it is a direct child of `.main` so its absolute insets cover
the pane area. The background sessions in its rows come from the panel's project runtime
(`workspace.agents` + the `agents` state + `backgrounds`); opening a row clears that session's background
flag, switches to it and closes the panel, and deleting it goes through the same pane-removal guard.

Update-dialog policy: `update-available`, `downloaded` and `download-progress` open the dialog **only
for a manual check** (`manualCheckRef`); `error` and `not-supported` close it; `up-to-date` only opens
a dialog when the check was manual, so the automatic startup check never pops anything. The download
itself is automatic (no click needed) and the install is silent on quit — the dialog's
"Update & Restart" / "Restart now" only brings that moment forward. Clicking it while the download is
still running schedules the restart for the moment the download finishes ("Restarting when ready…"),
and "Keep working" cancels that (`cancelInstall`).

A background download that finishes announces itself without stealing focus: the status bar version
slot becomes an "Updating 42%" / "Restart to update" pill (`StatusBar` `update`/`onUpdateClick`, the
way back into the dialog), and the renderer raises an `UpdateToast` in the bottom-right corner (body
opens the dialog, "Restart now" installs, "Later" dismisses it for that version). The status is
replayed on mount through `getUpdaterStatus`, so a window that loads after the check still shows it.

## 9.4 Component inventory

### Shell

| Component | Responsibility |
|---|---|
| `TitleBar.tsx` | Custom window chrome for frameless platforms, painted with the chat surface (`--bg-chat`) so the header and the conversation read as one panel; when collapsed, hovering the title bar brand region reveals a floating full sidebar popover dropdown menu. Between the brand and the panel tools it seats the active session's title (`SessionTitle`); with the sidebar collapsed the brand strip shrinks to the logo + toggle so the title moves left, next to the expand button. |
| `PopupTitleBar.tsx` | Same for the FileViewer popup (drag region + Linux min/max/close) |
| `Sidebar.tsx` | Project list; header action bar features a vertical menu with a single "New session" (`Plus` icon) full-width menu item without border radius or bottom border (adding a folder as a project moved to the new session's footer picker). Each project row is a lightweight group header — the project name (bright on the current project, dim otherwise) followed by a **trailing** expand/collapse chevron, with the `+` (new session) and `...` (project menu) icons revealed on hover / while the project is current. The project path lives on the row's `title`: there is no path line and no session count. An expanded project lists its **sessions**, indented: a status dot (green = running, yellow = waiting on input, none when idle; it hangs in the row indent, so names stay aligned), the name, and a trailing `...` menu that appears on hover / when active. A session created by `delegate_session` is a **sub-session**: it sits directly under the session that spawned it, one indent deeper, with a small branch glyph before the name and a `Sub-session of <parent>` tooltip; its row keeps its own status dot and menu. Deleting a session also deletes its sub-sessions. The active session is a full-width rounded pill. The per-row `...` menu holds Rename (via inline input), Stop (when running) and Delete. The project `...` menu holds Open, Open in VS Code, Git, Open Folder, Open Terminal (a real OS terminal window via `openSystemTerminal`) and Remove. The `+` button activates a draft session; deleting a project's last session transitions the workspace to a draft session pane, and adding a folder as a project (`Choose folder…` in the draft footer) registers the project only — no default `meow` session is created. Creating a backend session is deferred until the user sends their first message. Expanded state persists in `localStorage` (`meow.sidebar.expanded`). Also: Providers entry and theme toggle in the footer menu. Projects with sessions waiting on a permission/question prompt show a red count badge (and a dot on the collapsed-rail avatar). |
| `StatusBar.tsx` | Workspace name, git branch (plus `↑N` unpushed / `↓N` behind and a tooltip naming the upstream), running count, app version — the version slot turns into an "Update available" / "Updating 42%" / "Restart to update" pill while an update is downloading or downloaded, and clicking it opens the update dialog |
| `SessionPanes.tsx` | Session layout of one project: **every session stays mounted** (inactive ones carry the `hidden` attribute, hidden by CSS and never unmounted) so a session that is not showing keeps streaming/answering. The active session is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the session that was showing); it reports the first session when the stored id no longer exists |
| `Pane.tsx` | One session: `ChatPanel` only — there is no header row, the session identity lives in the title bar; background badge mode |
| `SessionTitle.tsx` | The active session's identity in the title bar, between the brand and `PanelToolbar`: the status dot (which carries the status as its accessible name — `role="img"` + the status label, with any exit code folded in), the name (ellipsized with the full name on `title`, so a long name never pushes the tools), and the `...` menu (Open Folder / Open in VS Code / Delete session, with a confirm dialog). The `...` button is the shared `.icon-btn`. No status word (the dot already shows it) and no git readout (the status bar owns branch + dirty count) |
| `EmptyState.tsx` | No-pane hint (differs for "no workspace" vs "workspace open") |
| `UpdateToast.tsx` | Bottom-right notice for an update that finished downloading in the background (body opens the update dialog, "Restart now" installs, "Later" dismisses it for that version); paired with the OS notification, which main only sends when the window is not focused |
| `RightPanel.tsx` | Resizable panel with a fixed header; **both tabs stay mounted** for instant switching (**parked** — nothing renders it since the Files panel took its slot) |
| `RightPanelTree.tsx` | Lazy directory tree; auto-expands the project root; background refresh (**parked**) |
| `RightPanelArtifacts.tsx` | `.md` files agents created/edited (**parked**) |
| `FileViewer.tsx` | Popup file viewer: `PopupTitleBar` + the shared `file-content/FileContentView.tsx` |
| `file-content/FileContentView.tsx` | Toolbar (Raw/Highlighted toggle, Open in VS Code, Copy) + body of a file (CodeMirror editor, rendered markdown, or an image), shared by the popup window and the Files overlay tab. With `hideFileActions` the toolbar is the panel's per-file bar: project-relative path, one Fold all / Unfold all toggle (state kept per open file) and the host's `toolbarActions`; `toolbarHost` portals it into the panel's full-width bar, and an inactive tab renders no toolbar. `extraExtensions` carries the Files panel's send-line gutter; the popup passes none |
| `files/FilesOverlay.tsx` | The Files panel: the shared panel header with the open-file tabs and maximize/restore/close, a per-file bar (`.files-bar`) spanning the full panel width between the header and `.files-body` — rendered into a host element by the active tab's `FileContentView`, with the project-relative path and the file actions plus Toggle file tree / the `⋮` Files menu (the empty state renders its own bar into the same host, so it does not jump when the first file opens) — the active tab's `FileContentView` on the left and the tree side on the right (drag the `.files-side-resizer` splitter on its left edge — dragging left widens it — ≥ `FILES_SIDE_MIN_WIDTH` 160px while leaving the editor ≥ `FILES_MAIN_MIN_WIDTH` 160px; the width persists in `localStorage` `meow.files.sideWidth` and applies to both modes, double-click resets to the CSS default of 42% docked / 20rem expanded; hiding it persists in `meow.files.treeHidden` and only sets `hidden`, so expanded folders survive); docked on the right with a drag-to-resize left edge, or expanded over the pane area (same mounted instance, so tabs/tree survive the toggle). Both modes are elevated by `--shadow-panel`, whose blur is tuned to fade out inside the panel's 0.333333rem offset from `.main` (expanded mode layers it on top of the `--bg-chat` backdrop ring that hides the pane chrome) |
| `files/FilesTree.tsx` | Lazily loaded tree of the overlay; lists dotfiles and `node_modules`; `?`-prefixed filter searches file contents and lists `path:line` hits; refreshes on context changes. A directory row is its chevron plus the name (no folder icon) and a file row puts the typed `file-icon` in the same slot; rows are tall rounded pills (`--menu-hover`/`--menu-active`, `--radius`, 1rem indent per level); in a git repository a changed file tints its name and shows its status letter at the row's right edge, a changed directory shows a dot, and the status comes from `git-decorations` (one `gitGetStatusDetail` call per debounce, on mount, on `reloadToken` and on context changes). A row click opens a preview; a file row double click opens permanent |
| `processes/TasksPanel.tsx` | The Tasks panel (`TasksPanel` default export): a right-hand column panel with **one expandable list of cards** instead of tabs — background sessions, background shells, polled commands and delegations, grouped `Active` / `Finished` under a rule-less caption. A card is a wrapping title line (state dot + kind icon + label), a `kind · id` line, the state chip above the elapsed/age on the right, and — while live — a stop icon button that runs the card's stop action without expanding it; clicking the card expands it in place (multi-open) to facts (mono kv), content (last two messages via `listChatMessages`, the live output box via `backgroundProcSubscribe`/`backgroundProcUnsubscribe`, or the resolved watch's result) and the kind's actions (`Open session`/`Stop`/`Delete` with a confirm, `Kill process`, `Stop watching`/`Dismiss` via `monitorsCancel`, `Open session` for a delegation watch; stop/kill are red). Its header is minimal: title, total count, maximize and close. Docked it is a cell of `.right-panels-grid`, maximized (`.full`) it covers the pane area like Files. Polls `backgroundProcsList`/`monitorsList` every ~1.5s; its optional `focus` prop (`{ monitorId?, seq }`, applied once then dropped through `onFocusApplied`) lets the chat's background tasks card expand one watch |
| `files/line-send-gutter.ts` | `buildSendText` / `languageLabel` / `lineSendGutter`: a gutter before the line numbers with a `+` on the hovered line; sends the line or the selected lines to the composer via `meow:composer-insert`, fenced with a run longer than any backticks in the code |
| `files/open-tabs.ts` | Pure tab rules over `{ tabs, activeTab }`: `openTab` (single click = preview, double click = permanent, an open file only activates, a preview is replaced in place), `promoteTab`, `togglePinned` (permanent, sorts first), `closeTabs`, `closeAllTabs` (keeps pinned), `activateTab` |
| `files/file-icon.tsx` | `fileIconKind` / `fileIconFor` / `FileIcon`: a file name → lucide icon + colour class (code, JSON, Markdown, image, styles, config, `.gitignore`, generic); colours are theme tokens in `styles.css` |
| `files/git-decorations.ts` | Pure git status helpers: `buildGitDecorations` (porcelain path → `{ letter, kind }` plus ancestor directories; `M`/`A`/`D`/`R`/`T`/`U`, untracked-directory prefixes, quote stripping), `decorationFor`, `directoryDecoration`, `projectRelativePath` |
| `files/file-path.ts` | `baseName` / `joinProjectPath` — renderer-side path helpers (the renderer must not import `node:path`) |
| `files/tree-filter.ts` | `filterTree` — name filter over already-loaded directories, keeping the ancestor chain of every match |
| `FileContextMenu.tsx` | Context menu for tree/artifact entries and the Files overlay (Copy path when `showCopyPath`) |

### Terminal (`components/terminal/`)

| Component | Responsibility |
|---|---|
| `TerminalOverlay.tsx` | Right-hand session terminal panel (`common/PanelHeader`, joins the right-panels grid): tabs in the header, tab renames, new tab (`+`), close tab (`×`), restart exited tab, expand/restore, close. |
| `TerminalView.tsx` | Individual xterm.js instance: fit addon, IPC data/resize/exit event subscriptions, always-dark `--terminal-*` theme, right-click context menu (Copy, Paste, Clear, Send to Chat via `meow:composer-insert`). |

### Browser (`components/browser/`)

| Component | Responsibility |
|---|---|
| `BrowserOverlay.tsx` | Panel shell: tab list (`browserTabsList` + `onBrowserTabsChanged`), tab context menu, toolbar/banner/viewport composition, inline error row. |
| `BrowserToolbar.tsx` | Back/forward/reload-stop, address field (edit on focus, Enter navigates, Escape reverts), Open in default browser. |
| `BrowserControlBanner.tsx` | Control-state banner and Take over / Hand back / I'm signed in actions. |
| `BrowserViewport.tsx` | Placeholder that attaches/detaches the native panel and streams its rect; empty and crashed states. |
| `normalizeUrlInput.ts` | Pure URL-field normalizer (bare → https, loopback → http, other schemes/spaces → null). |

### Dialogs

`AddProjectDialog`, `UpdateDialog` (update status, progress, restart), `BrowserDialog` (bridge status + extension approval),
`InstallGuideDialog` (extension install steps).

### Chat (`components/chat/`)

| Component | Responsibility |
|---|---|
| `ChatPanel.tsx` | The container: subscribes to chat events, owns feed state (items / todos / queue / pendingPrompt), rAF-batches stream deltas, and merges transcript loads with live rows by stable id. Tool start/result events upsert the same row, and a result recreates a missing start row, so an in-flight transcript-load race cannot hide tool output. At render time the feed map folds **every** `tool` item into a `cluster` row via `clusterToolRows` (a pure helper that walks `items`) — so the agent's back-to-back tool bursts read as one tight group, and even a lone tool call renders as a 1-tool cluster with the same chrome. The helper also drops empty assistant messages (no text / reasoning / images) entirely from the feed; the agent's loop persists these between tool batches, so without that drop otherwise-consecutive tools would scatter across 1-tool clusters on reload. State stays flat, so paging and live upserts are unchanged. Renders feed (`FeedMessage` with hover copy action bar for assistant messages) + composer + context footer. The todo list is a feed row (`TodoCard`) rendered after the transcript rows and right above the pending prompt, so it scrolls with the feed (not sticky): a neutral hairline card headed `Tasks` + `done/total`, one row per todo with a status mark (check / spinner / circle / x); the in-progress task spins and pulses (off under `prefers-reduced-motion`). The header toggles it collapsed, where it keeps naming the active task. It disappears when the list is empty. An incoming delegated message renders as a user bubble with a `delegation` badge and a `From session: <name>` label (`.chat-delegation-label`); the metadata travels on `FeedItem`/`toFeedItem` so a reload reproduces it, and `direction: 'result'` rows stay unlabelled. The permission/question prompt with type badge tag is the **last row of the chat feed** (the meow-chatui `PromptCard` placement), not a composer child: it scrolls with the transcript it interrupts, and a prompt that arrives while the user is reading history is scrolled into view, since the agent stays blocked until it is answered. Answering a `question` prompt also lands the answer in the feed as a user bubble (the loop's `user-message` event, right after the tool row), so the transcript reads as a conversation. The composer is two stacked blocks — the **queued-messages card** (`.chat-queue`, rendered only while the queue is non-empty: a header with the count and a caret that collapses it, then one row per message with always-present send-now / edit / remove actions) directly above the **input card** (`ChatInput`) — plus a one-line **footer** (`chat-footer-project-group` on the left: project folder name and a git branch chip that opens the Git view; `chat-footer-controls` on the right: context readout + `ModePicker`). In a **new session** (the draft, before the first message) the folder name is a `BaseDropdown` project picker — the known projects (current one checked) plus `Choose folder…`, which adds the picked folder as a project and starts the session there; once the session has started its cwd is fixed and the footer shows plain text. Memoized. |
| `chat/BackgroundTasksCard.tsx` | The chat feed's last item (above the todo list) while the session has watches: `Background tasks` header (`N running · M done`, one dot per watch — pulsing while watching, green resolved, yellow on timeout — Open pane, collapse caret) and one row per watch (kind icon, label, `proc <id>` or the `until`, `waiting <elapsed>` / reason + ago, `✕` → `monitorsCancel`). Inline and stable: it scrolls with the transcript, never appends a row per update, and renders `null` when empty. Refetches on `procs:monitors-changed` with a 1s tick for elapsed times; a row click opens the Tasks panel with that watch expanded |
| `ChatInput.tsx` | Composer, **one rounded card** with everything inside it: a 36px mascot (`MeowPet`) perched on the card's top border (absolutely positioned, so it costs no layout), an optional edit banner (`.chat-input-editing`), image/mention chips, the auto-growing field (`rows=1`, `field-sizing: content`, capped at 8 lines and then scrolling) and, on its own bottom row (`chat-input-bar`), the `+` add menu, the model picker, then the right group — variant picker + one round 2.25rem button: Send (arrow) at rest, disabled while empty, Stop while a turn runs, and Send again (check, `Save edit`) while a queued message is edited. Enter sends, Shift+Enter inserts a newline, Esc cancels an edit when no menu is open, and Alt+Enter sends the head of the queue now. Placeholder: `Ask anything, @ to mention, / for actions`, or `Processing...` while running. Paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, `/` command menu, edit-queued flow. Leaving edit mode without saving (the queued message was removed, or it drained into its own turn) drops the text that edit loaded into the field — the field is uncontrolled, so otherwise that text would sit there and a later Enter would submit it as a brand-new message; anything the user typed after it stays. Memoized, **uncontrolled**. |
| `useChatScroll.ts` | Feed scroll controller: follow / anchored / manual modes, turn-top anchoring, jump-to-end button. Detach is gesture-driven: only wheel, touch, keyboard nav, or a scrollbar drag leaves follow mode — a `scroll` event observed off the bottom while the DOM itself grows (streamed deltas, `content-visibility` rows resolving their height, history paging) must NOT detach it, so `scrollEventAction()` classifies each scroll event into none/follow/detach instead of trusting the position alone. After the user scrolls away (manual mode) following only resumes at the literal bottom — re-arming from the loose 80px follow zone would make a slight upward nudge on a long, still-streaming turn snap the viewport back down next delta (up/down jitter). Pure geometry helpers live in `chat-scroll-geometry.ts`. |
| `ToolCallCard.tsx` | One tool call in a compact micro-bar layout (badge, file/command summary, status hairline, expandable diff/output body). Memoized. When `collapseWhileRunning` is true (set by `ToolCluster`), the card never auto-opens — even while the call is `pending` — so a long run of tool steps stays collapsed. Edit-style calls (`edit`, `write`, `apply-patch`) show their `+N −M` line counts (from `diffStats`) in the header. Inside a cluster a step renders as a plain list row (no coloured left rule, no caret, lowercase badge; the ✓/✗ carries status), and a bash row drops the leading `cd <dir> &&` (`stripCdPrefix`; the hover title keeps the full command). |
| `ToolCluster.tsx` | **Every** tool call renders inside a cluster, even lone ones. Takes `steps` (`ClusterStep`: a tool call or a `thought` — reasoning-only messages between the calls render as quiet `thought` rows in the list) and `live` (newest row of a running turn: with no step pending the line reads `Thinking…`). A run of consecutive tool calls folds into one Claude-style line, **collapsed by default** and without card chrome: a summary of what the run did built by `toolSummary.ts` (`summarizeCalls`, e.g. `Read 2 files, edited a.ts, ran a command`), the run's `+N −M` line counts (`diffStats`), a red `· N failed` when a step was denied or errored, and a trailing caret. While a step is `pending` the line instead names that step with a spinner and progress (`Running npm test… 2/3`, via `describeRunning`). Opening it shows the inner `.tool-call` cards in one framed list, stacked with a 1px hairline between them. Always passes `collapseWhileRunning` to every inner `ToolCallCard` so clustered steps stay collapsed even while running (the cluster header already shows progress). Inner rows keep their own expand toggle, so the user can still drill into one tool by clicking it. Clustering happens at render time inside `ChatPanel.tsx`. |
| `toolSummary.ts` | Pure helpers for the cluster line: `summarizeCalls` (groups calls by kind in first-seen order, names a single file by basename), `describeRunning` (present-progressive label for the active step), `stripCdPrefix`, `diffStats` (lines added/removed by edit/write/apply-patch; an edit's shared leading/trailing lines are context, denied/failed calls count nothing). |
| `DiffView.tsx` | Inline diff for edit-style tool calls |
| `MarkdownText.tsx` | `marked` + `DOMPurify.sanitize`; with `onRunCommand` (assistant feed only) a shell fence becomes a `.chat-cmd` box with Run in terminal / Copy command |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs table pipes before rendering |
| `markdownPaths.ts` | Turns file paths in markdown into clickable `openFile` links |
| `commandBlocks.ts` | `shellLanguage` (which fence languages get a command box; `console`/`terminal` excluded) and `toTerminalInput` (a fenced block → one PTY write) |
| `highlight.ts` | Shiki syntax highlighting |
| `ContextFooter.tsx` | Context readout — a 24 × 24 icon-button ring; hovering shows a popover with session tokens in/out + cost. Hover-only, not clickable |
| `BaseModal.tsx` | Base modal overlay portaled to `document.body` with backdrop click, Escape key, and size modifiers |
| `BaseDropdown.tsx` / `Dropdown.tsx` | Base popover component with auto-flip / smart positioning (portaled to `document.body`, so a pane's `overflow: hidden` cannot clip it) & model / variant / build-plan mode selection |
| `parseCommandInput.ts` | `parseCommandInput(raw) → { isCommand, prefix }` for the `/` menu |
| `questionAnswer.ts` | `buildQuestionAnswer` for permission/question responses |

Chat conventions:

- **Transient status lines** (compaction, retry) live only in feed state — never written to the
  transcript, so they vanish on reload. That is deliberate.
- **Error card.** A failed turn is the exception: it is persisted as an `error` transcript item and
  rendered as `.chat-error-card` (red left rule, title, message, Copy). When the error is retryable
  the card also shows a **Retry** button (`.chat-error-retry`) that calls
  `window.api.retryChat(agentId, errorId)`; main drops the item and resumes the turn with a
  continuation instruction, so the card disappears via the `error-removed` event. Non-retryable
  errors (hook block, missing API key) show no Retry button.
- **Recovery notice.** `step-discarded` with a `recovery` level shows a transient
  `[meow] Model started repeating itself — recovering (n/3)` notice; once automatic recovery is
  exhausted (level 4, no `recovery` on the event), the notice reads
  `[meow] Model kept repeating itself — waiting for your answer` next to the question popup
  (Continue / Stop / custom text). Choosing Stop, or dismissing the prompt, ends the turn with a
  `Stopped: …` error (stream or tool wording depending on `stuckCategory`).
- **Command boxes.** A fenced block in an assistant message whose language is a shell (`bash`, `sh`,
  `shell`, `zsh`, `fish`, `ksh`, `dash`, `powershell`, `pwsh`, `ps1`, `cmd`, `bat`, `batch`) renders as a
  command box instead of a bare `pre`: the command on the left, `Run in terminal` and `Copy command` on
  the right (`.chat-cmd`, always visible but dimmed until hover/focus). Run opens this session's
  terminal panel and types the whole block there (`App` → `terminalRunRequest` →
  `TerminalOverlay`); Copy writes the command to the clipboard and flashes a check for 1.5 s.
  `console`/`terminal` fences stay plain code — they mix a prompt with its output, so replaying them
  would run the wrong thing. Question prompts, sub-agent output, the file viewer and the update dialog
  render `MarkdownText` without `onRunCommand`, so they keep plain code blocks.
- **Prompt placement.** The permission/question prompt is the **last row of the feed**
  (`.chat-prompt` inside `.chat-feed-content`, before the `chat-latest-boundary` anchor) — the
  meow-chatui `PromptCard` placement — so it scrolls with the transcript it interrupts instead of
  sitting above the composer. The agent stays blocked until it is answered, so a prompt that arrives
  while the user is reading history calls `jumpToEnd()` to bring it into view. The card has no height
  cap and no overflow of its own: the feed is already the scroll container, so a long question grows
  the card and the transcript scrolls, rather than nesting a second scrollbar inside the card (and
  the prompt header is not sticky, since with no inner scroll container it would resolve against the
  feed and pin itself to the feed's top edge while the card is in view). A question prompt has a
  header **×** (`.chat-prompt-close`, next to the collapse chevron) and, when options are present,
  one footer action row: `[Submit] [Skip]` for multi-select, `[Skip]` for single-select (clicking a
  row answers immediately). The footer never duplicates itself: the hint block no longer renders its
  own Skip. Skip — ×, the footer button, or Esc outside the field — declines to answer and ends the
  turn through the same `stopChat` the composer's Stop uses, so the tool reports the question as
  unanswered and the next turn still sees it, and the prompt is cleared locally too (it must not
  wait for a `done` event that may never arrive). A free-text answer is **input-only**: no Send
  button beside the field; Enter submits, Esc closes an optional field or skips a text-only
  question. Multi-select rows use a filled-square checkbox (`.chat-check`) and selected rows carry a
  soft accent tint without a left accent bar; the confirm/skip/free-text labels come from the
  model (`submitLabel` / `skipLabel` / `customLabel`, defaults `Submit` / `Skip` / `Type your own
  answer`). Permission prompts are unchanged — Deny already covers them. Pinned by
  `tests/e2e/prompt.spec.ts` and `tests/e2e/chat-lane.spec.ts`.
- Feed items are updated **copy-on-write**; never mutate in place, or `memo()` stops working.
- Images travel as data URLs inside `ImageAttachment`; only `image/*` is accepted.
- **The queued-messages card lives in the composer, not the transcript.** `.chat-queue` sits directly
  above the input card inside `.chat-composer` — a header (`Queued Messages` + count +
  `Sends after agent finishes working`, caret toggles the list) and one `.chat-queue-row` per message
  with three always-present actions at 0.55 opacity (full on hover/focus): **send now** (arrow →
  `window.api.sendQueuedNow`, aborts the running turn so the message starts immediately), **edit**
  (pencil → loads the text into the composer) and **remove** (trash → `window.api.removeQueued`).
  Alt+Enter in the field is the keyboard path to send-now for the head of the queue. A queued message
  can leave the queue without being sent (removed, sent now, or drained into its own turn);
  `queue-updated` then clears `editTarget` if it pointed at that message, so the composer returns to
  Send/Stop instead of staying in `Save edit` and routing the next Enter to `editQueued` for a
  message that no longer exists (which cleared the field and sent nothing).
- **Tool-call clustering.** Every `tool` item renders inside a `.tool-cluster` group at render time
  (see `ToolCluster.tsx`) — even a lone tool call gets a 1-tool cluster. The cluster is a single
  collapsed summary line (`Read 2 files, ran a command  +12 −3 ›`), not a card, so a long run of tool
  calls costs one line of feed until the user opens it.
  Assistant text with actual content (or images) breaks the run and stays its own bubble. A
  reasoning-only assistant message (thinking between tool calls, no text) does **not** break it: it
  joins the cluster as a `thought` step (dim `thought` badge, italic first-line preview, full text on
  open), so a think → tool → think loop reads as one line instead of alternating rows. Every row of
  the opened list shares one optical type size — mono text (badge, command, `+N −M`, `10/11`) at
  `--fs-mono-scale`, UI text (the thought preview, `running…`, `· N failed`) at `--fs-md` — and one
  fixed line box (`line-height` in `rem`, not a ratio of the row font), so a thought row is exactly as
  tall as a tool row and the list never alternates between a small and a large line. Thoughts that
  never meet a tool stay ordinary bubbles. While the cluster is the newest row of a running turn and
  no tool is pending, its line reads `Thinking…` with the spinner. A step's deltas are pinned to the bubble that step opened
  (`stepBubbleIdRef`), and a `tool-start` flushes the pending rAF buffer before appending its row —
  a step streams reasoning, announces a tool call, then keeps streaming, so without both the tool row
  lands mid-thought and the rest of the SAME thought opens a second bubble after it (one thought
  reading as two, the second one cut). A loose thinking note (a thought that never meets a tool)
  is **chrome-less, like a tool-cluster header**: no box, no fill, no left rule — just a `Thought`
  label, a mono word count, and a trailing caret, so it reads as the same pattern as the
  `Ran a command` line instead of a third row style. The count is words, not tokens — the renderer
  has no tokenizer, and a guessed `≈N tokens` would contradict the real number in the context
  readout. It stays visible when the note opens (a header that reflows on toggle reads as a
  glitch). Empty assistant messages (no text / reasoning / images)
  are dropped entirely from the rendered feed — the agent's loop persists these between tool
  batches (`if (textBuffer || calls.length > 0 || reasoningBuffer)` in
  `src/main/agent/loop.ts`), and without that drop the stored transcript would scatter otherwise-
  consecutive tools across 1-tool clusters on reload. `FeedMessage` already drops them at render,
  so the visible result matches a fresh live session. `content-visibility: auto` is preserved on
  each inner `.tool-call` — clustering changes layout only, not the perf budget.
- **Steps inside a cluster stay collapsed by default** — `ToolCluster` passes `collapseWhileRunning`
  to every inner `ToolCallCard`, so even a `pending` step renders closed. The cluster line
  already names the running step (`Running npm test… 2/3`); a long run of steps that each pop open
  would scatter the feed and defeat the cluster. The user can still click any step to peek.
  A `pending → done` transition re-keys the card so it closes even if the user had clicked it open
  during the run.

### Settings (`components/settings/`)

Full-screen tabbed overlay editing `MeowSettings`. Loads with `getSettings()`, edits a **draft**
through `patch()`, and writes only on Save via `saveSettings(settings)` (which returns the
normalized settings).

| Tab | Edits |
|---|---|
| `ProvidersTab` | Add/connect providers (API key + base URL), fetch models live or from the catalog, hand-enter model ids, "Sync models", default provider, Model Connections (Codex OAuth accounts) |
| `AgentsTab` | Per-agent name, system prompt, provider/model |
| `PermissionsTab` | Per-tool allow / ask / deny |
| `McpTab` | MCP server configs + connection status |
| `ContextTab` | Basic: max steps (empty = unlimited), auto-compact, MCP output max tokens. Advanced (collapsible): buffer / keepTokens / tailTurns / toolOutputMaxChars / maxBytes / maxLines + Notifications. **Empty optional fields mean auto**, and the placeholder shows the auto value for the active agent |
| `CommandsTab` | Slash-command editor ("+ Add command" in the header) |
| `UpdatesTab` | Update channel, check, install |
| `ExternalTab` | External delegation enable, status, config file / CLI paths, copy token (to clipboard, via main) / regenerate token with a confirmation notice, install Claude skill |
| `CliAgentsTab` | Antigravity CLI readiness page, nothing to configure: install + version check on open, *Check again*, *Run test* (one short prompt that proves the sign-in works), install command when `agy` is missing |

| `Modal.tsx` | Reusable modal shell (built on `BaseModal`) |

Adding a setting touches three places: `MeowSettings` in `src/shared/types.ts`, the normalize path in
`src/main/agent/config.ts`, and the tab here.

### Git panel (`components/git/`)

`GitPanel.tsx` is a docked right-hand panel (it joins the same grid as Files, Tasks, Terminal,
Browser and Sub-agents; expanding covers the pane area). It is **read-only**: no staging, commit,
branch switching, compare or blame. The header is the shared `PanelHeader` with two tabs plus a
read-only branch chip and Refresh. The panel polls `gitGetStatusDetail` every 2.5s and reloads the
log only when the status signature (branch, upstream, ahead/behind, changed files) moves — a commit
made by the agent or in a terminal appears on its own, and an unchanged poll never collapses an open
diff or commit. The chip carries the sync state parsed from the status header:
`↑N` (commits not pushed), `↓N` (commits behind the upstream) and a cloud-off icon when the branch has
no upstream, with the full sentence (upstream name, counts, or "not published") in its tooltip.

- `GitChangesView.tsx` — two flat groups (`Staged`, `Changes`) of `status letter + name + dimmed
  directory` rows. A click fetches `gitGetDiff(projectPath, path, staged)` and expands the diff under
  the row; only one row is open. A file with staged and unstaged edits appears in both groups and
  each row shows its own side.
- `GitHistoryView.tsx` — a filter field and a flat commit list (subject, short sha, author, relative
  time, `Load more` in pages of 50). A commit the upstream does not have ends its row with a yellow
  circled up-arrow (`getCommits` marks it from `git rev-list @{upstream}..HEAD`). A click fetches
  `gitGetCommitDiff` and expands the commit's message and changed files (`+/−` counts); clicking a
  file swaps that list for the file's diff with a back row.
- `GitDiffView.tsx` + `parseDiff.ts` — unified-diff parser and the compact hunk renderer (add/del
  tints come from `--git-diff-add` / `--git-diff-del`).

## 9.5 Styling

`src/renderer/src/styles.css` — one file, CSS variables only.

- Root font size 13px; sizes `--fs-xs` 10px … `--fs-lg` 16px.
- `--fs-mono-scale` (0.9) compensates for the mono face reading ~10% larger than the UI face at
  equal px (taller x-height/cap height). Mono that shares a row with UI text multiplies its size by
  it — e.g. `.tool-call-summary` (the tool-call args line) is
  `calc(var(--fs-md) * var(--fs-mono-scale))` so it sits optically level with the thought/prose text
  around it. Pure code surfaces (outputs, diffs, logs) keep their own `--fs-*` size.
- **No left accent bars on cards.** Status never rides on a coloured `border-left` or an inset left
  `box-shadow`: a card's edge stays the same `--hairline` in every state and the state reads from the
  dot, the chip, the icon or a surface tint (the Tasks panel cards are the reference). Do not reintroduce
  the pattern when building or restyling a card list; the older surfaces that still carry one
  (`.tool-call.status-*`, `.subagent`, `.chat-error-card`, `.command-item.selected`) are grandfathered,
  not a template.
- Two hairline weights: `--hairline` (the default 1px edge — card borders, separators) and
  `--hairline-strong` (one step up, for rules that must read as a *deliberate* edge:
  `.theme-card-btn:hover`). A border drawn with an
  undefined token silently computes to `0px`, so a rule that "doesn't show up" is usually a missing
  variable rather than a specificity problem.
- Fonts: `--font-ui` (Segoe UI Variable / system-ui) for all UI text (including tool call headers, chat feed metadata, subagent status badges, prompt option marks, and context popover counts), reserving `--font-mono`
  (JetBrains Mono / Nerd Font) exclusively for code, scripts, outputs, logs, and diffs. `--font-display` aliases
  `--font-ui`: the display fonts were never loaded via `@font-face` (CSP is `'self'` only) and
  silently fell back to mono, which made uppercase labels look like terminal output.
- Spacing on a 4px scale; controls use Tailwind default sizes.
- Radii: `--radius-xs` 3px (`.icon-btn` — the sidebar `+`/`...` and the session title `...` — and the chat context readout), `--radius-sm` 4px, `--radius` 6px (the global
  `*` default), `--radius-lg` 8px.
- Menus share one metric set (tokens in `:root`): `--menu-radius` 10px (container corner),
  `--menu-pad` 6px (container padding), `--menu-item-h` 32px, `--menu-item-pad-x` 10px,
  `--menu-icon` 16px. Rows are **contiguous** (`gap: 0`) and each is `min-height: 32px` with
  `padding: 0 10px`. `.menu-sep` is an inset hairline between groups; `.menu-head` is a muted
  non-interactive context row. A floating menu paints `--bg-menu` — a surface that sits above
  `--bg`/`--bg-chat` in both themes — separates from the page with `--shadow-3`, and draws one faint
  rim: `border: 1px solid var(--menu-border)`, a token a step *below* `--hairline` (white 6% dark /
  black 7% light). The rim is there to give the menu edge definition against whatever it floats over,
  never to read as an outline; `--hairline` was too dark for that job.
- **Selector triggers** carry one shared caret, `.dropdown-caret` (lucide `ChevronDown`, 14px), which
  rotates 180° while its menu is open. Rotation is driven purely by the trigger's
  `[aria-expanded="true"]`, so any new select trigger gets it by setting that attribute (`Dropdown.tsx`
  sets it; `ModelPicker` and `GitBranchSwitcher` set it on their own buttons).
- **Menus anchor to the trigger's edge by default (`BaseDropdown.tsx`) with auto-flip and auto max-height overflow scrolling**. The sidebar rows and the composer's right-hand pickers hug their
  container's right edge, so right-aligning keeps the menu inside it. A trigger at the container's
  *left* edge (the composer's "+" add menu, and the model picker in the card's bottom bar) must align
  the menu's **left** edge instead: right-aligning there pushed the 158px menu 134px outside the
  composer card, over the transcript.
- **A menu that can overflow the pane must be portaled, not absolutely positioned.** `.pane` is
  `overflow: hidden`, so an in-flow menu is cut at the pane's edge — the model picker's 25rem menu
  anchored to a trigger near the card's left edge was sliced off at the sidebar. `ModelPicker` now
  goes through `BaseDropdown` (portal to `document.body`, `position: fixed`, `z-index: 9999`, left
  clamped to the viewport) and `.model-menu` carries only metrics — no `position`/`z-index` of its
  own. Pinned by the "model menu is portaled" case in `tests/e2e/composer.spec.ts`.
- **A selected selector row** is `background: var(--bg-active)` + accent label + a trailing tick, never a
  left accent bar. Rows are `[.menu-item-label][.menu-item-check]`: the label grows and ellipsizes, the
  check column is a fixed `var(--menu-icon)` (16px) and is rendered on **every** row (empty when
  unselected) so labels do not shift when selection moves. The slash-command palette
  (`.command-item.selected`) and the settings nav (`.settings-nav-item`) are not selectors and still use
  the left-bar idiom.
- **Action menus get icons and dividers; pickers get metrics only.** The action menus (project,
  session row, sidebar footer, session title, right-panel file context, Files overlay) lead every item with a 16px
  lucide icon and separate groups with `.menu-sep`. The pickers (mode, variant, model, git branch)
  take the shared metrics but deliberately have no icons or dividers: the model picker is a
  searchable, sectioned list where an icon column is noise. `.command-item` is excluded from the
  family — it stacks a name + description and would clip at 32px.
- **The chat context readout is a button that opens the context panel.** `ContextFooter`'s ring sits in a
  2rem (26px at the 13px root) box with `--radius-xs`, transparent at rest and `--bg-hover` while
  hovered or open (`aria-expanded`), holding a 16px SVG with a 2px stroke. It shares the `.icon-btn`
  *look* but not its class; the click opens a 20rem panel through `BaseDropdown` (`placement="top-end"`,
  portaled to `<body>`), so the breakdown can be tall without being clipped by the composer or the pane.
  The panel opens with the three summary rows (`context` / `tokens` / `cost`, `white-space: nowrap`) and
  then the **breakdown**: a stacked `.context-bar` (one segment per bucket, plus free space) over one row
  per bucket — `System prompt`, `Instructions`, `Memory`, `Memory index`, `Skills`, `Mode`, `Tools`,
  `MCP tools`, `Messages`, `Free space` — each with its token count and share of the window. Rows are
  totals only, with no drill-down: per-tool and per-file detail was removed on request. The numbers are
  estimates (`estimateTokens`, 3.5 chars/token, the compaction measure) while the header count is the
  provider-reported usage; the bar is scaled so the estimated buckets fill exactly the used span and
  free space closes it at the window limit. Colours come from the
  `--ctx-system` / `--ctx-tools` / `--ctx-mcp` / `--ctx-messages` / `--ctx-free` tokens (dark + light).
  The panel refreshes when it opens, so the breakdown reflects the transcript as it is now.
- **The composer is one card, so its controls live in a bar, not in a toolbar row beside the field.**
  `.chat-input` is a column: edit banner, chips, the field, then `.chat-input-bar` (add menu, model
  picker, right group with variant picker + the round send/stop button). The mascot is positioned
  against the card's top border rather than laid out in that column, so the send button stays the
  card's trailing element. The field's `max-height` is
  `calc(8 * 1.5rem + 0.916667rem)` — 8 line boxes plus the field's own vertical padding — so the
  8-line cap stays exactly the field box at any root font size. The bar-scoped picker overrides keep
  the triggers quiet inside the card (smaller type, no pill background at rest). The footer under the
  card carries project + branch on the left and the context ring + `ModePicker` on the right.
- **The composer mascot is decoration with a mood, not a control.** `MeowPet.tsx` renders the logo's
  cat head (the logo path with softened ear tips and the ears pulled out toward the sides) at 36px in
  the **Calico** colourway — cream body, charcoal patch over the left ear, orange patch over the
  right, blue eyes and an orange-brown mouth — perched on the input card's top border 7.5rem in from
  the right edge (`.meow-pet--edge`: absolute, `bottom: calc(100% - 0.166667rem)`, so the feet land on
  the hairline and the shadow falls on the card). The horizontal inset is load-bearing: the
  queued-messages card sits right above the input card, and its send-now / edit / remove block is
  ~6.2rem wide at the row's trailing edge — a pet anywhere over that block swallowed the clicks
  (`composer.spec.ts` failed on `.chat-queue-action.edit`). At 7.5rem the pet clears every control and
  only ever covers the tail of a long queued message, which is text, not a target. Every colour is a
  custom property on `.meow-pet` (`--meow-shell-1..3`, `--meow-rim`, `--meow-eye`, `--meow-mouth`,
  `--meow-patch-dark`, `--meow-patch-warm`, `--meow-foot`), so another colourway is a one-block change
  and the light theme can override the rim without touching the SVG. It is `aria-hidden`,
  never focusable, and has no hit area outside its own 36px box. Nine moods, driven by `ChatPanel`
  and by the pet's own idle clock: `idle` at rest; `look` on hover; `think` while a turn is running
  but has not produced its first token, `type` once it streams (the panel flips a `turnOutput` flag
  once per turn, not per delta); `sleep` after 45 s with no activity — typing, hovering, clicking or a
  new turn wakes it; `happy` when a turn finishes or the pet is clicked (hearts burst); `notify` when a
  permission/question prompt arrives, or when a turn lands while the window is in the background;
  `error` when a turn fails (shake + red halo); `drag` while the pointer is down (squashed, and a press
  that slides away is not a click). A user Stop is not an outcome and leaves the mood alone. One-shots
  revert to the resting mood, so the pet cannot get stuck celebrating. `walk` / `run` from the design
  mockup are the only ones left out — a small pet on a border has nowhere to walk. It costs no layout:
  it is absolutely positioned, so the card's height is unchanged; it hangs 34px above the border, and
  the composer's top padding plus the feed's bottom padding absorb most of that.

- **The chat surfaces share one centered lane (`--chat-lane-w`, 64rem = 768px).** Transcript (the todo card
  and prompt popup included — they are the feed's last rows), input card and composer footer all sit on the same
  centered column, ChatGPT/Claude style. The width lives in the token; the side inset is derived once on `.chat-panel` as
  `--chat-inset: max(1.166667rem, calc((100% - var(--chat-lane-w)) / 2))` — the `max()` makes the base
  14px padding win on a pane narrower than the lane, so the lane shrinks with the pane. The composer
  spans the full width and takes the inset as padding / margin (its background and border
  still reach the panel edge). **The feed is the exception**: it also spans the full panel so its
  scrollbar stays on the panel edge (never pulled inside the lane), and it reserves the scrollbar gutter
  on both sides (`scrollbar-gutter: stable both-edges`, size from `--scrollbar-w`) while taking
  `calc(var(--chat-inset) - var(--scrollbar-w))` as its own padding. Without that compensation the
  transcript rows end a scrollbar width short of the input card, because the inset is measured from the
  border box, which includes the gutter; `both-edges` (not one-sided `stable`) is what keeps the lane
  centered rather than shifted left by the gutter. Pinned by `tests/e2e/chat-lane.spec.ts`.
- **The jump-to-end button floats above the feed on its own token, `--bg-elevated`.** It has to be
  *brighter* than the feed in **both** themes, which no existing surface token provides: `--bg-raised`
  is the card grey, and `--bg-active` means "selected", so it goes *darker* toward the light theme
  (`#e8e8e8` → `#d4d4d4`) — hard-coding it left the button a dark grey chip on the white feed. Dark:
  `#383842` at rest / `#484854` on hover; light: `#f7f7f7` / `#ffffff`. Its label follows the theme via
  `--text-strong`, never a literal `#fff`: white text over the white light-theme hover made the label
  disappear on hover.
- Numeric displays use tabular-nums.
- UI labels are English.

### The `border-radius` trap

`styles.css` contains a **global `* { border-radius: var(--radius) }`** rule. It rounds *every*
element unless explicitly overridden. To make a screen square-cornered, do **not** set
`border-radius: 0` rule by rule — you will miss some (tab, panel, cell). Use this pattern:

```css
.git-panel * { border-radius: 0; }                           /* square everything */
.git-panel .btn,
.git-panel .icon-btn { border-radius: var(--radius-sm); }  /* re-round only what needs it */
```

Before editing, check whether the element is being rounded by the `*` rule
(`grep "border-radius"` and trace the class). Do not assume.

**Icon-only buttons.** `.icon-btn` (fixed 24 × 24, `--radius-xs`) is the one class for every
icon-only button — the sidebar's project `+` / `...` and session-row `...` (`Sidebar.tsx`) and the
session title's `...` (`SessionTitle.tsx`). Its geometry must live on that class: composing `.btn small`
and overriding the padding from a container rule does not work — `.project-actions .btn` and
`.btn.small` are both `(0,2,0)`, so source order decides, and the override lost. The sidebar buttons
render 34 × 25 with the `.btn` 6px radius until `.icon-btn` replaced them, and the old pane header
button measured 31 × 21 with the same 6px radius for the same reason.

**CRLF note:** `styles.css` and the test files use CRLF line endings, which can make exact-match
string edits fail. Edit them with a script (e.g. python) if the edit tool cannot match.

## 9.6 Theming

- Dark is the default and mirrors VS Code's **One Dark Pro Darker** (Atom One Dark): `#1e2227`
  chrome (`--bg`, `--bg-panel`, `--bg-sidebar`, `--bg-tab-inactive`) around a `#23272e` work area
  (`--bg-chat` — the chat, the panes and the title bar, plus `--terminal-bg`), with cards and floating
  menus a step above it (`--bg-raised`, `--bg-menu`: `#2c313a`), `--bg-hover` `#323842`, `--bg-active`
  `#3a4150`, `--bg-code` `#1d1f23`, `#bec5d2` text (`--text`/`--chat-text`; `--text-strong` `#e6e9ef`, `--text-dim` `#b0b8c6`, `--text-faint` `#9198a3` — one step lighter than Atom One Dark so body text does not read as dim). The accent is One Dark's blue: `--accent`
  (`#4d78cc`) is the fill under white text (user bubble, primary button), `--accent-hover`
  (`#3f66b0`) its hover/pressed fill and `--accent-strong` (`#61afef`) the link/edge blue. Semantic
  hues follow One Dark's syntax palette (green `#98c379`, yellow `#e5c07b`, orange `#d19a66`, red
  `#e06c75`). Light mode is a full token override under `[data-theme="light"]` on `<html>` using the
  VSCode Light+ palette.
- The choice persists in `localStorage` under `meow.theme`; the toggle lives in the Sidebar footer
  menu (Sun/Moon).
- `applyTheme(theme?)` sets `data-theme` **and** calls `window.api.setTitleBarTheme(resolved)` so the
  Windows `titleBarOverlay` min/max/close buttons follow the app theme (without this they stay dark
  in light mode). The bar itself paints `var(--bg-chat)` — the same surface as that overlay strip (see [11.5](11-conventions-and-pitfalls.md) for the subpixel seam behind this).
- `watchTheme()` listens for `storage` events, which fire across same-origin windows — this is how
  the File viewer popup re-themes when the main window toggles.
- App-wide font size persists in `localStorage` under `meow.fontSize` (default 13, range 8–40px,
  integer). `applyFontSize()` in `font.ts` sets `font-size` on `<html>`/`<body>`; `watchFontSize()`
  re-applies on `storage` events across same-origin popups. The control lives in the
  Settings → Personalize tab.

## 9.7 Performance rules

These come from a real, measured chat-input lag investigation (Chromium trace via CDP — not
guesswork). Treat them as requirements, not suggestions.

1. **Limit animations on frequently-updating elements.** Animations run on the UI thread; combined
   with dense re-renders (token streaming, continuous keystrokes) they cause visible jank. Use
   instant `scrollIntoView()` for streaming; reserve smooth scroll for discrete one-off actions.
2. **Long lists need `content-visibility: auto`** on each row (`.chat-msg`, `.tool-call`) plus an
   estimated `contain-intrinsic-size`. Measured: a project with ~250 items / ~3000 DOM nodes made
   *every* keystroke in the chat box trigger a full-page layout (~39ms) — the browser needs a
   synchronous layout to position the caret (`TypingCommand::InsertText`), and that layout spans the
   whole DOM including off-screen content. Adding this cut it ~6–7× (39ms → 5.7ms/keystroke).
3. **The chat input is uncontrolled (ref), not controlled.** `setState` on every keystroke forces a
   re-render even when the value affects nothing else. Read `e.target.value` via ref; only
   `setState` when a derived value actually changes (e.g. opening the `/` menu), and return the same
   object reference when nothing changed so React skips the render.
4. **Callbacks passed to `memo()`ed components must be stable** (`useCallback` with correct deps).
   Otherwise any parent re-render — including the 5-second git-status poll — cascades through the
   whole subtree. Row components should take primitive props, not objects whose reference changes
   every render.
5. **Measure before optimizing.** `requestAnimationFrame` is not free. An attempt to move a cheap
   string comparison out of the input handler via rAF made things *slower*, because rAF is a real
   browser API call. Use a CPU profile / Chromium trace or the Event Timing API
   (`processingStart` / `processingEnd`) before and after.

## 9.8 Testing the renderer

Renderer modules do have unit tests — pure helpers and components rendered with `react-dom/server`
(there is no jsdom), e.g. `session-panes.test.ts` and `session-guard.test.ts`. Coverage mostly comes from:

- `npm run typecheck` (which includes `tsconfig.web.json`)
- Playwright e2e (`npm run build && npm run e2e`), which launches the real app:
  `smoke.spec.ts`, `prompt.spec.ts`, `composer.spec.ts`, `context-footer.spec.ts`,
  `chat-scrollbar.spec.ts`, `chat-lane.spec.ts`, `sidebar-sessions.spec.ts`, `selectors.spec.ts`,
  `menus.spec.ts`

`playwright.config.ts` deletes `ELECTRON_RENDERER_URL` / `NODE_ENV_ELECTRON_VITE` at load time. The dev
app exports them to every process it spawns, and a shell started from inside it inherits both; with a
leaked value `src/main/index.ts` loads the renderer from the vite dev server and the suite renders the
current `src/` instead of the built `out/` — every assertion would silently test the wrong tree.

After touching IPC or UI, add or extend a smoke assertion so the regression is caught there.
