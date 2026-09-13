# AGENTS.md — src/renderer

React renderer (no direct Node/Electron access).

## Structure

- `index.html` + `src/main.tsx` — entry; render `<App>`; if `window.api` is missing, show a guidance
  fallback (preload not loaded). `main.tsx` also patches `console.log/info/warn/error` to forward
  each call to the system logger via `window.api.writeSystemLog` (no-op when `window.api` is missing).
- `src/App.tsx` — state hub: workspaces, the mounted `WorkspaceRuntime` per kept-alive
  project; defines `PaneModel` (agent + state + git) for each pane; owns the active session per
  project path (`activeSessionByPath`, persisted to localStorage `meow.activeSessionByPath`) so
  switching workspaces restores the previously active session. Also tracks `needsInput`
  (project path → agent ids waiting on a permission/question prompt, for the sidebar
  badges) and handles `onActivateAgent` (OS notification click) by opening the target
  workspace and activating the waiting agent's session.
- `src/components/` — `Sidebar` (project list; expand a project to see its session rows with a
  status dot and a per-row rename/stop/delete menu, plus a `+` that creates and activates a
  session), `SessionPanes`, `Pane`, `PaneHeader`, `EmptyState`,
  `StatusBar`, `TitleBar`, `BackgroundPanel`, `UpdateDialog`,
  `BrowserDialog`, `InstallGuideDialog`, `files/` (the Files overlay:
  `FilesOverlay`, `FilesTree`, `file-path`, `tree-filter`),
  `file-content/FileContentView`, `chat/`, `settings/`.
- `src/styles.css` — VSCode Dark+ palette (default) with a Light+ variant activated via
  `[data-theme="light"]` on `<html>`. All colors use CSS variables so theme switching is a single
  attribute flip. Spacing on a 4px scale, controls use Tailwind default sizes. Font: UI sans (Segoe UI
  Variable/system-ui) for all text, mono (JetBrains Mono) for terminal/data/code labels.
  Theme toggle lives in the Sidebar footer dropdown menu (Sun/Moon icon). Theme preference is
  persisted in `localStorage` (`meow.theme`), default is `dark`.
- `src/theme.ts` — shared theme helpers: `applyTheme` (set `data-theme` on `<html>` from
  localStorage) and `watchTheme` (re-apply on `storage` events). `main.tsx` calls both for EVERY
  renderer — including the Git viewer and FileViewer popup windows (separate BrowserWindows) — so
  they inherit the theme from the main window automatically.
- `src/font.ts` — shared font-size helpers: `applyFontSize` (set `font-size` on `<html>`/`<body>`,
  default 14, range 8-40px) and `watchFontSize` (re-apply
  on `storage` events). `main.tsx` calls both for EVERY renderer (main window + Git viewer +
  FileViewer popups) so they inherit the persisted font size.
- `src/session-guard.ts` — pure `isLastSession(projectPath, sessionId, runtimes, workspaces)`: whether
  removing a session would leave its project with none (the mounted runtime is the truth for an open
  project, the sidebar summary for a project that was never opened). `App.tsx`'s `removeSessionGuarded`
  is its only caller, so the "≥ 1 session per project" invariant is unit-testable.

## Conventions

- All main access goes through `window.api` (typed `AgentApi` from shared). Do not import Node/electron.
- Session layout: `SessionPanes` mounts **every** session of the active project and hides the
  inactive ones with the `hidden` attribute (CSS only). Never unmount or re-key a session on
  switch — doing so stops its run. The active session is tracked in `App` per project path (passed
  to `SessionPanes` as `activeId`/`onActiveChange`).
- Cross-project keep-alive: kept-alive projects stay mounted under `.workspace-hidden`
  (`display: none`) for the same reason — hidden `ChatPanel`s keep consuming ChatEvents.
- Functional components + hooks; declare the `Props` interface in the same file.
- UI labels in English. Use tabular-nums figures when displaying numbers.

## CSS — border-radius & style scope

Lessons learned from the Git viewer screen (don't repeat them):

- **`src/styles.css` has a global rule `* { border-radius: var(--radius) }`** — it rounds EVERY element
  unless explicitly overridden. When you want a "square" area (no rounded corners), don't just set
  `border-radius: 0` on each rule — you'll miss some (tab, panel, cell) and easily get the syntax wrong.
- **Standard pattern for a screen/popup that wants square corners:**
  ```css
  /* Top of section: */
  .git-viewer * { border-radius: 0; }          /* square everything */
  .git-viewer .btn,
  .git-viewer .git-header-btn { border-radius: var(--radius-sm); }  /* only keep for buttons */
  ```
  Only list the elements that ACTUALLY need rounded corners (buttons, inputs, dropdown content, options...).
- Before editing: check whether the element is being rounded by the `*` rule (`grep "border-radius"` +
  trace the class). Don't assume.
- **Icon-only buttons use `.icon-btn`** (fixed 24 × 24, `border-radius: var(--radius-xs)` = 3px) —
  the sidebar's project `+`/`...` and session-row `...`, plus the pane header's `...`. Never `.btn small`
  with a container padding override. `.project-actions .btn` and `.btn.small` are both `(0,2,0)`, so
  source order decides and the override is silently ignored (the project `+`/`...` rendered 34 × 25
  and the pane header's `...` 31 × 21 with the `.btn` 6px radius before the dedicated class existed).
- **The title bar paints `var(--bg)`** — `.title-bar` paints `var(--bg)`. On Windows the OS paints the caption strip ~0.5px narrower than the reserved `11.5rem`, so a transparent bar exposed `body`'s radial gradient as a 1px line beside the min/max/close buttons. Don't reintroduce a transparent title bar (`window-chrome.test.ts` guards the surface). `.title-bar-brand` (when expanded) and `.sidebar` draw a `--hairline` right border; when collapsed (`.title-bar-brand.collapsed`), it has `background: var(--bg)` to match the chat pane background and `border-right: none`.
- **Dropdowns share the `--menu-*` metric tokens** (`--menu-radius`, `--menu-pad`, `--menu-item-h`,
  `--menu-item-pad-x`, `--menu-icon`). New menu surfaces must consume them, not hardcode padding.
- **Selector rows use `.menu-item-label` + `.menu-item-check`**, and triggers use `.dropdown-caret`.
  A selector trigger must set `aria-expanded={open}` (the caret's rotation is CSS off that attribute;
  `Dropdown.tsx` does it for `ModePicker`/`VariantPicker`, the other two set it themselves). The check
  column is fixed-width and present on unselected rows too — dropping it there makes labels shift.
  Action menus (project / session / footer / pane / file context) carry a 16px `aria-hidden` icon per
  item plus `.menu-sep` dividers; pickers stay icon-free by design. `Sidebar.tsx`'s `MENU_WIDTH`
  constant must stay in sync with the `.project-menu-dropdown` / `.sidebar-footer-dropdown` CSS
  `min-width` — those menus are positioned from the trigger rect and clamp to it.
- Edit CSS with python when the file uses CRLF (the edit tool won't match strings) — see `tests/*.test.ts`,
  `styles.css` are all CRLF.

## Performance

Lessons from a real chat input lag debugging session (measured with Chromium trace via CDP, no guessing):

- **Limit unnecessary animations**, especially on elements that update frequently (scrolling on every
  token stream, transitions on an input being typed into). Animations run on the UI thread; combined
  with dense re-renders (streaming, continuous keystrokes) this causes noticeable jank. For fast
  repeated updates, use instant scrolling (`scrollIntoView()` without `behavior: 'smooth'`); only use
  smooth scroll for discrete, one-time actions (e.g. a new message fully appearing, not every delta).
- **Long lists (chat feed, tool-call list) must have `content-visibility: auto` on each row**
  (`.chat-msg`, `.tool-call`) + an estimated `contain-intrinsic-size`. Measured in practice: a project
  with ~250 items / ~3000 DOM nodes caused EVERY keystroke in the chat box to trigger a full-page
  layout (~39ms) — the browser needs a synchronous layout to position the text caret
  (`TypingCommand::InsertText`), and that layout spreads across the entire DOM including parts long
  scrolled off-screen if not marked with content-visibility. Adding this property reduced the cost
  ~6-7x (39ms → 5.7ms/keystroke).
- **The main text input field (chat input) uses uncontrolled (ref) instead of controlled
  (`value` + `onChange` + `setState`)**. `setState` on every keystroke forces React to re-render even
  when the content doesn't affect other UI. Read `e.target.value` directly via ref; only `setState`
  when a derived state ACTUALLY changes (e.g. opening/closing the "/" command menu), and bail out by
  returning the same object reference when the value is unchanged so React skips the re-render.
- **Don't optimize before measuring.** `requestAnimationFrame`/`cancelAnimationFrame` are NOT free —
  once tried using rAF to "split" a cheap check (string comparison) out of the input handler, the result
  was SLOWER than the old synchronous version because rAF is a real browser API call, not a no-op.
  Before adding any perf optimization: measure with real tools (CPU profile / Chromium trace via CDP
  `Profiler`/`Tracing`, or Event Timing API `processingStart`/`processingEnd`) — don't guess from a
  familiar pattern and call it done.
- **Callbacks passed down to `memo()`-ized components** (e.g. `ChatPanel`, `FeedMessage`,
  `ToolCallCard`, `CommandMenuItem`) must be stable via `useCallback` with correct dependencies —
  otherwise every re-render of the parent component (including from unrelated state, e.g. polling git
  status every 5s) will force re-renders to cascade down the entire subtree. Row/item components should
  take primitive props, avoiding receiving whole objects whose reference the parent changes every
  render, otherwise `memo()` is ineffective.

## Testing

- No renderer unit tests yet; ensure `npm run typecheck` passes and the e2e smoke test
  (`npm run build && npm run e2e`) doesn't break.