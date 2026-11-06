# 09 — UI Guide (Renderer)

React 19 + TypeScript, no UI framework, no CSS-in-JS. All data flows through `window.api`
(typed `AgentApi`). **Never import `electron` or `node:*` in the renderer.**

## 9.1 Entry point and window routing

`src/renderer/src/main.tsx` routes by query string — the same bundle serves three window types:

| Condition | Renders |
|---|---|
| `window.api` missing | A fallback telling the user preload did not load |
| `?file=<path>&root=<dir>` | `<FileViewer>` in a popup `BrowserWindow` |
| `?git=<projectPath>` | `<GitViewer>` in a popup `BrowserWindow` |
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
│ work-  │  │ PaneHeader                                             │ │
│ spaces │  │ ChatPanel (active session)                             │ │
│        │  │                                                        │ │
│ theme  │  └────────────────────────────────────────────────────────┘ │
├────────┴─────────────────────────────────────────────────────────────┤
│ StatusBar (workspace · git branch · running count · app version)     │
└──────────────────────────────────────────────────────────────────────┘
```

Overlays: `SettingsDialog` (centered modal size xl tabbed),
`BrowserDialog`, `InstallGuideDialog`, `UpdateDialog`, `BackgroundPanel`, `FileContextMenu`.

### Files overlay

A pane's `⋮` menu offers **Files**, which opens an in-app explorer docked on the right of the pane area — the
slot the old right panel used (never an OS window, so the title bar, sidebar and status bar stay visible). It
holds a filterable, lazily loaded directory tree on the left — dotfiles and `node_modules` are listed — and
open files in tabs on the right, next to a header with focus-filter, `⋮` (Refresh, Collapse all, Close all
tabs, Copy path, Reveal in Folder, Open in VS Code), maximize/restore and close. Typing in the filter narrows
the tree by name; a `?` prefix searches file contents instead and lists `path:line` hits. Docked, the panel is
resizable by its left edge (320–900px, default 420px, persisted in `localStorage` as `meow.files.width`); `⤢`
expands it over the whole pane area and restore docks it again — the tree, tabs and open files survive both
directions. The panel is a bordered, rounded card (`--hairline` + `--radius-lg`) in both modes, sitting a 4px
gap away from the pane edges (all four sides when docked) so the radius is never clipped; that gap is painted
with the chat surface (`--bg-chat`), not body's radial gradient, so the panel is framed like the chat pane. `Esc` and `✕` close it, and switching to another project closes it.

The previous `RightPanel` (directory tree + artifacts) is parked in the source — its components, CSS, state and
the artifact store/IPC remain, but nothing renders it.

### Processes overlay

A pane's `⋮` menu offers **Processes**, which opens a per-session overlay for that pane's agent, mirroring the
Files overlay's docking: docked on the right of the pane area with a drag-to-resize left edge (320–900px,
default 420px, persisted in `localStorage` as `meow.processes.width`), `⤢` expands it over the whole pane area,
`Esc`/`✕` closes it, and switching projects closes it. It lists the agent's **background shells** (`bash
run_in_background`) and **monitors** on the left — each shell row shows a status dot, the command, its exit code
when exited, and a **Kill** button for running shells; each monitor row shows the target shell id and the `until`
condition summary. Selecting a shell streams its output live in the right column (the store's buffer plus
`data`/`exit` events, never consuming the agent's `bash_output` read offset). The lists poll
`backgroundProcsList`/`monitorsList` every ~1.5s while open; output streaming is subscription-based
(`backgroundProcSubscribe`/`unsubscribe` + `onBackgroundProcData`/`onBackgroundProcExit`) and only shells the
panel is watching are forwarded to the renderer.

### Session terminal panel

The session terminal is a right-hand panel (`TerminalOverlay`) hosting interactive shell tabs powered by xterm.js (`TerminalView`) and dedicated `PtyManager` processes in the main process.
- **Toggle & shortcut**: Toggled via `Ctrl+\`` (`Cmd+\`` on macOS) in the active pane or the Terminal button in `PaneHeader`. `App` owns `terminalOpenFor` (the session the panel shows, or `null`) and `terminalFull`; toggling from another session switches the panel to that session. It is not persisted.
- **Layout**: Uses the Files panel chrome — `.files-overlay` card, `.files-head` title bar (`TERMINAL`, Restart when the selected tab exited, `+` new terminal, expand/restore, close) and `.files-tabs` / `.files-tab` chip tabs with a status dot, exit code, double-click rename and close. Docked, it joins the shared `.right-panels-grid` next to Files, Processes and Subagent panels (auto rows/columns, shared resizer); expanded (`full`), it overlays the whole pane area like Files. The chat keeps its full height.
- **Mount gating**: Only one terminal panel exists and its xterm is created only for the selected tab, so hidden sessions never allocate xterm instances. Removing the session closes the panel.
- **Context menu & clipboard**: Right-clicking the terminal view opens a context menu with Copy, Paste, Clear Buffer, and "Send Selection to Chat". "Send Selection to Chat" dispatches a `meow:composer-insert` custom window event containing the formatted selection (```text ... ```), which `ChatInput.tsx` listens for and appends to the composer.
- **Always dark**: The terminal ignores the app theme. Its colors come from `--terminal-bg` / `--terminal-fg` (defined once on `:root`, never overridden by `[data-theme="light"]`) plus `--font-mono`, read once when the xterm is created. `styles.css` paints `.terminal-overlay-body`, `.xterm` and `.xterm-viewport` with `--terminal-bg`, because `xterm.css` paints the viewport `#000` and it shows below the last row.

## 9.3 `App.tsx` — the state hub

Owns: workspaces, the mounted `WorkspaceRuntime`s (one per kept-alive project),
background flags, browser status, update status, sidebar collapsed state (`sidebarCollapsed`), parked
right-panel state, artifacts, the Files panel state (`filesOpenFor` — closed by default, closed on project
switch; `filesFull` — docked by default; `filesWidth` — docked width, persisted in `localStorage`), and the active
session per project (`activeSessionByPath`).

```ts
export interface PaneModel { agent: AgentConfig; state: AgentState; git: GitStatus | null }
```

`runtimesRef` mirrors the mounted runtimes, `activePathRef` the active project and `orderRef` the
keep-alive order, so the mount-once event subscriptions and the callbacks they invoke never read a
stale value.

Event subscriptions set up in `App`: `onAgentState`, `onGitStatus`,
`onAgentBackground`, `onAgentConfig`, `onBrowserStatus`, `onBrowserOpenInstallGuide`,
`onUpdaterStatus`, `onArtifactsChanged`. Every one returns an unsubscribe function
that must be called in the effect cleanup. (The Processes overlay subscribes to
`onBackgroundProcData`/`onBackgroundProcExit` itself, per selected shell, so the app hub does not.)

## 9.3.1 `App.tsx` — the Processes overlay state

Mirrors the Files overlay but keyed by **agent id** (from the pane's `⋮` menu), not project
path: `processesOpenFor` (agentId — closed by default, closed on project switch),
`processesFull` (docked by default) and `processesWidth` (docked width, persisted in
`localStorage`). Both this overlay and the Files one render in one of two places, chosen by their
`full` flag: the docked instance shares the right-side grid container next to the panes, while the
expanded one is a direct child of `.main` so its absolute insets resolve against the pane area and it
covers the chat pane. Nesting the expanded panel inside the grid container would confine it to the
docked column (the container is `position: relative` for its resizer).

Update-dialog policy: `update-available` and `downloaded` open the dialog **only for a manual check**
(`manualCheckRef`); `error` and `not-supported` close it; `up-to-date` only opens a dialog when the
check was manual, so the automatic startup check never pops anything. The download itself is
automatic (no click needed) and the install is silent on quit — the dialog's "Update & Restart" /
"Restart now" only brings that moment forward, and while a background download is running the dialog
is dismissible (no install button, "Later" only).

## 9.4 Component inventory

### Shell

| Component | Responsibility |
|---|---|
| `TitleBar.tsx` | Custom window chrome for frameless platforms; when collapsed, hovering the title bar brand region reveals a floating full sidebar popover dropdown menu. |
| `PopupTitleBar.tsx` | Same for the FileViewer/GitViewer popups (drag region + Linux min/max/close) |
| `Sidebar.tsx` | Project list; header action bar features a vertical 2-row menu with "New session" (`Plus` icon) and "Add folder" (`FolderPlus` icon) full-width menu items without border radius or bottom border. Each project row is a lightweight group header — the project name (bright on the current project, dim otherwise) followed by a **trailing** expand/collapse chevron, with the `+` (new session) and `...` (project menu) icons revealed on hover / while the project is current. The project path lives on the row's `title`: there is no path line and no session count. An expanded project lists its **sessions**, indented: a status ring (green = running, yellow = waiting on input, hollow ring = idle), the name, and a trailing `...` menu that appears on hover / when active. The active session is a full-width rounded pill. The per-row `...` menu holds Rename (via inline input), Stop (when running) and Delete. The project `...` menu holds Open, Open in VS Code, Git, Open Folder, Open Terminal (a real OS terminal window via `openSystemTerminal`) and Remove. The `+` button activates a draft session; deleting a project's last session transitions the workspace to a draft session pane — creating a backend session is deferred until the user sends their first message. Expanded state persists in `localStorage` (`meow.sidebar.expanded`). Also: Providers entry and theme toggle in the footer menu. Projects with sessions waiting on a permission/question prompt show a red count badge (and a dot on the collapsed-rail avatar) |
| `StatusBar.tsx` | Workspace name, git branch, running count, app version |
| `SessionPanes.tsx` | Session layout of one project: **every session stays mounted** (inactive ones carry the `hidden` attribute, hidden by CSS and never unmounted) so a session that is not showing keeps streaming/answering. The active session is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the session that was showing); it reports the first session when the stored id no longer exists |
| `Pane.tsx` | One session: header + `ChatPanel`; background badge mode |
| `PaneHeader.tsx` | Status dot (which carries the status as its accessible name — `role="img"` + the status label, with any exit code folded in), the session name, the menu (inject / log / stop / restart / background / Files / Processes / delete — inject/log/stop/restart exist only on the parked PTY path; a native session's lifecycle lives in its sidebar row; Files opens the Files overlay, Processes opens the Processes overlay). The `...` button is the shared `.icon-btn`. No status word (the dot already shows it) and no git readout (the status bar owns branch + dirty count) |
| `EmptyState.tsx` | No-pane hint (differs for "no workspace" vs "workspace open") |
| `BackgroundPanel.tsx` | Background agents; open/stop |
| `RightPanel.tsx` | Resizable panel with a fixed header; **both tabs stay mounted** for instant switching (**parked** — nothing renders it since the Files panel took its slot) |
| `RightPanelTree.tsx` | Lazy directory tree; auto-expands the project root; background refresh (**parked**) |
| `RightPanelArtifacts.tsx` | `.md` files agents created/edited (**parked**) |
| `FileViewer.tsx` | Popup file viewer: `PopupTitleBar` + the shared `file-content/FileContentView.tsx` |
| `file-content/FileContentView.tsx` | Toolbar (Raw/Highlighted toggle, Open in VS Code, Copy) + body of a file (Shiki-highlighted code, rendered markdown, or plain `<pre>`), shared by the popup window and the Files overlay tab |
| `files/FilesOverlay.tsx` | The Files panel: header (focus filter, `⋮` menu, maximize/restore, close), tree side (drag the `.files-side-resizer` splitter on its right edge to resize it, ≥ `FILES_SIDE_MIN_WIDTH` 160px while leaving the editor ≥ `FILES_MAIN_MIN_WIDTH` 160px; the width persists in `localStorage` `meow.files.sideWidth` and applies to both modes, double-click resets to the CSS default of 42% docked / 20rem expanded), open-file tabs and the active tab's `FileContentView`; docked on the right with a drag-to-resize left edge, or expanded over the pane area (same mounted instance, so tabs/tree survive the toggle). Both modes are elevated by `--shadow-panel`, whose blur is tuned to fade out inside the panel's 0.333333rem offset from `.main` (expanded mode layers it on top of the `--bg-chat` backdrop ring that hides the pane chrome) |
| `files/FilesTree.tsx` | Lazily loaded tree of the overlay; lists dotfiles and `node_modules`; `?`-prefixed filter searches file contents and lists `path:line` hits; refreshes on context changes |
| `processes/ProcessesOverlay.tsx` | The Processes overlay (`ProcessesOverlay` default export + `PROCESSES_MIN_WIDTH`/`MAX`/`DEFAULT`): per-agent background shells + monitors list on the left (Kill button on running shells), live streamed output of the selected shell on the right; reuses the Files overlay's `.files-overlay` layout and CSS variables with `processes-*` classes |
| `files/file-path.ts` | `baseName` / `joinProjectPath` — renderer-side path helpers (the renderer must not import `node:path`) |
| `files/tree-filter.ts` | `filterTree` — name filter over already-loaded directories, keeping the ancestor chain of every match |
| `FileContextMenu.tsx` | Context menu for tree/artifact entries and the Files overlay (Copy path when `showCopyPath`) |

### Terminal (`components/terminal/`)

| Component | Responsibility |
|---|---|
| `TerminalOverlay.tsx` | Right-hand session terminal panel (Files panel chrome, joins the right-panels grid): tab list, tab renames, new tab (`+`), close tab (`×`), restart exited tab, expand/restore, close. |
| `TerminalView.tsx` | Individual xterm.js instance: fit addon, IPC data/resize/exit event subscriptions, always-dark `--terminal-*` theme, right-click context menu (Copy, Paste, Clear, Send to Chat via `meow:composer-insert`). |

### Dialogs

`AddProjectDialog`, `UpdateDialog`, `BrowserDialog` (bridge status + extension approval),
`InstallGuideDialog` (extension install steps).

### Chat (`components/chat/`)

| Component | Responsibility |
|---|---|
| `ChatPanel.tsx` | The container: subscribes to chat events, owns feed state (items / todos / queue / pendingPrompt), rAF-batches stream deltas, and merges transcript loads with live rows by stable id. Tool start/result events upsert the same row, and a result recreates a missing start row, so an in-flight transcript-load race cannot hide tool output. At render time the feed map folds **every** `tool` item into a `cluster` row via `clusterToolRows` (a pure helper that walks `items`) — so the agent's back-to-back tool bursts read as one tight group, and even a lone tool call renders as a 1-tool cluster with the same chrome. The helper also drops empty assistant messages (no text / reasoning / images) entirely from the feed; the agent's loop persists these between tool batches, so without that drop otherwise-consecutive tools would scatter across 1-tool clusters on reload. State stays flat, so paging and live upserts are unchanged. Renders feed (`FeedMessage` with hover copy action bar for assistant messages) + composer + context footer. The todo list is a feed row (`TodoCard`) rendered after the transcript rows and right above the pending prompt, so it scrolls with the feed (not sticky): a neutral hairline card headed `Tasks` + `done/total`, one row per todo with a status mark (check / spinner / circle / x); the in-progress task spins and pulses (off under `prefers-reduced-motion`). The header toggles it collapsed, where it keeps naming the active task. It disappears when the list is empty. An incoming delegated message renders as a user bubble with a `delegation` badge and a `From session: <name>` label (`.chat-delegation-label`); the metadata travels on `FeedItem`/`toFeedItem` so a reload reproduces it, and `direction: 'result'` rows stay unlabelled. The permission/question prompt with type badge tag is the **last row of the chat feed** (the meow-chatui `PromptCard` placement), not a composer child: it scrolls with the transcript it interrupts, and a prompt that arrives while the user is reading history is scrolled into view, since the agent stays blocked until it is answered. Answering a `question` prompt also lands the answer in the feed as a user bubble (the loop's `user-message` event, right after the tool row), so the transcript reads as a conversation. The composer is two stacked blocks — the **queued-messages card** (`.chat-queue`, rendered only while the queue is non-empty: a header with the count and a caret that collapses it, then one row per message with always-present send-now / edit / remove actions) directly above the **input card** (`ChatInput`) — plus a one-line **footer** (`chat-footer-project-group` on the left: project folder name and a git branch chip that opens the Git view; `chat-footer-controls` on the right: context readout + `ModePicker`). Memoized. |
| `ChatInput.tsx` | Composer, **one rounded card** with everything inside it: an optional edit banner (`.chat-input-editing`), image/mention chips, the auto-growing field (`rows=1`, `field-sizing: content`, capped at 8 lines and then scrolling) and, on its own bottom row (`chat-input-bar`), the `+` add menu, the model picker, then the right group — variant picker + one round 2.25rem button: Send (arrow) at rest, disabled while empty, Stop while a turn runs, and Send again (check, `Save edit`) while a queued message is edited. Enter sends, Shift+Enter inserts a newline, Esc cancels an edit when no menu is open, and Alt+Enter sends the head of the queue now. Placeholder: `Ask anything, @ to mention, / for actions`, or `Processing...` while running. Paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, `/` command menu, edit-queued flow. Leaving edit mode without saving (the queued message was removed, or it drained into its own turn) drops the text that edit loaded into the field — the field is uncontrolled, so otherwise that text would sit there and a later Enter would submit it as a brand-new message; anything the user typed after it stays. Memoized, **uncontrolled**. |
| `useChatScroll.ts` | Feed scroll controller: follow / anchored / manual modes, turn-top anchoring, jump-to-end button. Detach is gesture-driven: only wheel, touch, keyboard nav, or a scrollbar drag leaves follow mode — a `scroll` event observed off the bottom while the DOM itself grows (streamed deltas, `content-visibility` rows resolving their height, history paging) must NOT detach it, so `scrollEventAction()` classifies each scroll event into none/follow/detach instead of trusting the position alone. After the user scrolls away (manual mode) following only resumes at the literal bottom — re-arming from the loose 80px follow zone would make a slight upward nudge on a long, still-streaming turn snap the viewport back down next delta (up/down jitter). Pure geometry helpers live in `chat-scroll-geometry.ts`. |
| `ToolCallCard.tsx` | One tool call in a compact micro-bar layout (badge, file/command summary, status hairline, expandable diff/output body). Memoized. When `collapseWhileRunning` is true (set by `ToolCluster`), the card never auto-opens — even while the call is `pending` — so a long run of tool steps stays collapsed. Edit-style calls (`edit`, `write`, `apply-patch`) show their `+N −M` line counts (from `diffStats`) in the header. Inside a cluster a step renders as a plain list row (no coloured left rule, no caret, lowercase badge; the ✓/✗ carries status), and a bash row drops the leading `cd <dir> &&` (`stripCdPrefix`; the hover title keeps the full command). |
| `ToolCluster.tsx` | **Every** tool call renders inside a cluster, even lone ones. Takes `steps` (`ClusterStep`: a tool call or a `thought` — reasoning-only messages between the calls render as quiet `thought` rows in the list) and `live` (newest row of a running turn: with no step pending the line reads `Thinking…`). A run of consecutive tool calls folds into one Claude-style line, **collapsed by default** and without card chrome: a summary of what the run did built by `toolSummary.ts` (`summarizeCalls`, e.g. `Read 2 files, edited a.ts, ran a command`), the run's `+N −M` line counts (`diffStats`), a red `· N failed` when a step was denied or errored, and a trailing caret. While a step is `pending` the line instead names that step with a spinner and progress (`Running npm test… 2/3`, via `describeRunning`). Opening it shows the inner `.tool-call` cards in one framed list, stacked with a 1px hairline between them. Always passes `collapseWhileRunning` to every inner `ToolCallCard` so clustered steps stay collapsed even while running (the cluster header already shows progress). Inner rows keep their own expand toggle, so the user can still drill into one tool by clicking it. Clustering happens at render time inside `ChatPanel.tsx`. |
| `toolSummary.ts` | Pure helpers for the cluster line: `summarizeCalls` (groups calls by kind in first-seen order, names a single file by basename), `describeRunning` (present-progressive label for the active step), `stripCdPrefix`, `diffStats` (lines added/removed by edit/write/apply-patch; an edit's shared leading/trailing lines are context, denied/failed calls count nothing). |
| `DiffView.tsx` | Inline diff for edit-style tool calls |
| `MarkdownText.tsx` | `marked` + `DOMPurify.sanitize` |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs table pipes before rendering |
| `markdownPaths.ts` | Turns file paths in markdown into clickable `openFile` links |
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
  open), so a think → tool → think loop reads as one line instead of alternating rows. Thoughts that
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
| `Modal.tsx` | Reusable modal shell (built on `BaseModal`) |

Adding a setting touches three places: `MeowSettings` in `src/shared/types.ts`, the normalize path in
`src/main/agent/config.ts`, and the tab here.

### Git viewer (`components/git/`)

`GitViewer.tsx` hosts tabs: `GitChangesTab`, `GitDiffView`, `GitHistoryTab`, `GitBlameTab`, plus
`GitFileTree` and `GitBranchSwitcher`. `parseDiff.ts` parses unified diffs for rendering. It runs in
its own `BrowserWindow` opened by `Channels.GitOpenViewer`.

## 9.5 Styling

`src/renderer/src/styles.css` — one file, CSS variables only.

- Root font size 13px; sizes `--fs-xs` 10px … `--fs-lg` 16px.
- `--fs-mono-scale` (0.9) compensates for the mono face reading ~10% larger than the UI face at
  equal px (taller x-height/cap height). Mono that shares a row with UI text multiplies its size by
  it — e.g. `.tool-call-summary` (the tool-call args line) is
  `calc(var(--fs-md) * var(--fs-mono-scale))` so it sits optically level with the thought/prose text
  around it. Pure code surfaces (outputs, diffs, logs) keep their own `--fs-*` size.
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
- Radii: `--radius-xs` 3px (`.icon-btn` — the sidebar `+`/`...` and the pane header `...` — and the chat context readout), `--radius-sm` 4px, `--radius` 6px (the global
  `*` default), `--radius-lg` 8px.
- Menus share one metric set (tokens in `:root`): `--menu-radius` 10px (container corner),
  `--menu-pad` 6px (container padding), `--menu-item-h` 32px, `--menu-item-pad-x` 10px,
  `--menu-icon` 16px. Rows are **contiguous** (`gap: 0`) and each is `min-height: 32px` with
  `padding: 0 10px`. `.menu-sep` is an inset hairline between groups; `.menu-head` is a muted
  non-interactive context row.
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
  session row, sidebar footer, pane header, right-panel file context, Files overlay) lead every item with a 16px
  lucide icon and separate groups with `.menu-sep`. The pickers (mode, variant, model, git branch)
  take the shared metrics but deliberately have no icons or dividers: the model picker is a
  searchable, sectioned list where an icon column is noise. `.command-item` is excluded from the
  family — it stacks a name + description and would clip at 32px.
- **The chat context readout is an icon button.** `ContextFooter`'s ring sits in a 24 × 24 box with
  `--radius-xs`, transparent at rest and `--bg-hover` while `.context-footer-wrap` is hovered, holding
  a 20px SVG with a 2.5px stroke (the ratio of the original 30px / 3px ring). It shares the
  `.icon-btn` *look* but not its class: the readout sits in a container that owns its hover, and it is
  deliberately not clickable (`cursor: default`, no tabindex).
  Its hover popover is content-width by contract: `width: max-content` with a `min-width: 216px` floor
  (200px before) and `white-space: nowrap` rows. With short values the floor decides the box — measured
  exactly 200px, which is why the floor is a real, testable change — and the explicit `max-content`
  keeps the width from depending on shrink-to-fit resolution for `position: absolute; right: 0`.
- **The composer is one card, so its controls live in a bar, not in a toolbar row beside the field.**
  `.chat-input` is a column: edit banner, chips, the field, then `.chat-input-bar` (add menu, model
  picker, right group with variant picker + the round send/stop button). The field's `max-height` is
  `calc(8 * 1.5rem + 0.916667rem)` — 8 line boxes plus the field's own vertical padding — so the
  8-line cap stays exactly the field box at any root font size. The bar-scoped picker overrides keep
  the triggers quiet inside the card (smaller type, no pill background at rest). The footer under the
  card carries project + branch on the left and the context ring + `ModePicker` on the right.
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
.git-viewer * { border-radius: 0; }                              /* square everything */
.git-viewer .btn,
.git-viewer .git-header-btn { border-radius: var(--radius-sm); } /* re-round only what needs it */
```

Before editing, check whether the element is being rounded by the `*` rule
(`grep "border-radius"` and trace the class). Do not assume.

**Icon-only buttons.** `.icon-btn` (fixed 24 × 24, `--radius-xs`) is the one class for every
icon-only button — the sidebar's project `+` / `...` and session-row `...` (`Sidebar.tsx`) and the
pane header's `...` (`PaneHeader.tsx`). Its geometry must live on that class: composing `.btn small`
and overriding the padding from a container rule does not work — `.project-actions .btn` and
`.btn.small` are both `(0,2,0)`, so source order decides, and the override lost. The sidebar buttons
render 34 × 25 with the `.btn` 6px radius until `.icon-btn` replaced them, and the pane header
button measured 31 × 21 with the same 6px radius for the same reason.

**CRLF note:** `styles.css` and the test files use CRLF line endings, which can make exact-match
string edits fail. Edit them with a script (e.g. python) if the edit tool cannot match.

## 9.6 Theming

- Dark is the default (`--bg: #0a0a0b`, near-black, VSCode-Dark+-derived with a `#007acc` accent
  family). Light mode is a full token override under `[data-theme="light"]` on `<html>` using the
  VSCode Light+ palette.
- The choice persists in `localStorage` under `meow.theme`; the toggle lives in the Sidebar footer
  menu (Sun/Moon).
- `applyTheme(theme?)` sets `data-theme` **and** calls `window.api.setTitleBarTheme(resolved)` so the
  Windows `titleBarOverlay` min/max/close buttons follow the app theme (without this they stay dark
  in light mode). The bar itself paints `var(--bg)` — the same surface as that overlay strip (see [11.5](11-conventions-and-pitfalls.md) for the subpixel seam behind this).
- `watchTheme()` listens for `storage` events, which fire across same-origin windows — this is how
  the Git viewer and File viewer popups re-theme when the main window toggles.
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
