# Built-in Browser Panel Implementation Plan

Status: Tasks 0–15 done on `feat/browser-panel`; Task 16 manual checks pending

**Goal:** Give every session a browser in the right-panels grid that the agent drives through the existing
`browser_*` tools, with no extension and no pairing. Spec:
[Built-in Browser Panel — Design](../specs/2026-11-09-builtin-browser-panel-design.md).

**Architecture:**

- `src/main/browser/browser-router.ts` — resolves a backend per call, sticky per session.
- `src/main/browser/chrome-backend.ts` — today's `BrowserBridge` + launcher behind the backend contract.
- `src/main/browser/embedded-browser.ts` — owns tabs, limits, working tab, lifecycle, panel attachment.
- `src/main/browser/browser-tab.ts` — per-tab state: control, queue, refs, log buffers. Electron-free.
- `src/main/browser/cdp-commands.ts` — command implementations over a `CdpClient`. Electron-free.
- `src/main/browser/site-approval.ts` — origin approvals. Pure.
- `src/main/browser/electron-tab-host.ts` — the only file here that imports Electron: page and shield views,
  debugger adapter, partition hardening.
- Renderer `components/browser/` — panel chrome, banner, viewport placeholder, drawer.

**Tech Stack:** Electron 41 (`WebContentsView`, `webContents.debugger`), React 19, TypeScript strict, Vitest,
Playwright.

## Global Constraints

- Source code, UI labels, `[meow]` notices, test names and docs are in **English**.
- Git commits: **do not** add a `Co-Authored-By` trailer. One commit per task unless a task says otherwise.
- IPC strings only via `Channels` in `src/shared/ipc.ts`. `src/shared` imports no Node/Electron.
- Only `electron-tab-host.ts` and `index.ts` touch Electron browser APIs, so all other logic is unit-testable.
- Menus and popups use `BaseDropdown` / `BaseSelect` / `BaseModal`; no custom overlay positioning.
- A session that is not showing stays mounted; tabs live in main and never depend on React.
- Every code change updates the matching `AGENTS.md` entry and `docs/reference/*` page in the same commit, touching
  only the entries that changed and keeping each file's format.
- `tests/unit/ipc-contract.test.ts` is updated whenever the IPC contract changes.
- E2E: never hardcode a px metric that comes from a `rem` rule (`tests/e2e/AGENTS.md`).
- Before completion: `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
- Single test file: `npx vitest run <path>`; single e2e: `npx playwright test tests/e2e/<file>.spec.ts`.

## Design

### Constants

| Name | Value | File |
|---|---|---|
| `MAX_TABS_PER_SESSION` | 8 | `embedded-browser.ts` |
| `MAX_TABS_TOTAL` | 8 (S4: ~123 MB per tab; raise only with a background-tab discard policy) | `embedded-browser.ts` |
| `DEFAULT_VIEW_BOUNDS` | 1280 × 800 | `embedded-browser.ts` |
| `LOG_BUFFER_ENTRIES` | 200 per kind, per tab | `browser-tab.ts` |
| `CONTROL_LEASE_MS` | 15_000 | `browser-tab.ts` |
| `USER_HOLD_TIMEOUT_MS` | 300_000 | `browser-tab.ts` |
| `NAVIGATE_TIMEOUT_MS` | 30_000 | `cdp-commands.ts` |
| `PARTITION` | `'persist:meow-browser'` | `electron-tab-host.ts` |
| `MIN_DOCKED_WIDTH` | 640 | `App.tsx` |

### Seams (`browser-tab.ts`)

```ts
export interface CdpClient {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  onEvent(cb: (method: string, params: unknown) => void): () => void
}
export interface TabHost {
  readonly id: number                 // page webContents.id
  readonly cdp: CdpClient
  getUrl(): string
  getTitle(): string
  loadUrl(url: string): Promise<void>
  history(action: 'back' | 'forward' | 'reload' | 'stop'): void
  navState(): { loading: boolean; canGoBack: boolean; canGoForward: boolean }
  setShield(state: { visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }): void
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  setVisible(visible: boolean): void
  setOnScreen(onScreen: boolean, bounds?): Promise<void> // panel placement, viewport metrics, physical shield
  capture(): Promise<string>          // data URL from view.webContents.capturePage(), retried
  destroy(): void
}
```

### Command pipeline (`BrowserTab.run`)

Every agent command passes these steps in this order, inside the tab's FIFO queue:

1. **Wait for control:** if `control === 'user'`, wait for hand-back, `call.signal` abort, or the hold timeout.
2. **Acquire:** set `control = 'agent'`, show the shield, renew the lease.
3. **Sensitive check** (`type`, `select`): refuse password and `cc-*` targets, so no approval prompt is wasted.
4. **Site approval** (`click`, `type`, `select`): set `control = 'approval'` and pause the lease while prompting. On
   allow, re-read the origin, and fail as stale if it changed.
5. **Execute** in `cdp-commands.ts`, drawing the shield target first for ref and selector actions.
6. **Decorate:** append pending dialog notes and the "user held this tab" note to the result.

### IPC (`src/shared/ipc.ts`)

| Channel | `AgentApi` method | Returns |
|---|---|---|
| `BrowserTabsList: 'browser-tab:list'` | `browserTabsList(agentId)` | `BrowserTabInfo[]` |
| `BrowserTabCreate: 'browser-tab:create'` | `browserTabCreate(agentId, url?)` | `BrowserTabInfo` (throws at a cap) |
| `BrowserTabClose: 'browser-tab:close'` | `browserTabClose(tabId)` | `void` |
| `BrowserTabActivate: 'browser-tab:activate'` | `browserTabActivate(agentId, tabId)` | `void` |
| `BrowserTabNavigate: 'browser-tab:navigate'` | `browserTabNavigate(tabId, url)` | `void` (rejects non-http(s)) |
| `BrowserTabHistory: 'browser-tab:history'` | `browserTabHistory(tabId, action)` | `void` |
| `BrowserTabLogs: 'browser-tab:logs'` | `browserTabLogs(tabId, kind, limit?)` | `unknown[]` |
| `BrowserTakeOver: 'browser-tab:take-over'` | `browserTakeOver(tabId)` | `void` |
| `BrowserHandBack: 'browser-tab:hand-back'` | `browserHandBack(tabId)` | `void` |
| `BrowserPanelAttach: 'browser-panel:attach'` | `browserPanelAttach(agentId, bounds)` | `void` |
| `BrowserPanelDetach: 'browser-panel:detach'` | `browserPanelDetach()` | `void` |
| `BrowserPanelSetBounds: 'browser-panel:set-bounds'` | `browserPanelSetBounds(bounds)` | `void` |
| `BrowserPanelFreeze: 'browser-panel:freeze'` | `browserPanelFreeze()` | `{ generation: number; image: string \| null } \| null` (null = nothing on screen; a failed capture still returns a generation; view stays visible) |
| `BrowserPanelHideFrozen: 'browser-panel:hide-frozen'` | `browserPanelHideFrozen(generation)` | `void` (ignored if the generation is stale) |
| `BrowserPanelUnfreeze: 'browser-panel:unfreeze'` | `browserPanelUnfreeze()` | `void` (bumps the generation, shows the view) |
| `BrowserClearData: 'browser-panel:clear-data'` | `browserClearData()` | `void` |
| `EventBrowserTabsChanged: 'browser-tab:changed'` | `onBrowserTabsChanged(cb)` | `{ agentId, tabs, activeTabId }` |
| `EventBrowserPanelRequest: 'browser-panel:request'` | `onBrowserPanelRequest(cb)` | `{ agentId }` |
| `EventBrowserShortcut: 'browser-panel:shortcut'` | `onBrowserShortcut(cb)` | `{ action: 'toggle-terminal' \| 'toggle-browser' \| 'focus-url' }` |

## Review Focus

1. **Agent input cannot reach a held tab.** `control === 'user'` blocks at step 1 of the pipeline with no bypass path:
   `browser_handoff`, selector actions and coordinate clicks all go through `BrowserTab.run`.
2. **Approval checks the origin at action time,** both before prompting and after the answer, never from a value cached
   at navigation.
3. **A blocked command always ends:** hand-back, abort and timeout all settle it and remove its listeners. A hidden
   session cannot hang forever, and a `null` ask denies.
4. **No orphans.** Page and shield views are destroyed on tab close, `AgentRemove` and `before-quit`, and the debugger
   detaches first.
5. **Chrome behavior is unchanged** apart from the untrusted-content header (Task 3). Tasks 1–3 must not alter any
   existing bridge test except for its imports and call shape.
6. **Hardening applies to the partition and to every view,** including popups opened through `setWindowOpenHandler`.
7. **`settingsToConfig` drops unlisted keys.** `browser` must be carried through it, or the next settings save erases
   the user's choice (Task 2).
8. **Page, shield and placeholder stay aligned** under window resize, panel resize, zoom and the expanded state.
9. **A tab that is not on screen has the device-metrics override; a tab on screen does not.** S2: without it, an
   off-screen view in a visible window has a 0×0 viewport and every click misses.
10. **An unfreeze always wins.** S1 reproduced a panel stuck frozen when a drag ended during the capture.

## Task 0: Spikes (throwaway branch)

Done: `spike/browser-panel` at `a85ab22`, results in spec §12. Implementation work (Tasks 1–16) goes on branch
`feat/browser-panel`.

Work on branch `spike/browser-panel`. Do **not** merge it. Record results in spec §12 on the main branch, then stop for
review if any gate fails.

- [x] **S1 occlusion:** in the real app, attach a `WebContentsView` over a placeholder. Implement freeze with
      `capturePage` and `setVisible(false)`. Measure the time from dropdown open to visible, on Windows. Drag the
      resizer in both directions across the view. Gate is in spec §12.
- [x] **S2 no panel:** create a view with no panel showing, positioned outside the visible area. With the window both
      visible and hidden to tray, verify `Accessibility.getFullAXTree`, `Input.dispatchMouseEvent`,
      `Input.insertText` and a page `setInterval` counter.
- [x] **S3 shield:** add a transparent view over the page. Verify that a real click does not reach the page, that
      `Input.dispatchMouseEvent` does, and that the page is visible through the shield.
- [x] **S4 memory:** record working set with 1 and 8 tabs on a typical dev page. Adjust `MAX_TABS_TOTAL` only if the
      result argues against 16.
- [x] Update spec §5.3, §6.2, §6.3 with anything the spikes changed, and commit only the spec.

## Task 1: Move shared snapshot code

- [x] Move `src/browser-extension/ax-snapshot.ts` to `src/shared/browser-ax-snapshot.ts`, importing types from
      `./browser-types`. Update `background.ts` and both imports in `tests/unit/browser/ax-snapshot.test.ts`.
- [x] Add to the same module, parameterized by `send: (method, params) => Promise<unknown>`:
      `collectFrameAx(send)`, `waitForPageSettle(send, timeoutMs?)`. Change `background.ts` to call them with a
      `chrome.debugger.sendCommand` closure.
- [x] Add to the same module `readInteractiveTree(send, mode)`, the settle → collect → merge → snapshot sequence now
      inline in the extension's `read` case.
- [x] `src/main/browser/snapshot-output.ts`: `writeSnapshotFile(dir, tree): BrowserCommandResult`, moved from
      `BrowserBridge.saveSnapshot`. `bridge.ts` calls it.
- [x] Run `npm run build:extension`, `npx vitest run tests/unit/browser tests/integration/browser`, and
      `npm run typecheck` (it covers the extension project). No behavior change.

## Task 2: Backend contract, router, Chrome backend, config

- [x] `src/main/browser/browser-backend.ts`: `BrowserCall`, `BrowserBackend`, `BrowserRouterLike` from spec §4.1.
- [x] `src/main/browser/chrome-backend.ts`: wraps `BrowserBridgeLike` + `BrowserLauncherLike`. `start` contains today's
      `browser_start` body; the rest delegate.
- [x] `src/main/browser/browser-router.ts`:
      ```ts
      new BrowserRouter({ backends: { builtin?: BrowserBackend; chrome: BrowserBackend }, defaultBackend: () => 'builtin' | 'chrome' })
      ```
      While `builtin` is absent (until Task 5), it resolves to `chrome`. Selections are held per owner.
- [x] `tools/browser.ts`: `createBrowserTools(router)`. Each `run(input, ctx)` builds a `BrowserCall` through one helper:
      `ownerId = ctx.snapshotAgentId ?? ctx.agentId`. No owner returns `browser: no session context`.
- [x] `browser_start` gains `target?: 'builtin' | 'chrome'`. Rewrite tool descriptions so they are backend-neutral.
- [x] `tools/registry.ts`: `browser?: { router: BrowserRouterLike }`. `index.ts`: build the router in `MainApp`.
- [x] `config.ts`:
      - `MeowConfig.browser?: { backend?: 'builtin' | 'chrome'; siteApproval?: 'ask' | 'off' }` and `normalizeBrowser`
        (invalid values → defaults).
      - Call it in `mergeDefaults` and in `settingsToConfig` (`settings.browser ?? base.browser`).
      - Add to `configToSettings` and `MeowSettings` in `src/shared/types.ts`.
      - Until Task 5, the effective default stays `chrome`, so this commit changes nothing for users.
- [x] Tests:
      - `tests/unit/browser/agent-tools-browser.test.ts`: move to a fake router; add owner resolution from
        `snapshotAgentId` and the no-owner error. `ctx` in that file gains `agentId`.
      - New `tests/unit/browser/browser-router.test.ts`: default, sticky, per-owner isolation.
      - Config test: `browser` survives load and a `settingsToConfig` round trip; invalid values normalize.

## Task 3: Untrusted-content notice

- [x] `snapshot-output.ts`: first line of each file and preview states the content comes from a web page and is data,
      not instructions.
- [x] Add the same statement to the `browser_read`, `browser_console` and `browser_network` descriptions.
- [x] New `tests/unit/browser/snapshot-output.test.ts`: the file and preview both start with the notice, and
      `{ path, size, nodeCount, preview }` is unchanged. `snapshotToText` stays as it is, so
      `tests/unit/browser/snapshot-format.test.ts` is untouched.

## Task 4: `BrowserTab` and CDP commands (no Electron)

- [x] `src/main/browser/cdp-commands.ts`, each a function of `(cdp, refs, params)`:
      - `read`: `readInteractiveTree`, stores `Map<ref, backendNodeId>`, `writeSnapshotFile`.
      - `click`: resolve ref, selector or `x`/`y`; `DOM.scrollIntoViewIfNeeded`; `DOM.getBoxModel` center;
        `Input.dispatchMouseEvent` `mousePressed` + `mouseReleased`.
      - `type`: focus, select all, `Input.insertText`, then `change` via `Runtime.callFunctionOn`.
      - `select`: the value setter + `change` from the extension's `refAction`.
      - `scroll`, `waitFor`: `Runtime.evaluate`.
      - An unknown ref returns `snapshot stale: re-read the page (ref …)`, matching the extension.
- [x] `src/main/browser/browser-tab.ts`: `BrowserTab(host: TabHost)` with the FIFO queue; command dispatch; console and
      network buffers from `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`,
      `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFailed`; ref invalidation on
      `Page.frameNavigated` for the main frame; `toInfo(): BrowserTabInfo`.
- [x] Dialogs: on `Page.javascriptDialogOpening`, accept `alert` and `beforeunload`, dismiss `confirm` and `prompt`
      through `Page.handleJavaScriptDialog`, and queue a note for the next result.
- [x] Add `BrowserTabInfo` and `BrowserTabControl` to `src/shared/browser-types.ts`.
- [x] Tests, with a fake `CdpClient`:
      - `tests/unit/browser/cdp-commands.test.ts`: click coordinates from the box model, stale ref, type sequence.
      - `tests/unit/browser/browser-tab.test.ts`: FIFO order, ref invalidation, buffer caps, dialog handling.

## Task 5: `EmbeddedBrowser`, Electron host, wiring

- [x] `src/main/browser/embedded-browser.ts`, implementing `BrowserBackend`, with an injected
      `createHost(ownerId): TabHost`:
      - Tab creation and caps, per-owner working tab, `navigate`, `openTab`, `switchTab`, `closeTab`, `listTabs`.
      - `start` returns ready, stating the active backend.
      - `removeSession(agentId)`, `closeAll()`, `onTabsChanged`, `onPanelRequest`.
      - `onPanelRequest` fires only for tabs the agent created.
- [x] `src/main/browser/electron-tab-host.ts`:
      - Page `WebContentsView` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload,
        `PARTITION`, `backgroundThrottling: false`.
      - Debugger attached with `Page`, `Runtime`, `Network`, `Log`, `DOM`, `Accessibility` enabled; reattach once on an
        unexpected detach.
      - `setWindowOpenHandler` → new tab of the same owner for http(s), deny otherwise.
      - `will-navigate`, `will-redirect`, `will-frame-navigate` allow `http:`, `https:`, `about:blank` only.
      - `render-process-gone` → crashed state.
      - Attached to `getWindow().contentView` at `DEFAULT_VIEW_BOUNDS`, outside the visible area, with
        `setOnScreen(false)` (`Emulation.setDeviceMetricsOverride` 1280×800, scale 1), per spec §5.3.
      - The shield document (Task 7) and page capture use `view.webContents.capturePage()`, retried on failure;
        `win.capturePage()` excludes child views.
- [x] `hardenBrowserPartition()` in the same file, run once at app ready: permission request and check handlers deny
      all except clipboard write; `will-download` cancels while the tab's control is `agent` or `approval`.
- [x] `index.ts`:
      - Construct `EmbeddedBrowser`; pass it as the `builtin` backend.
      - Default `browser.backend` is now `builtin`.
      - `embedded.removeSession(agentId)` in `Channels.AgentRemove`, beside `terminals.removeSession`.
      - `embedded.closeAll()` in `before-quit`, after `browserBridge.close()`.
      - Reattach tabs when `createWindow` runs again; commands return `browser unavailable: no app window` with none.
- [x] Tests:
      - `tests/unit/browser/embedded-browser.test.ts` with a fake host: caps, working-tab resolution, `removeSession`
        destroys hosts, panel request only for agent-created tabs.
      - New `tests/e2e/browser-agent.spec.ts`: copy the mock LLM from `question-echo.spec.ts`, script
        `browser_navigate` → `browser_read` → `browser_click` against a local fixture HTTP server whose button changes
        the page title, then assert via a final `browser_list_tabs` in the transcript. This proves goal 2 with no UI.
- [x] Docs: `docs/reference/02-architecture.md`, `04-tool-catalog.md`, `06-data-and-storage.md`, `08-integrations.md`;
      `src/main/AGENTS.md`, `src/main/agent/tools/AGENTS.md`, root `AGENTS.md`.

## Task 6: Control state

- [x] `BrowserTab`: the state machine from spec §6.1; `takeOver()`, `handBack()`, `releaseLease()`; lease with an
      injected timer; waiters that settle on hand-back, abort or `USER_HOLD_TIMEOUT_MS`; ref clearing and the resume
      note on hand-back.
- [x] `EmbeddedBrowser.releaseOwner(agentId)`. Call it in the `done`/`error` branch of `meowAgent.setOnEvent` in
      `index.ts`, beside `notifyAgentAvailable`.
- [x] Extend `browser-tab.test.ts` with fake timers: every transition, lease renewal and expiry, waiting with abort and
      timeout, FIFO preserved while the head waits, an in-flight command finishing before Take over applies.

## Task 7: Shield

- [x] `electron-tab-host.ts`: a second `WebContentsView` with `setBackgroundColor('#00000000')`, sandboxed, loading an
      inline `data:` document with the ring and cursor; added above the page; same bounds; `setShield` toggles
      visibility and updates geometry through `executeJavaScript`.
- [x] `BrowserTab`: show the shield in `agent` and `approval`, hide it otherwise. Resolve the target rect from the box
      model and send it before dispatching a click or type.
- [x] `before-input-event` on the shield and page, shared with Task 13.
- [x] Extend `tests/e2e/browser-agent.spec.ts`: with the agent's lease held, a real mouse click at the fixture button
      does not change the page; after the lease ends, it does. Use `app.evaluate` to find the view's bounds.

## Task 8: Site approval

- [x] `src/main/browser/site-approval.ts`: `isLoopback(origin)`, and
      `SiteApprovals { isAllowed(owner, origin); allow(owner, origin); clearOwner(owner) }`.
- [x] Pipeline step 4 in `BrowserTab.run`. Prompt via `call.ask` with header, tool, origin, target name and the three
      options from spec §7.1. `siteApproval: 'off'` skips it. Clear the owner's entries in `removeSession`.
- [x] `tests/unit/browser/site-approval.test.ts`: loopback forms including `*.localhost`, and lookalikes such as
      `localhost.example.com` are **not** exempt. Tab-level: once vs session, deny, `null` ask, origin changed during
      the prompt, `off`.

## Task 9: Sensitive fields and `browser_handoff`

- [x] `cdp-commands.ts`: `isSensitiveTarget(cdp, nodeId)` via `Runtime.callFunctionOn`, checking `type === 'password'`
      or `autocomplete` starting with `cc-`. Pipeline step 3 for `type` and `select`, by ref and by selector; the error
      names `browser_handoff`.
- [x] `BrowserCommandName` gains `handoff`. `BrowserTab.handoff(reason, call)` sets `user` with `holdReason`, blocks
      until hand-back or abort with no timeout, and returns `{ originChanged }`.
- [x] Chrome: `ChromeBackend` returns `browser_handoff is only available in the built-in browser`.
- [x] `tools/browser.ts`: register `browser_handoff`. Update the "registers all tools" test (now 15).
- [x] Check `components/chat/toolSummary.ts`: the category already matches via `startsWith('browser_')`. Add a
      per-tool summary only if the existing fallback reads badly.
- [x] Tests: refusal by ref and selector, no approval prompt on refusal, handoff returns on hand-back and abort,
      `originChanged`, and read output containing no field values with a fixture AX tree carrying a `value`.

## Task 10: IPC contract

- [x] Add every entry of the IPC table to `Channels`, `AgentApi` and preload.
- [x] `registerIpcHandlers` delegates to `EmbeddedBrowser`. `BrowserTabNavigate` validates the scheme in main.
- [x] Forward `onTabsChanged` and `onPanelRequest` to `win.webContents`.
- [x] Panel methods on `EmbeddedBrowser`: `attach(agentId, bounds)`, `detach()`, `setBounds(bounds)`, `freeze()`,
      `hideFrozen(generation)`, `unfreeze()`. Only the panel's active tab is on screen, with `setOnScreen(true, bounds)`;
      `detach` and tab switches return the others to the no-panel placement with `setOnScreen(false)`.
- [x] Unit-test the generation guard: an `unfreeze` during a pending `freeze` leaves the view visible, and a stale
      `hideFrozen` is ignored.
- [x] **Physical shield only for the on-screen tab.** Task 7 measured about 77 MB per shield (+615 MB at 8 tabs), and an
      off-screen tab receives no mouse input anyway; `before-input-event` already blocks keys. `control` and the logical
      shield state stay per tab. The shield view is created when the tab goes on screen with the shield up, and destroyed when
      the tab leaves the screen. Adjust the Task 7 e2e, which asserts a shield with no panel. Re-measure and record the result.
- [x] **Dialogs from off-screen tabs.** Task 7 left `alert`/`confirm` in `user`/`idle` to Electron's native dialog. On a tab that
      is not on screen, that pops up an OS dialog from a page the user is not looking at. An off-screen tab uses the agent rule
      (auto-answer) unless it is in `user` state, and an on-screen tab keeps the native dialog. Update spec §5.2.
- [x] `setBounds` multiplies by `win.webContents.getZoomFactor()`.
- [x] Update `tests/unit/ipc-contract.test.ts`. Unit-test attach, detach and bounds with a fake host.
- [x] Docs: `docs/reference/05-ipc-contract.md`.

## Task 11: Panel UI

- [x] `components/browser/BrowserOverlay.tsx`, on the `TerminalOverlay` skeleton: `files-overlay` chrome, `full` /
      `docked`, tabs via `files-tab`, tab context menu via `BaseDropdown`, `+`, expand, close. Tab list from
      `browserTabsList` + `onBrowserTabsChanged`.
- [x] `BrowserToolbar.tsx`: back, forward, reload or stop, URL input, open externally. Bare hosts are normalized to
      `https://`, loopback hosts to `http://`.
- [x] `BrowserControlBanner.tsx`: `agent` → **Take over**; `user` → **Hand back**, or **I'm signed in** with `holdReason`;
      `approval` → the waiting message. Colors use existing tokens, per the mockup.
- [x] `BrowserViewport.tsx`: placeholder div; attach on mount, detach on unmount; `ResizeObserver` + window resize,
      coalesced per animation frame. Empty state with a **New tab** button when there are no tabs.
- [x] `App.tsx`: `browserOpenFor`, `browserFull`, `handleToggleBrowser`; add the panel to the expanded and docked render
      paths, to `dockedCount`, and to `.main`'s open count. Place it before the terminal in the grid, so the two stack as
      in mockup board 2. `containerWidth` gains the `MIN_DOCKED_WIDTH` term; `meow.rightPanels.width` is not overwritten.
- [x] `onBrowserPanelRequest`: open only if that agent is the active session of the active project.
- [x] `PaneHeader.tsx` + `Pane.tsx`, passed through `SessionPanes.tsx`: Globe toggle beside the terminal button, disabled
      for drafts, with an agent dot while the session has a tab in `agent` or `approval`.
- [x] CSS in `styles.css` (CRLF, see `src/renderer/AGENTS.md`). The grid's `.docked` selector list gains
      `.browser-overlay`.
- [x] Docs: `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `src/renderer/src/components/AGENTS.md`.
- [x] New `tests/e2e/browser-panel.spec.ts`: toggle via the button, load the fixture, two tabs, reload, and the view's
      bounds match the placeholder rect in docked and expanded states.

## Task 12: Occlusion

- [x] `components/common/useBrowserOcclusion.ts`: module-level counter. 0→1 calls `browserPanelFreeze`, publishes the
      image to `BrowserViewport` through a small subscribe function, and after the `<img>` has decoded and painted calls
      `browserPanelHideFrozen(generation)`. Image first, then hide: S1 measured 69 ms and no gap, against 115 ms and a
      two-frame gap the other way round. 1→0 calls `browserPanelUnfreeze`, and a result arriving after that is dropped.
- [x] Call it from `BaseModal`, `BaseDropdown` (while `open`), and the `right-panels-resizer` drag in `App.tsx`.
      `common/AGENTS.md` records the rule.
- [x] Hide the view when another panel is expanded, and when the active project changes away from it.
- [x] Audit fixed overlays that do not use the common components and can overlap the panel, starting with
      `.sidebar-popover` and context panels; add the hook where they can overlap.
- [x] `tests/e2e/browser-panel.spec.ts`: a `BaseDropdown` opened from the panel's tab menu is visible and clickable;
      `ConfirmDialog` is too; the view returns to the same bounds after closing.

## Task 13: Keyboard

- [x] `electron-tab-host.ts`: `before-input-event` on page and shield. Forward `` Ctrl/Cmd+` `` and `Ctrl/Cmd+Shift+B`
      through `EventBrowserShortcut`. Handle `Ctrl/Cmd+L`, `Ctrl/Cmd+R` and `Alt+Left/Right`. Call `preventDefault` on
      each, so `Ctrl+R` does not reach the default menu's reload.
- [x] Renderer: `onBrowserShortcut` runs the same handlers as the window listeners in `Pane.tsx`. Add
      `Ctrl/Cmd+Shift+B` beside the terminal shortcut.
- [x] Pure helper `matchBrowserShortcut(input, platform)` with `tests/unit/browser/browser-shortcuts.test.ts`.
- [x] `tests/e2e/browser-panel.spec.ts`: with focus in the page, `` Ctrl+` `` toggles the terminal.

## Task 14: Drawer and terminal links

- [x] `BrowserDrawer.tsx`: Console and Network tabs, polling `browserTabLogs` every 1.5 s only while open. **Send to chat**
      dispatches the existing `meow:composer-insert` event with `{ agentId, text }`, as `TerminalView` does.
- [x] `TerminalView.tsx`: `registerLinkProvider` for loopback http(s) URLs only. Activation calls
      `browserTabCreate(agentId, url)` and opens the panel through a new `onOpenBrowser` prop from `TerminalOverlay`.
      Pure `findLoopbackLinks(line)` with a unit test, including lookalike hosts.
- [x] `tests/e2e/browser-panel.spec.ts`: drawer shows a fixture `console.error`.
- [x] `tests/e2e/terminal.spec.ts` is unchanged and still passes.

## Task 15: Settings, status bar, compatibility

- [x] `BrowserDialog.tsx`: `BaseSelect` for the default backend, through the existing settings get and save path;
      **Clear browsing data** with `ConfirmDialog`, calling `browserClearData` (`session.clearStorageData`).
- [x] `StatusBar.tsx`: the pill shows the default backend. For `chrome`, it keeps today's bridge status.
- [x] Confirm `browser_start` output states the active backend.
- [x] Docs: `docs/reference/08-integrations.md` (both backends, and the limits in spec §7.3), `09-ui-guide.md`.

## Task 16: Final verification

- [x] `npm run typecheck`, `npm test`, `npm run build && npm run e2e`. Unit: 1916 passed, 1 skipped. E2E: 56 passed, 11 failed. The same
      11 fail on `master` (40 passed): `smoke` 3, `menus` 2, `selectors` 2, `sidebar-sessions` 3, and the flaky `composer` drain test.
- [ ] Manual, in `npm run dev`: walk mockup boards 1, 2, 4 and 5 and record any difference in the spec.
- [ ] Manual, from spec §12: flicker when opening a menu over the panel, the real resizer in the grid, and shield drawing
      quality. Long-run memory and macOS/Linux stay open until those builds ship.
- [ ] Manual: delete a session with open tabs and quit the app, then confirm in Task Manager that no renderer processes
      remain.
- [ ] Update `docs/superpowers/specs/2026-11-09-builtin-browser-panel-design.md` status to implemented and record final
      limits.
