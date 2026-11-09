# Built-in Browser Panel — Design

Date: 2026-11-09 · Status: draft
Mockup: [Meow Browser Panel](https://claude.ai/artifact/4eY5mBrnkKUET8dySoen1k) (boards 1, 2, 4, 5 are in scope; board 3 is deferred).
Plan: [Built-in Browser Panel Implementation Plan](../plans/2026-11-09-builtin-browser-panel.md).
Touches: new `src/main/browser/{browser-backend,chrome-backend,embedded-browser,electron-tab-host,browser-tab,browser-router,cdp-commands,snapshot-output,site-approval}.ts`,
`src/main/browser/bridge.ts`, `src/main/agent/tools/browser.ts`, `src/main/agent/tools/registry.ts`,
`src/main/agent/config.ts`, `src/main/index.ts`, `src/browser-extension/{ax-snapshot,background}.ts` (moved helpers),
`src/shared/{ipc,browser-types}.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`,
`src/renderer/src/components/{PaneHeader,Pane,SessionPanes,StatusBar,BrowserDialog}.tsx`,
`components/common/{BaseModal,BaseDropdown}.tsx`, `components/terminal/TerminalView.tsx`,
`components/chat/toolSummary.ts`, new `components/browser/`.

## 1. Problem and evidence

Agent browser work today requires leaving the app and a multi-step setup:

- **Setup friction.** `browser_*` only works after installing an unpacked extension in Chrome and approving it
  (`browser_start` in `src/main/agent/tools/browser.ts`, `BrowserBridge.execute` returns
  `browser not connected — run browser_start first`).
- **The work is out of sight.** The agent acts in background Chrome tabs. To watch it or to check a dev server
  next to the chat, the user switches windows. Every other per-session tool (terminal, files, processes) already
  lives in the right-panels grid in `App.tsx`.
- **No panel can host a page.** Nothing in `src/` uses `WebContentsView`, `BrowserView` or `<webview>`.

The tool layer is reusable. `createBrowserTools` depends on the `BrowserBridgeLike` interface, not on Chrome, and
`ToolContext` already carries the identity needed for per-session tabs (`agentId`, plus `snapshotAgentId`, which
`task.ts` sets to the parent for subagents).

## 2. Goals and success criteria

1. A session can open a **Browser panel** in the right-panels grid, with tabs, back/forward/reload and a URL bar.
2. **The agent drives that same browser** through the existing `browser_*` tools, with no extension and no pairing:
   on a fresh install, `browser_navigate` to a local page, then `browser_read`, `browser_type` and `browser_click`,
   works with no setup step.
3. The agent keeps working while its panel is closed, its session is not selected, or the window is hidden to tray.
4. The user always sees who controls a tab and can take it back with one click. A taken-over tab never receives
   agent input.
5. On a non-loopback site, `browser_click`, `browser_type` and `browser_select` require approval. No `browser_*`
   tool returns a form field's value or types into a password field.
6. Dropdowns and modals render correctly over the panel, and every app shortcut works while a page has focus.
7. No renderer process or view outlives its session or the app.
8. `npm run typecheck`, `npm test`, `npm run build && npm run e2e` pass.

### Non-goals (v1)

- **Pick element → chat** (mockup board 3).
- **Screenshots for the model.** The `read` tool has no image path, so a `browser_screenshot` tool would return a
  file the model cannot see. Needs its own design.
- Restoring tabs after an app restart (cookies do persist), and a persisted per-site "always allow".
- Embedded DevTools; extensions in the built-in browser; site approval for the Chrome backend.
- `<webview>` or a separate window. Reliable coverage of cross-origin (out-of-process) iframes (see 12).

## 3. Decisions

| Question | Decision | Reason |
|---|---|---|
| Hosting primitive | `WebContentsView` owned by main | Tools run in main. The tab must outlive React (panel closed, session hidden), and `webContents.debugger` is directly available. The cost is occlusion (6.3). |
| Automation channel | CDP via `webContents.debugger` | Same protocol the extension already uses for `browser_read`, so its snapshot code is reusable. Gives trusted input events. |
| Default backend | Built-in; Chrome by explicit choice | No setup, and the work is visible. Chrome remains for sites signed in there. |
| Tab ownership | Per session (subagents use the parent's tabs) | Parallel sessions do not interfere. Matches terminals. |
| Cookies and storage | One shared `persist:meow-browser` partition | Sign in once per app. Trade-off: all sessions share those sign-ins. Separate from the user's Chrome. |
| Concurrent input | Agent activity shields the page; the user presses **Take over** | Prevents two actors corrupting page state. |

## 4. Architecture

```
browser_* tools ── BrowserRouter ─┬─ EmbeddedBrowser ── BrowserTab ── webContents.debugger ── page WebContentsView
 (ToolContext → owner, ask)       │        │                                                  shield WebContentsView
                                  │        └── IPC ── components/browser/* (toolbar, placeholder rect)
                                  └─ ChromeBackend ── BrowserBridge ── extension ── Chrome
```

### 4.1 Backend contract

Tools stop taking a bridge and a launcher, and resolve a backend per call. This changes the `run` signature of every
browser tool (mechanical) and `tests/unit/browser/agent-tools-browser.test.ts`.

```ts
interface BrowserCall {
  ownerId: string                                      // ctx.snapshotAgentId ?? ctx.agentId
  ask(q: QuestionPrompt): Promise<string | null>       // ctx.ask
  signal?: AbortSignal
}
interface BrowserBackend {
  start(call: BrowserCall): Promise<ToolRunResult>
  execute(name: BrowserCommandName, params: Record<string, unknown>, call: BrowserCall, timeoutMs?: number): Promise<BrowserCommandResult>
  getConsoleLogs(call: BrowserCall, limit?: number): unknown[]
  getNetworkLogs(call: BrowserCall, limit?: number): unknown[]
}
interface BrowserRouterLike {
  backendFor(ownerId: string): BrowserBackend
  select(ownerId: string, target: 'builtin' | 'chrome'): void
}
```

- `ChromeBackend` wraps `BrowserBridge` and the launcher and contains today's `browser_start` logic. Chrome behavior
  does not change, except for the untrusted-content header in 7.4.
- `BrowserRouter` keeps an in-memory sticky choice per owner, defaulting to `meow.json` `browser.backend`.
  A tool call with no resolvable owner fails with `browser: no session context`.

### 4.2 Shared code moved

- `src/browser-extension/ax-snapshot.ts` → `src/shared/browser-ax-snapshot.ts` (already pure). Update the extension
  import and `tests/unit/browser/ax-snapshot.test.ts`.
- The `waitForPageSettle` expression and the `collectFrameAx` walk in `background.ts` are parameterized over a
  `send(method, params)` function and moved to the same shared module, so both backends use one implementation.
- `BridgeDeps` snapshot saving (`saveSnapshot` in `bridge.ts`) → `src/main/browser/snapshot-output.ts`.
  Output keeps `{ path, size, nodeCount, preview }`.

## 5. Main process

### 5.1 `EmbeddedBrowser`

Owns all tabs, implements `BrowserBackend`, and is constructed in `MainApp` with `getWindow: () => win`.

- **Limits:** 8 tabs per session, 8 per app (S4: ~123 MB of working set per tab, so 16 tabs would add ~2 GB; raise
  the app cap above 8 only together with a background-tab discard policy). Beyond the cap, creation fails with an
  error stating the limit.
- **Working tab per owner:** the default target when `tabId` is absent. Last tab the agent used, else the panel's
  active tab. `browser_navigate` with no tab creates one; other commands return `no target tab`.
- **Lifecycle:** `removeSession(agentId)` is called in the `Channels.AgentRemove` handler beside
  `terminals.removeSession`. `closeAll()` is called from `before-quit` with the terminals' stop. Both destroy page
  and shield views.
- **Window recreate:** tabs reattach when `createWindow` runs again.
- **No window:** commands return `browser unavailable: no app window`.

### 5.2 `BrowserTab`

Per-tab state: page view, shield view, debugger session, ref map, ring buffers, control state, command queue.
Tab id = page `webContents.id` (a number, like Chrome tab ids; ids never mix because the backend is sticky per owner).

**Page view hardening:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload,
`partition: 'persist:meow-browser'`. Applied to the partition once at startup:

- `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything except clipboard write.
- `will-navigate` and `will-redirect` (main frame) allow only `http:`, `https:` and `about:blank`.
  `will-frame-navigate` applies that list to the main frame; subframes additionally allow `about:srcdoc`,
  `blob:` and `data:` (ordinary inline content, still in the page's sandboxed renderer). `file:` and custom
  schemes stay blocked for both. The check is `isAllowedNavigation(url, isMainFrame)` in
  `src/main/browser/navigation-policy.ts`.
- `setWindowOpenHandler` opens http(s) URLs as a new tab of the same owner and denies everything else.
- `will-download` cancels while the agent has control; otherwise the default save dialog is used.
- Certificate errors stay rejected (no override).

**Debugger:** attached at tab creation (`Page`, `Runtime`, `Network`, `Log`, `DOM`, `Accessibility` enabled), so logs
exist before the first read. Ring buffers hold 200 console entries and 200 requests per tab. An unexpected detach
reattaches once, then returns an error.

**Commands (`cdp-commands.ts`):**

| Command | Implementation |
|---|---|
| `read` | Settle, `collectFrameAx`, `mergeFrameAxTrees`, `axTreeToSnapshot` (`maxNodes: 0`), store refs, `snapshot-output`. |
| `click` | Ref/selector → `DOM.scrollIntoViewIfNeeded`, `DOM.getBoxModel` center, `Input.dispatchMouseEvent` press + release. `x`,`y` used directly. Trusted, unlike the extension's `el.click()`. |
| `type` | Password check (7.2), focus, select existing content, `Input.insertText`, then dispatch `change` via `Runtime.callFunctionOn`. |
| `select` | Same setter + `change` event as the extension's `refAction`. |
| `scroll`, `waitFor` | `Runtime.evaluate`. |
| `navigate` | `webContents.loadURL` on the target or working tab; returns `{ tabId, url, title }` after settle (30 s cap). |
| `openTab`, `switchTab`, `closeTab`, `listTabs`, `reload` | Tab manager. |

- A navigation, or hand-back after a user hold, clears the ref map. A stale ref returns the existing error
  `snapshot stale: re-read the page (ref …)`.
- Commands on one tab run through a FIFO queue, because subagents share their parent's tabs.
- `Page.javascriptDialogOpening`: while the agent owns the tab (`agent`/`approval`), `alert` and `beforeunload` are
  accepted, `confirm` is dismissed, and the next tool output reports the dialog's type and text. While the user owns it
  (`user`/`idle`), Electron's native `alert`/`confirm` dialog is left for the user to answer and nothing is recorded
  for the agent. Electron shows no dialog and emits no CDP event for `prompt()`, so a page's `prompt()` call never
  returns; navigating away recovers the tab.
- `render-process-gone` marks the tab `crashed`. Commands return an error until reload; the panel shows a reload
  action.

### 5.3 Running with no visible panel

A tab has a view attached and sized at all times. With no panel, it keeps its last bounds (initially 1280×800) and
sits outside the window's visible area, with `backgroundThrottling: false`.

S2 measured what that costs: with the window visible, the off-screen view's layout viewport collapses to 0×0, so
`DOM.getBoxModel` returns 0,0 and clicks and typing miss, while the AX tree, CDP and a 50 ms timer keep working.
Every tab that is not the visible panel tab therefore gets
`Emulation.setDeviceMetricsOverride({ width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })`; the override
is cleared when the tab is attached to the panel. With the window hidden (`win.hide()`) everything already works
plain, including the timer at its full rate (30–31 ticks per 1.5 s); `Emulation.setFocusEmulationEnabled` was not
needed on Windows.

## 6. Control and input

### 6.1 Control state

`BrowserTabInfo.control` is one of `idle | agent | approval | user`.

```
idle ── agent command ──► agent ── lease expires / turn ends ──► idle
agent ── Take over ──► user ── Hand back ──► idle
agent ── click/type/select on an unapproved site ──► approval ── answered ──► agent
idle or agent ── browser_handoff ──► user (with reason) ── I'm signed in ──► idle
```

- **Lease:** 15 s, renewed by each command so the shield holds while the model thinks between calls. Ended early by
  `releaseOwner(agentId)`, called from the turn `done`/`error` path in `index.ts` (beside
  `delegationService.notifyAgentAvailable`).
- **Agent commands in `user` state wait.** They do not error, because an error invites a retry loop that spends
  tokens. They resume on hand-back, reject on `call.signal` abort, and return an error after 5 minutes:
  `user is holding this tab`. Output on resume includes `[meow] The user held this tab; the page may have changed.
  Re-read it.`
- **In-flight commands finish:** Take over takes effect at the next command boundary. Each command is atomic.

### 6.2 Shield

A second, transparent `WebContentsView` (`setBackgroundColor('#00000000')`, sandboxed, inline `data:` document, no
preload) sits on top of the page with identical bounds, visible only in `agent` and `approval`.

- It swallows mouse, wheel and keyboard input, enforcing goal 4. CDP input goes straight to the page's webContents.
- It draws the agent cursor and the target ring through `executeJavaScript`. The page's DOM and accessibility tree
  stay untouched, so the agent never reads its own decoration.
- The document must be transparent (`html, body { background: transparent }`) in addition to
  `setBackgroundColor('#00000000')`. S3: the shield's own capture is `rgba(0,0,0,0)` everywhere, the composed screen
  pixel of the page is identical with and without the shield, a real OS click at the page button is counted by the
  shield and leaves the page button untouched, and a CDP click on the page's webContents still reaches the page.

### 6.3 Occlusion

A `WebContentsView` paints above all renderer HTML, so anything portaled by `BaseDropdown` or `BaseModal` would sit
behind it, and a mouse crossing it during a drag stops reaching the renderer.

- `useBrowserOcclusion(active)` keeps a counter in the renderer. `BaseDropdown` and `BaseModal` call it while open;
  so does the `right-panels-resizer` during a drag.
- 0→1: `browserPanelFreeze()`. Main captures the active tab with `view.webContents.capturePage()` (retried, it can
  fail transiently with `UnknownVizError`) and returns a data URL; the renderer paints it in the placeholder and only
  then asks main to hide the views. S1: image-first = 69 ms to hidden and a 0 ms blank gap; hide-first = 115 ms and a
  31 ms gap (≈2 frames). `win.capturePage()` cannot provide this snapshot: it excludes child `WebContentsView`s.
- The freeze is generation-guarded. A quick click on the resizer can end the drag while the capture is still in
  flight; an unfreeze that runs before the freeze finishes leaves the panel hidden and frozen (observed once). 1→0:
  `browserPanelUnfreeze()`, which wins over any pending freeze.
- The view is also hidden when another panel is expanded over it, or when the workspace showing it is hidden.
- Other fixed overlays that can overlap the panel are found in an audit during implementation and given the same hook.

### 6.4 Geometry and keyboard

- `BrowserViewport` is an empty placeholder div. A `ResizeObserver` plus window resize send its rect, coalesced per
  animation frame, via `browserPanelSetBounds`.
- Main multiplies the rect by `win.webContents.getZoomFactor()`, because the default application menu still has zoom
  roles (no `Menu.setApplicationMenu` call exists).
- Keys typed in a page never reach the renderer's window listeners, so `before-input-event` on page and shield
  forwards app shortcuts through `EventBrowserShortcut`: `Ctrl/Cmd+\`` (terminal) and `Ctrl/Cmd+Shift+B` (browser).
  It also handles `Ctrl/Cmd+L` (focus URL bar), `Ctrl/Cmd+R` (reload this tab, not the app) and `Alt+Left/Right`.

## 7. Safety

The partition holds real sign-ins, and page content is attacker-controllable. Today's default of `'browser_*': 'allow'`
(`config.ts`) is therefore not sufficient on its own for this backend. It stays as the tool-level rule; the checks
below are added inside `EmbeddedBrowser`. The plan-mode `'browser_*': 'ask'` rule is unchanged.

### 7.1 Site approval (`site-approval.ts`, board 4)

- **Gated:** `click`, `type`, `select`. **Not gated:** `navigate`, `read`, `scroll`, `waitFor`, tab commands, logs.
- **Key:** main-frame origin, via `webContents.getURL()` at action time. Subdomains ask separately.
- **Exempt:** `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`.
- **Prompt:** `call.ask` with header `Allow Meow to act on this site?`, the tool, origin and target element name, and
  options `Allow once`, `Allow this site for the session`, `Deny`.
- **After the answer:** the origin is re-read; if it changed, the command fails with a stale error and the agent must
  re-read.
- **Denied, or `ask` returns `null`:** the command returns an error. A background subagent therefore fails rather
  than hangs.
- **Scope:** session approvals live in memory per owner. `browser.siteApproval: 'off'` in `meow.json` disables the
  check.

### 7.2 Sensitive fields and handoff (board 5)

- `browser_type` and `browser_select` refuse a target that is `input[type=password]` or has `autocomplete` starting
  with `cc-`, with an error telling the agent to call `browser_handoff`. Password fields are also refused by selector.
- `browser_read` never outputs field values: `axTreeToSnapshot` emits only role and name.
- New tool `browser_handoff({ reason, tabId? })` sets `user` state with the reason in the banner and blocks until the
  user presses **I'm signed in** or the call is aborted. It returns whether the page's origin changed, and never its
  content.
- Console and network entries captured while the user holds the tab are marked and excluded from the agent's
  `browser_console` / `browser_network` output, including after hand-back; only the user's drawer sees them.

### 7.3 What this does not protect against

These are guardrails against mistakes and prompt injection, not a sandbox. An agent with an approved `bash` runs as
the same OS user and can read `userData`, including the partition's files. Navigation is ungated, so a page or URL
could carry data out, the same exposure `webfetch` has today. Both limits go in the docs.

### 7.4 Untrusted content

Snapshot files and previews, on both backends, start with a line stating that the content comes from a web page and is
data, not instructions. The `browser_read`, `browser_console` and `browser_network` descriptions say the same.

## 8. Tools

| Tool | Change |
|---|---|
| all | Pass `BrowserCall`. Descriptions become backend-neutral (no "Chrome" or "Meow tab group" wording as a guarantee). |
| `browser_start` | Adds `target?: 'builtin' \| 'chrome'`, calling `router.select` when present. No target on built-in returns ready immediately and never opens Chrome. |
| `browser_navigate` | Built-in: navigates the working tab. Chrome: unchanged (new background tab). Both return `tabId`. |
| `browser_open_tab`, `browser_switch_tab` | Built-in: new tab / sets the working tab. `switch_tab` does not steal the panel's selected tab from the user. |
| `browser_console`, `browser_network` | Built-in: the working tab's buffers, optional `tabId`. |
| `browser_handoff` | **New.** Covered by the `browser_*` rule and by `toolSummary.ts`'s existing `browser_` category. Built-in only; the Chrome backend returns an error. |

The `reload` and `screenshot` commands stay internal: neither gets a tool in v1.

## 9. Renderer

**`components/browser/`**

- `BrowserOverlay.tsx`: uses the `files-overlay`, `files-head` and `files-tab` chrome, as `TerminalOverlay` does.
  Actions: console toggle, new tab, expand, close. Tab context menu through `BaseDropdown`.
- `BrowserToolbar.tsx`: back, forward, reload, URL input, open in the default browser (http(s) only, through
  `openExternal`; the mockup's "Open in Chrome" label changes accordingly).
- `BrowserControlBanner.tsx`: the four states of 6.1 with **Take over**, **Hand back** or **I'm signed in**.
- `BrowserViewport.tsx`: placeholder rect and frozen image.
- `BrowserDrawer.tsx`: Console and Network, polling `browserTabLogs` every 1.5 s while open, as `ProcessesOverlay`
  does. **Send to chat** reuses the path `TerminalView` uses for "Send last 100 lines to chat".

**`App.tsx`**

- `browserOpenFor` and `browserFull`, mirroring `terminalOpenFor` and `terminalFull`, joined into the expanded and
  docked render paths and into both panel counts.
- The docked container width becomes `Math.max(rightPanelsWidth, cols * 360, browserDocked ? 640 : 0)`; the persisted
  `meow.rightPanels.width` is not overwritten.
- `EventBrowserPanelRequest` opens the panel only when the agent created a tab **and** that session is the active one
  in the active project. Closing it stays closed until the agent creates another tab.

**Other**

- `PaneHeader.tsx`: Globe toggle beside the terminal button (disabled for drafts), with the agent dot while the
  session's agent controls a tab. `Ctrl/Cmd+Shift+B` in `Pane.tsx`, next to the terminal shortcut.
- `TerminalView.tsx`: `registerLinkProvider` for loopback http(s) URLs only; clicking opens a tab for that session and
  opens the panel. Other URLs are untouched.
- `BrowserDialog.tsx`: a `BaseSelect` for the default backend and a **Clear browsing data** action
  (`session.clearStorageData` on the partition, with `ConfirmDialog`). `StatusBar.tsx` pill shows the default backend.

The mockup shows `paused` on a held tool card. v1 keeps the standard `running` card; the banner carries the state.

## 10. Contracts and storage

**Types** (`src/shared/browser-types.ts`)

```ts
type BrowserTabControl = 'idle' | 'agent' | 'approval' | 'user'
interface BrowserTabInfo {
  id: number; agentId: string; url: string; title: string
  loading: boolean; canGoBack: boolean; canGoForward: boolean; crashed: boolean
  control: BrowserTabControl; holdReason?: string
}
```

**Channels** (added to `Channels`, `AgentApi`, preload, `registerIpcHandlers`)

`BrowserTabsList`, `BrowserTabCreate`, `BrowserTabClose`, `BrowserTabActivate`, `BrowserTabNavigate`,
`BrowserTabHistory` (`back | forward | reload | stop`), `BrowserTabLogs`, `BrowserTakeOver`, `BrowserHandBack`,
`BrowserPanelAttach`, `BrowserPanelDetach`, `BrowserPanelSetBounds`, `BrowserPanelFreeze`, `BrowserPanelHideFrozen`, `BrowserPanelUnfreeze`,
`BrowserClearData`; events `EventBrowserTabsChanged`, `EventBrowserPanelRequest`, `EventBrowserShortcut`.

**Config** (`meow.json`): `browser: { backend: 'builtin' | 'chrome', siteApproval: 'ask' | 'off' }`, defaulting to
`builtin` and `ask`. Normalized on load and preserved by `settingsToConfig`/`configToSettings`.

**Storage:** cookies and site data live in the partition under `userData/Partitions/meow-browser`. Tabs, approvals and
logs are in memory only. Snapshots keep using `userData/browser-snapshots`.

**Compatibility:** existing paired-Chrome users switch to built-in by default. The tool result of `browser_start`
states the active backend, and the dialog setting or `browser_start({ target: 'chrome' })` restores the old behavior.

## 11. Testing

**Unit** (`tests/unit/browser/`, with a fake `CdpClient` and fake view, so `BrowserTab` logic stays Electron-free
behind an injected factory):

- `browser-router`: default, sticky selection, per-owner isolation, no owner.
- `site-approval`: loopback exemption, once vs session, deny, null ask, origin changed during the prompt.
- `browser-tab` control: every transition in 6.1, lease renew and expiry, wait on `user` with abort and timeout, ref
  invalidation on navigation and hand-back, FIFO order.
- `cdp-commands`: click coordinates from the box model, password and `cc-` refusal, stale ref error, dialog handling.
- `agent-tools-browser` (updated): owner resolution from `snapshotAgentId`, `browser_handoff`, `target`.
- `ipc-contract` (existing): new channels are covered.

**Integration** (`tests/integration/browser/`): a real `SessionRunner` tool flow with the fake CDP, covering the
navigate/read/click sequence through the router.

**E2E** (`tests/e2e/browser-panel.spec.ts`, against a local fixture HTTP server):

- Agent-free panel flow: open the panel, load the fixture, tabs and reload work.
- Driving a real tab: read, type and click change the fixture's DOM.
- With the shield up, a real user click does not reach the page; after Take over it does.
- With the panel closed, driving still works; after session delete, the views are gone.
- Opening a `BaseDropdown` over the panel is visible and clickable.
- Expanded panel containment, following `tests/e2e/right-panels-full.spec.ts`.

## 12. Spikes and risks

Each spike runs before the code that depends on it. A failed gate returns the design to review rather than being
worked around in place.

| Id | Unknown | Gate | Blocks |
|---|---|---|---|
| S1 | Occlusion by freeze: flicker and latency on Windows | Dropdown visible and clickable in ≤ 100 ms on the view with no blank flash beyond one frame; resizer drag works in both directions | Panel UI |
| S2 | Driving a view that is outside the visible area, and with the window hidden to tray | Read, click, type and a page timer all work; AX tree non-empty | Goal 3 |
| S3 | Transparent shield | Shield blocks real input while CDP input reaches the page and the page stays visible through it, on Windows; repeated on macOS and Linux before those builds ship | Goal 4 |
| S4 | Memory with 8 tabs | Measured and recorded; informs the app tab cap | Limits |

### Results (2026-11-09, Windows 11, Electron 41.7.1)

Run on `spike/browser-panel` at `a85ab22` with `npx electron spike/main.js`; raw data in `spike/results/`, manual
steps in `spike/README.md`.

| Id | Result | Evidence |
|---|---|---|
| S1 | PASS | image-first freeze: 69 ms to hidden, 0 ms blank gap; hide-first: 115 ms, 31 ms gap. Composed screen pixel on the frozen dropdown, a real OS click on it, and a real OS resizer drag in both directions (9 moves, `pointerup`, 8 bounds updates) all passed. |
| S2 | PASS with the fallback | Window visible, view outside the window: layout viewport 0×0, box model 0,0, click and typing fail; `setDeviceMetricsOverride` fixes all four checks. Window hidden: all four pass plain (30–31 ticks per 1.5 s). |
| S3 | PASS | Shield alpha 0, page pixel unchanged through it, a real OS click counted on the shield and not on the page, CDP click on the page reached it. |
| S4 | PASS | 1 tab 580 MB, 8 tabs 1443 MB (delta 862 MB ≈ 123 MB/tab, 9 renderer processes). 16 tabs would add ~2 GB. |

Design changes from the results: freeze ordering and the freeze/unfreeze guard (6.3), the device-metrics override
(5.3), the app tab cap (5.1). Still needs a human: flicker in the real app, the real resizer with pointer capture,
shield drawing (Task 7), S1 and S3 on macOS and Linux, long-run memory, and `capturePage` retry behaviour in the app.

| Risk | Handling |
|---|---|
| Cross-origin iframes run out of process, and a debugger attached to the main target may not see them. | v1 omits unreachable frames from the snapshot, and the `browser_read` description says so. Full coverage (`Target.setAutoAttach`) is a follow-up. |
| Agent acquires an `idle` tab while the user is mid-interaction. | Accepted for v1; the shield appears and the user can Take over. Revisit using `input-event` if it is reported. |
| Site approval is main-frame only, so a sensitive embedded iframe uses its parent's approval. | Accepted for v1 and documented. |
| Bot checks may treat CDP-attached sessions or Electron's user agent differently. | Handoff and Chrome backend remain as alternatives; no evasion is attempted. |

## 13. Build order

1. S1, S2, S3 in a throwaway branch; record results in this spec.
2. Extract shared code (4.2) and introduce router + `ChromeBackend`, with no behavior change.
3. `EmbeddedBrowser`, `BrowserTab`, CDP commands and hardening, tested through the tools with no UI.
4. Control state, shield, site approval, password refusal, `browser_handoff`.
5. IPC, panel UI, occlusion, geometry, shortcuts.
6. Drawer, terminal links, dialog setting, status bar, compatibility copy.

## 14. Documentation sync

Same commits as the code, per the sync rules in `AGENTS.md`:

- `docs/reference`: `02-architecture`, `04-tool-catalog` (including the 7.3 limits), `05-ipc-contract`,
  `06-data-and-storage`, `08-integrations`, `09-ui-guide`.
- `AGENTS.md` (root: structure and a browser convention stating that the partition is not a Chrome profile and the
  bridge rule is unchanged), `src/main/AGENTS.md`, `src/main/agent/tools/AGENTS.md`, `src/renderer/AGENTS.md`,
  `src/renderer/src/components/AGENTS.md`.
