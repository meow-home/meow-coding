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
│ TitleBar (frameless: drag region + min/max/close)                     │
├────────┬───────────────────────────────────────────┬─────────────────┤
│Sidebar │ SessionPanes                              │ RightPanel      │
│        │  ┌─────────────────────────────────┐      │  ┌───────────┐  │
│ work-  │  │ PaneHeader                      │      │  │ Tree      │  │
│ spaces │  │ ChatPanel (active session)      │      │  │ Artifacts │  │
│        │  │                                 │      │  └───────────┘  │
│ theme  │  └─────────────────────────────────┘      │  (resizable)    │
├────────┴───────────────────────────────────────────┴─────────────────┤
│ StatusBar (workspace · git branch · running count · app version)      │
└──────────────────────────────────────────────────────────────────────┘
```

Overlays: `SettingsDialog` (full-screen tabbed), `AddProjectDialog`,
`BrowserDialog`, `InstallGuideDialog`, `UpdateDialog`, `BackgroundPanel`, `FileContextMenu`.

## 9.3 `App.tsx` — the state hub

Owns: workspaces, the mounted `WorkspaceRuntime`s (one per kept-alive project),
background flags, browser status, update status, right-panel state, artifacts, and the active
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
that must be called in the effect cleanup.

Update-dialog policy: `update-available` and `downloaded` open the dialog; `error` and
`not-supported` close it; `up-to-date` only opens a dialog when the check was **manual**
(`manualCheckRef`), so the automatic startup check never pops anything.

## 9.4 Component inventory

### Shell

| Component | Responsibility |
|---|---|
| `TitleBar.tsx` | Custom window chrome for frameless platforms |
| `PopupTitleBar.tsx` | Same for the FileViewer/GitViewer popups (drag region + Linux min/max/close) |
| `Sidebar.tsx` | Project list; each project row is a lightweight group header — the project name (bright on the current project, dim otherwise) followed by a **trailing** expand/collapse chevron, with the `+` (new session) and `...` (project menu) icons revealed on hover / while the project is current. The project path lives on the row's `title`: there is no path line and no session count. An expanded project lists its **sessions**, indented: a status ring (green = running, yellow = waiting on input, hollow ring = idle), the name, and a trailing `...` menu that appears on hover / when active. The active session is a full-width rounded pill. The per-row `...` menu holds Rename (via inline input), Stop (when running) and Delete. The project `...` menu holds Open, Open in VS Code, Git, Open Folder, Open Terminal (a real OS terminal window via `openSystemTerminal`) and Remove. Deleting a project's last session immediately creates a fresh one — a project always shows ≥ 1 session. Expanded state persists in `localStorage` (`meow.sidebar.expanded`). Also: Providers entry and theme toggle in the footer menu. Projects with sessions waiting on a permission/question prompt show a red count badge (and a dot on the collapsed-rail avatar) |
| `StatusBar.tsx` | Workspace name, git branch, running count, app version |
| `SessionPanes.tsx` | Session layout of one project: **every session stays mounted** (inactive ones carry the `hidden` attribute, hidden by CSS and never unmounted) so a session that is not showing keeps streaming/answering. The active session is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the session that was showing); it reports the first session when the stored id no longer exists |
| `Pane.tsx` | One session: header + `ChatPanel`; background badge mode |
| `PaneHeader.tsx` | Status dot (which carries the status as its accessible name — `role="img"` + the status label, with any exit code folded in), the session name, and the menu (inject / log / stop / restart / background / delete — inject/log/stop/restart exist only on the parked PTY path; a native session's lifecycle lives in its sidebar row). The `...` button is the shared `.icon-btn`. No status word (the dot already shows it) and no git readout (the status bar owns branch + dirty count) |
| `EmptyState.tsx` | No-pane hint (differs for "no workspace" vs "workspace open") |
| `BackgroundPanel.tsx` | Background agents; open/stop |
| `RightPanel.tsx` | Resizable panel with a fixed header; **both tabs stay mounted** for instant switching |
| `RightPanelTree.tsx` | Lazy directory tree; auto-expands the project root; background refresh |
| `RightPanelArtifacts.tsx` | `.md` files agents created/edited |
| `FileViewer.tsx` | Popup file viewer with Shiki highlighting |
| `FileContextMenu.tsx` | Context menu for tree/artifact entries |

### Dialogs

`AddProjectDialog`, `UpdateDialog`, `BrowserDialog` (bridge pairing + status),
`InstallGuideDialog` (extension install steps).

### Chat (`components/chat/`)

| Component | Responsibility |
|---|---|
| `ChatPanel.tsx` | The container: subscribes to chat events, owns feed state (items / todos / queue / pendingPrompt), rAF-batches stream deltas, renders feed + composer + context footer. The permission/question prompt is rendered in-flow at the top of the chat input card (never overlays the chat history). The composer's `chat-footer` row — below the input row, still inside the composer — puts the mode on the left (`chat-footer-context`) and the model/variant selectors plus the context readout on the right (`chat-footer-controls`). Memoized. |
| `ChatInput.tsx` | Composer: the card's bottom is one row (`chat-input-row`) — the auto-growing field (`rows=1`, `field-sizing: content`, capped at 8 lines and then scrolling) plus a single 24 × 24 square button at the card's trailing edge: Send at rest (disabled while the field is empty), Stop while a turn runs, and Send again (`Save edit`) while a queued message is edited. Enter sends, Shift+Enter inserts a newline; the placeholder is `Type a message... (/ for commands)`, or `Processing...` while running. Paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, `/` command menu, edit-queued flow. Memoized, **uncontrolled**. |
| `useChatScroll.ts` | Feed scroll controller: follow / anchored / manual modes, turn-top anchoring, jump-to-end button. Pure geometry helpers live in `chat-scroll-geometry.ts`. |
| `ToolCallCard.tsx` | One tool call: input JSON, diff (edit / apply-patch), output or error. Memoized. |
| `DiffView.tsx` | Inline diff for edit-style tool calls |
| `MarkdownText.tsx` | `marked` + `DOMPurify.sanitize` |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs table pipes before rendering |
| `markdownPaths.ts` | Turns file paths in markdown into clickable `openFile` links |
| `highlight.ts` | Shiki syntax highlighting |
| `ContextFooter.tsx` | Context readout — a 24 × 24 icon-button ring; hovering shows a popover with session tokens in/out + cost. Hover-only, not clickable |
| `ModelPicker.tsx` / `VariantPicker.tsx` / `ModePicker.tsx` / `Dropdown.tsx` | Model / variant / build-plan mode selection |
| `parseCommandInput.ts` | `parseCommandInput(raw) → { isCommand, prefix }` for the `/` menu |
| `questionAnswer.ts` | `buildQuestionAnswer` for permission/question responses |

Chat conventions:

- **Transient status lines** (compaction, retry) live only in feed state — never written to the
  transcript, so they vanish on reload. That is deliberate.
- Feed items are updated **copy-on-write**; never mutate in place, or `memo()` stops working.
- Images travel as data URLs inside `ImageAttachment`; only `image/*` is accepted.
- The message queue shows `queued` badge rows supporting remove/edit via
  `window.api.removeQueued` / `editQueued`.

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
| `ContextTab` | Basic: max steps, auto-compact, MCP output max tokens. Advanced (collapsible): buffer / keepTokens / tailTurns / toolOutputMaxChars / maxBytes / maxLines + Notifications. **Empty optional fields mean auto**, and the placeholder shows the auto value for the active agent |
| `CommandsTab` | Slash-command editor ("+ Add command" in the header) |
| `UpdatesTab` | Update channel, check, install |
| `RemoteTab` | Remote control enable, relay URL, pairing, revoke |
| `Modal.tsx` | Reusable modal shell |

Adding a setting touches three places: `MeowSettings` in `src/shared/types.ts`, the normalize path in
`src/main/agent/config.ts`, and the tab here.

### Git viewer (`components/git/`)

`GitViewer.tsx` hosts tabs: `GitChangesTab`, `GitDiffView`, `GitHistoryTab`, `GitBlameTab`, plus
`GitFileTree` and `GitBranchSwitcher`. `parseDiff.ts` parses unified diffs for rendering. It runs in
its own `BrowserWindow` opened by `Channels.GitOpenViewer`.

## 9.5 Styling

`src/renderer/src/styles.css` — one file, CSS variables only.

- Root font size 15px; sizes `--fs-xs` 12px … `--fs-lg` 18px.
- Fonts: `--font-ui` (Segoe UI Variable / system-ui) for everything, `--font-mono`
  (JetBrains Mono / Nerd Font) for terminal, data and code labels. `--font-display` aliases
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
- **Menus anchor to the trigger's right edge by default; a left-edge trigger opts into
  `align="left"`** (`Dropdown.tsx`). The sidebar rows and the composer's right-hand pickers hug their
  container's right edge, so right-aligning keeps the menu inside it. A trigger at the container's
  *left* edge (the composer's "+" add menu) must align the menu's **left** edge instead: right-aligning
  there pushed the 158px menu 134px outside the composer card, over the transcript.
- **A selected selector row** is `background: var(--bg-active)` + accent label + a trailing tick, never a
  left accent bar. Rows are `[.menu-item-label][.menu-item-check]`: the label grows and ellipsizes, the
  check column is a fixed `var(--menu-icon)` (16px) and is rendered on **every** row (empty when
  unselected) so labels do not shift when selection moves. The slash-command palette
  (`.command-item.selected`) and the settings nav (`.settings-nav-item`) are not selectors and still use
  the left-bar idiom.
- **Action menus get icons and dividers; pickers get metrics only.** The action menus (project,
  session row, sidebar footer, pane header, right-panel file context) lead every item with a 16px
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
  in light mode).
- `watchTheme()` listens for `storage` events, which fire across same-origin windows — this is how
  the Git viewer and File viewer popups re-theme when the main window toggles.
- App-wide font size persists in `localStorage` under `meow.fontSize` (default 14, range 8–40px,
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
  `chat-scrollbar.spec.ts`, `sidebar-sessions.spec.ts`, `selectors.spec.ts`, `menus.spec.ts`

`playwright.config.ts` deletes `ELECTRON_RENDERER_URL` / `NODE_ENV_ELECTRON_VITE` at load time. The dev
app exports them to every process it spawns, and a shell started from inside it inherits both; with a
leaked value `src/main/index.ts` loads the renderer from the vite dev server and the suite renders the
current `src/` instead of the built `out/` — every assertion would silently test the wrong tree.

After touching IPC or UI, add or extend a smoke assertion so the regression is caught there.
