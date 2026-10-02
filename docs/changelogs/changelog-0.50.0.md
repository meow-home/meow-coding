# Changelog — Meow Coding v0.49.1 → v0.50.0

## 🚀 New Features

### One-click Browser Bridge approval
- Connecting the Meow Chrome extension no longer needs a 6-digit pairing code typed by hand. The extension announces its own id on connect and the app asks once — **Allow** / **Deny** — with a single click.
- An approved extension id pairs silently on every later connection, including after an MV3 service-worker restart, so the code never goes stale and never has to be re-entered.
- The approval dialog lists the **trusted extensions** with a **Revoke** action per row; revoking disconnects that extension immediately.
- Trust is an extension-id allowlist (`userData/browser-trusted.json`) plus an `Origin` check: a `hello` is accepted only when the handshake origin equals `chrome-extension://<claimed id>`, so a web page cannot impersonate an approved id.
- An unknown connection parks the socket in a new `pending` state for 2 minutes instead of evicting the paired one; if nobody decides, the socket closes and the bridge returns to `listening`.
- The status bar pill and the Browser Bridge dialog gained the `pending` state ("browser: approval needed"), and the dialog opens automatically when an approval is waiting — `browser_start` may be blocked on it while you are elsewhere in the app.
- The extension popup drops the pairing-code input and shows "Waiting for approval in Meow" instead.

## 🐛 Bug Fixes
- Browser: the approval state machine now tracks the pending socket separately from the paired one, so a pending socket disconnecting clears the approval instead of leaving the dialog stuck, and a pending TTL expiry no longer overwrites the status it just set.

## 🧹 Internal & Docs
- Removed the pairing-code layer end to end: `pair()` on the bridge, `BrowserPair`/`pairBrowser()` over IPC, `PairMessage`/`PairResultMessage`/`PairingInfo`, and the `sessionPaired` flag (the durable allowlist makes reconnect trust immediate, so the TTL workaround is gone).
- New IPC channels `BrowserApproveExtension`, `BrowserDenyExtension`, `BrowserRevokeExtension` and `BrowserGetTrustedExtensions`, plus `src/main/browser/trusted-store.ts` on the shared `createJsonStore` pattern.
- New `hello` / `hello_result` handshake types in `src/shared/browser-types.ts`; `BrowserStatus` gains `pending` and `BrowserStatusInfo` carries `pendingExtension`.
- Added the design spec and implementation plan under `docs/superpowers/`, and updated the reference pages (product overview, tool catalog, IPC contract, storage, integrations, UI guide, conventions), the root `README.md` and the affected `AGENTS.md` files.
- Bumped version to 0.50.0.
