# Browser Bridge — One-Click Extension Approval — Design

Date: 2026-10-02 · Status: draft
Touches: `src/main/browser/bridge.ts`, `src/browser-extension/`, `src/renderer/src/components/BrowserDialog.tsx`,
`src/shared/browser-types.ts`, `src/shared/ipc.ts`.

## 1. Problem and evidence

Pairing the Meow Chrome extension today means typing a code by hand:

- `BrowserBridge.start()` mints a 6-digit code (`randomInt(0, 1_000_000)`), TTL 5 minutes
  (`src/main/browser/bridge.ts`).
- The renderer shows it in `BrowserDialog` ("Pairing Passcode", `pairBrowser()` → `Channels.BrowserPair`).
- The user opens the extension popup and types the code into `#code` (`src/browser-extension/popup.html`),
  which stores it under `chrome.storage.local.meowBridge` and sends `{ type: 'pair', code }` over the
  loopback WebSocket; `handlePair` compares strings.

The friction is the copy/type step, and it repeats whenever the stored code goes stale.

Security context that must be preserved: the WS server accepts **any** connection on `127.0.0.1:3927`
and never inspects the `Origin` header. The pairing code is the only thing preventing an arbitrary web
page (or any local process) from driving the user's real Chrome profile. Removing the code without a
replacement gate would be a security regression, so this design replaces the code with an equivalent
gate rather than dropping it.

## 2. Goal and success criteria

Replace code entry with a one-click approval in the app, keeping the same trust level.

Success:

- First connection from an unknown extension: the app asks once ("Extension `<id>` wants to connect —
  Allow / Deny"); Allow is a single click, no typing, no copying.
- Every later connection from an approved extension ID pairs silently, including after an MV3 service
  worker restart.
- A connection whose `Origin` is not `chrome-extension://<claimed id>` is rejected even if it claims an
  approved ID.
- Deny closes the socket and returns the bridge to `listening`; revoking an approved ID disconnects it
  immediately.
- `npm run typecheck` and `npm test` pass.

Out of scope: Chrome native messaging (`chrome.runtime.connectNative`); changing the loopback host/port;
changing the command/result/event protocol; changing `browser_*` tool schemas; pinning the extension ID
with a `"key"` in `manifest.json` (deferred — see §9).

## 3. Approach

Trust moves from a shared secret typed by the user to an **extension-ID allowlist plus an `Origin`
check**, with the first connection approved interactively in the app.

Rejected alternatives:

- **Pure TOFU** (auto-trust the first connection, notify only): fastest, but a web page or local process
  racing the first connection would win silently. The interactive first approval costs one click and
  removes that window.
- **Token baked into the extension folder** (`ensureExtensionInstalled` already copies the built
  extension into `userData/browser-extension` on every launch, so the app could write a secret file the
  extension reads): no prompt at all, but the secret is a static file on disk and the extension would
  need `fetch`/`web_accessible_resources` plumbing to read it. Kept as the fallback if the `Origin`
  assumption in §4.1 does not hold.
- **Native messaging**: removes the port and the code entirely, but replaces the whole transport and
  requires a host manifest registered per Chrome install. Larger change than the problem warrants.

## 4. Design

### 4.1 Trust gate

1. When the WebSocket opens, the extension sends `{ type: 'hello', extensionId, version? }` using
   `chrome.runtime.id`.
2. The bridge validates identity against the **handshake `Origin` header**, not the claimed string:
   accept only when `req.headers.origin === 'chrome-extension://' + extensionId`. Chrome sends
   `Origin: chrome-extension://<id>` for a WebSocket opened from an extension service worker; a web page
   sends its own `https://…` origin and therefore cannot impersonate an approved ID. This is the piece
   the current design lacks.
3. `extensionId` in the allowlist → `{ type: 'hello_result', ok: true, paired: true }`, status `paired`,
   no prompt.
4. Unknown `extensionId` → `{ type: 'hello_result', ok: true, paired: false, pending: true }`, status
   `pending`, and a status event carrying `pendingExtension` so the renderer can ask.
5. Origin mismatch → `{ type: 'hello_result', ok: false, error: 'origin mismatch' }` and close the socket.

**Assumption to verify first (step 1 of the plan):** that Chrome sends `Origin: chrome-extension://<id>`
on a WebSocket handshake from an MV3 service worker. Verify with a real extension before building the
rest; if it does not hold, switch to the baked-token fallback in §3.

### 4.2 Allowlist storage

`userData/browser-trusted.json` via `createJsonStore` (`src/main/json-store.ts`), same pattern as
`permissions.json`:

```jsonc
{ "extensions": [ { "id": "…", "version": "0.3.4", "approvedAt": 1759400000000 } ] }
```

A missing file means an empty allowlist. `BrowserBridgeDeps` gains an optional store so tests can inject
one; when absent the bridge keeps the list in memory only.

### 4.3 State machine

`BrowserStatus` becomes `idle | listening | pending | paired | disconnected | error`.

- `start()` no longer mints a code; the bridge starts in `listening`.
- `sessionPaired` is **removed**. It existed only to work around the code TTL on reconnect; a durable
  allowlist makes reconnect trust immediate, so the flag and the TTL both disappear.
- **A paired connection is not evicted by an unknown one.** Today a new socket closes the previous one.
  New behavior: while `paired`, an unknown-ID connection is rejected and closed without touching the
  paired socket. An approved-ID connection still replaces the previous socket (the MV3 worker may have
  restarted and left a stale one).
- **Pending TTL 2 minutes** (`pendingTtlMs` dep, default `120_000`): if nobody approves, the socket is
  closed and the status returns to `listening`.
- `close()` keeps rejecting pending commands with `browser bridge closed`; it also clears the pending
  approval and its timer.

### 4.4 Protocol types (`src/shared/browser-types.ts`)

```ts
export type BrowserStatus = 'idle' | 'listening' | 'pending' | 'paired' | 'disconnected' | 'error'

export interface PendingExtensionInfo {
  extensionId: string
  version?: string
  requestedAt: number
}

export interface BrowserStatusInfo {
  status: BrowserStatus
  port: number
  paired: boolean
  pendingExtension?: PendingExtensionInfo
}

export interface HelloMessage { type: 'hello'; extensionId: string; version?: string }
export interface HelloResultMessage {
  type: 'hello_result'; ok: boolean; paired: boolean; pending?: boolean; error?: string
}
```

Removed: `PairMessage`, `PairResultMessage`, `PairingInfo`, and `BrowserStatusInfo.pairingCode` /
`pairingExpiresAt`. `ExtensionToBridge` = `HelloMessage | ResultMessage | EventMessage | PingMessage`.

### 4.5 Bridge API

- Removed: `pair()`.
- Added: `approveExtension(extensionId: string): BrowserStatusInfo` — appends to the allowlist, sends
  `hello_result { ok: true, paired: true }` on the pending socket, sets `paired`.
- Added: `denyExtension(extensionId: string): BrowserStatusInfo` — closes the pending socket, clears the
  pending approval, back to `listening`.
- Added: `revokeExtension(extensionId: string): BrowserStatusInfo` — removes from the allowlist; if that
  ID is the connected one, close the socket and go to `listening`.
- Added: `getTrustedExtensions(): TrustedExtension[]` for the dialog's list.

### 4.6 IPC (`src/shared/ipc.ts`, preload, `src/main/index.ts`)

- Removed: `BrowserPair` / `pairBrowser()`.
- Added: `BrowserApproveExtension: 'browser:approve-extension'` → `approveBrowserExtension(id): Promise<BrowserStatusInfo>`
- Added: `BrowserDenyExtension: 'browser:deny-extension'` → `denyBrowserExtension(id): Promise<BrowserStatusInfo>`
- Added: `BrowserRevokeExtension: 'browser:revoke-extension'` → `revokeBrowserExtension(id): Promise<BrowserStatusInfo>`
- Added: `BrowserGetTrustedExtensions: 'browser:get-trusted-extensions'` → `getBrowserTrustedExtensions(): Promise<TrustedExtension[]>`
- No new event channel: `pendingExtension` rides the existing `EventBrowserStatus`.

### 4.7 Extension (`src/browser-extension/`)

- `background.ts`: on `open`, send `hello` with `chrome.runtime.id` and `chrome.runtime.getManifest().version`.
  Handle `hello_result`: `paired: true` → `paired = true`, persist `{ connected: true }`; `pending: true` →
  stay connected, surface "Waiting for approval in Meow" to the popup; `ok: false` → close and back off.
  Drop `code` from `StoredState` (a stale `code` key in `chrome.storage.local` is ignored).
- `popup.html` / `popup.ts`: remove the "Pairing code" row and the `#code` input; keep port + Detect;
  status text gains "Waiting for approval in Meow"; hint becomes "Approve this extension in Meow →
  Browser Bridge."

### 4.8 Renderer

- `BrowserDialog.tsx`: remove the "Pairing Passcode" block and the "New Pairing Code" button. Add an
  approval card (extension ID, version, **Allow** / **Deny**) when `status.pendingExtension` is set, and
  a "Trusted extensions" list with **Revoke** per row when paired.
- `App.tsx`: when a status event carries `pendingExtension`, open the approval modal automatically —
  `browser_start` may be waiting on it while the user is elsewhere in the app (same pattern as
  `EventBrowserOpenInstallGuide` → `InstallGuideDialog`).
- `StatusBar.tsx`: the bridge pill gains a `pending` state (amber, "Approval needed").

### 4.9 `browser_start` tool

`src/main/agent/tools/browser.ts` keeps `openChrome()` + `showInstallGuide()` + `waitForPaired(60_000)`.
The failure message changes from "check the pairing code in the extension popup" to "approve the
extension in Meow → Browser Bridge".

## 5. Migration

An already-paired user updates the app; `ensureExtensionInstalled` re-copies the rebuilt extension into
`userData/browser-extension` on launch, so the extension always matches the app. The extension then
sends `hello` with an ID that is not in the (nonexistent) allowlist → one approval prompt → done. No
manual step, no need to clear `chrome.storage.local`.

## 6. Testing

- `tests/integration/browser/bridge-flow.test.ts`: `fakeExtension` sends `hello` and a simulated
  `Origin`; existing command/event cases keep passing. New cases: unknown ID → `pending`; approve →
  `paired`; deny → socket closed, status `listening`; origin mismatch → rejected; unknown ID while
  `paired` does not evict the paired socket; pending TTL expiry; revoke disconnects.
- `tests/unit/ipc-contract.test.ts`: replace `pairBrowser` with the three new methods and update the
  `Channels` assertions.
- New unit test for the allowlist store (add / read / revoke / missing file).
- E2E: no browser-bridge e2e exists today; re-check when implementing and update if one was added.

## 7. Docs to update

`docs/reference/08-integrations.md` (protocol table, pairing section, extension section),
`05-ipc-contract.md` (channel table), `06-data-and-storage.md` (`browser-trusted.json`, `127.0.0.1:3927`
row), `04-tool-catalog.md` (`browser_start` description), `09-ui-guide.md` (BrowserDialog),
`11-conventions-and-pitfalls.md` ("requires a pairing code"), `01-product-overview.md` (glossary
"Bridge"). Plus `src/browser-extension/AGENTS.md` if one exists for that module.

## 8. Risks

1. **`Origin` on MV3 service-worker WebSockets** — the foundation of the gate; verified in step 1, with
   the baked-token fallback (§3) if it fails.
2. **Auto-opened approval modal** can interrupt typing; accepted, since it fires only for a first-time or
   unknown extension.
3. **Revoke while connected** must close the socket immediately, otherwise revocation only takes effect
   on the next reconnect.
4. **Extension ID changes** if the user re-loads the extension from a different path — the allowlist then
   holds a stale ID and the user approves once more. Pinning the ID via `manifest.json` `"key"` (§9)
   removes this.

## 9. Deferred

- `"key"` in `manifest.json` to pin the extension ID across installs.
- Multi-extension support in the UI beyond the flat trusted list (the allowlist already stores a list).
