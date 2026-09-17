# Meow Coding — IDE Extension (VSCode/Cursor) — Phase 1: Chat Panel + Context Sharing: Design Spec

Status: pending review · 2026-09-17

## 0. Scope of this document

This spec covers **Phase 1 only** of the IDE extension: an in-IDE **chat panel** that shares a
**session** with the Meow Coding desktop app, plus **context sharing** (open files + editor
selection). Phase 2 adds *select-code → ask/edit* and *slash commands*; Phase 3 adds *inline
completion*. Each phase is its own spec + implementation plan. This spec deliberately excludes the
Phase 2/3 items (see §9 YAGNI).

The extension package targets **both VSCode and Cursor** (Cursor is VSCode-fork-compatible; one
extension package runs in both, tested on each).

## 1. Goals

- Let the user chat with the native **Meow agent** inside a VSCode/Cursor webview panel, for the
  project currently open in the editor.
- The IDE chat **is the same session** rendered in the desktop app: messages and agent state stay in
  sync in both places in real time (two-way).
- Let the agent read open files and the current editor selection of the IDE as context, without a
  file-content transfer channel (workspace folder == the app's project folder).
- Reuse the app's existing agent runtime, providers, sessions, permissions, MCP/LSP, and `meow.json`.

### Non-functional requirements

- **Loopback-only** connection (`127.0.0.1`); never bind a network interface.
- Connection authenticated with a **pairing code** (6 digits); app running locally on the same machine.
- IDE chat reflects desktop state with low latency; agent output streams live.
- No new source-of-truth: all state lives in the **main process agent runtime**, so desktop app and
  IDE observe the same run. The IDE is never an independent write authority.

## 2. Design decisions

| Topic | Decision |
|---|---|
| Target editors | One **VSCode extension package**, works in VSCode and Cursor (Cursor is VSCode-compatible) |
| Channel IDE ↔ app | **Localhost WebSocket** served by the app (an `IdeBridge`), extension is the WS client → out to `ws://127.0.0.1:<port>` (mirrors BrowserBridge) |
| Connection type | **Loopback only** (`127.0.0.1`), preferred port **3930**, `GET /api/status` for discovery |
| Auth | **Pairing code** 6 digits, short TTL on first pair; once `sessionPaired`, reconnect re-pairs silently with the same code (mirrors BrowserBridge) |
| Peers | Exactly **one** IDE socket at a time; a new connection closes the previous one |
| Session relationship | **Shared session** with the desktop app: extension does `subscribe_session { projectPath }` to the active session of that project; it does **not** create its own separate session |
| Display | The webview shows **the single active session** for the opened project (1 chat per project) |
| Context source | Agent reads files directly on disk in the project folder; extension sends lightweight metadata (active file, selections) only — no file-upload content channel |
| Write authority | Agent changes are applied on disk by the app's main process (existing edit/apply-patch path); IDE picks them up through its own file watcher. **No** `WorkspaceEdit.apply` in Phase 1 |
| Apply in IDE | **Out of Phase 1** (Phase 2 handles "select → ask/edit" with diff/apply presentation) |
| Identity / name | Extension product name **"Meow Coding"** |
| Install/pair UX | Extension status-bar command to pair (enter 6-digit code), auto-discovery of bridge port; mirrors Chrome extension popup philosophy |
| New dependency | `ws` (already present) for the WS server; VSCode extension uses `vscode` API (no extra runtime dep) |

## 3. Architecture

```
┌─ VSCode / Cursor ─────────────────┐     ┌─ Meow Coding app (Electron main) ────┐
│  IDE extension (TS/Node)           │ WS   │  IdeBridge (main)                    │
│  • extension host                  │◀───▶│  • HTTP+WS 127.0.0.1:3930           │
│    + WS client + pairing          │      │  • pairing 6-digit, TTL 5 min        │
│    + subscribe_session + send     │      │  • one peer at a time                 │
│  • webview panel (chat render)    │      └────┬────────────────────────────────┘
│  • context: activeFile + selection │           │ (in-process)
└───────────────────────────────────┘   ┌───────▼─────────┐
                                        │ agent runtime:   │
                                        │ sessions, ChatEvent,
                                        │ PromptState, apply
                                        └───────────────────┘
```

- **IdeBridge** lives at `src/main/ide/bridge.ts`, modeled on `src/main/browser/bridge.ts` (loopback,
  pair code, one peer, status machine, pending-message timeout).
- Message types are **IDE-centric** (unlike BrowserBridge's browser commands): subscribe to a session,
  forward `ChatEvent` / `PromptStateEvent`, send prompts.
- `src/shared/ide-types.ts` — protocol types (must not import Node/Electron), parallel to
  `src/shared/browser-types.ts`.
- The IDE extension host keeps the WS + manages pairing + sends context; the webview renders chat
  using `ChatEvent` messages.

## 4. Protocol (extension ↔ IdeBridge) — Phase 1

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| ext → bridge | `pair` | `{ code }` | Redeem the pairing code |
| bridge → ext | `pair_result` | `{ ok, error? }` | Result of pairing |
| ext → bridge | `subscribe_session` | `{ projectPath }` | Attach to the active session of the project |
| bridge → ext | `session_state` | `{ projectPath, sessionId?, messages, pending }` | Snapshot of the current conversation on subscribe |
| bridge → ext | `chat_event` | `ChatEvent` | Live stream while the agent runs |
| bridge → ext | `prompt_state` | `PromptStateEvent` | Agent waiting on user input? |
| ext → bridge | `send` | `{ projectPath, text, context }` | Send a prompt; `context` = active file + selections |
| ext → bridge | `select_session` | `{ projectPath }` | (re)select the active session after reconnect |
| ext ↔ bridge | `ping` / `pong` | — | Keepalive |

**Shared-session mechanism.** The IDE never spawns its own runtime session. It sends
`subscribe_session { projectPath }`; main locates the **active session** of that project and starts
forwarding its `ChatEvent` / `PromptStateEvent` to the socket. Because state lives in main, the
desktop app and the IDE render the same run — two-way sync falls out for free.

## 5. Data flow — detailed

**Chat rendering.** Extension sends `subscribe_session { projectPath }` → main resolves the active
session → returns `session_state` (current message snapshot) → subsequent agent output raises
`chat_event` → webview appends. A prompt typed in the IDE goes via `send` → main feeds it into the
agent loop at the same place as a desktop prompt → all subscribed UIs (desktop + IDE) receive
`chat_event` and display identically.

**Context (file + selection).** `send.context` carries lightweight metadata only:

```
{ projectPath, activeFilePath?, selections: [{ file, start, end }], diagnostic? }
```

No file content is transferred: the agent already edits files on disk inside the project folder.
This keeps the protocol light and low-latency, and defers content-heavy work to Phase 3 (inline
completion uses the same editor context).

**Apply.** If the agent modifies files, main writes them to disk through the existing path (editor
state remains in main). VSCode/Cursor reflect changes via their own file watcher. Phase 1 does not
render diffs or apply via `WorkspaceEdit`.

## 6. Pairing & security

- Loopback-only; never binds a network interface (matches repo rule).
- Extension asks the user for the 6-digit pairing code via a status-bar picker (mirrors the Chrome
  popup pairing UX). Only the `pair` message needs the code.
- `GET http://127.0.0.1:3930/api/status` (CORS-open) returns `{ port, status }` for port discovery.
- Exactly one IDE socket at a time; a new connection closes the previous one.
- Once `sessionPaired`, a reconnect with the same code re-pairs silently (VSCode extension host is
  long-lived Node, so drops are rare, but the safety mechanism is kept — mirroring BrowserBridge).
- The extension only reads/controls through the bridge; config/permission decisions stay in the app
  (and `meow.json`). The IDE never bypasses the app's permission rules.

## 7. Error handling

- **Bridge not running / not paired:** `subscribe_session`/`send` fail → webview shows "Meow Coding app
  not running / not paired" with a Retry action and install/where-to-pair guidance.
- **Agent waiting on input** (`prompt_state.pending = true`): webview shows a "waiting on you" state;
  it does not enqueue a second prompt simultaneously.
- **Disconnect:** extension host reconnects with backoff; on reconnect it re-`subscribe_session` to
  fetch the latest snapshot; the webview keeps already-rendered history.
- **No active session yet:** if the project has none, main creates/marks one the same way the desktop UI
  does when a project opens.
- **One-peer conflict:** if a second IDE instance connects, the first is closed and its webview offers
  reconnect.

## 8. Testing

- **Unit:** IdeBridge logic (pairing, one-peer, timeout, reconnect re-pair), port/status discovery —
  modeled on tested BrowserBridge units.
- **Integration:** fake a WS client, simulate an agent run through the bridge → assert `chat_event`
  stream reaches the extension host; `send` → agent receives the prompt.
- **E2E (after `npm run build`):** launch app, open VSCode with the extension loaded unpacked, pair,
  open the chat panel, send a prompt; assert the desktop app and IDE show the same conversation.
- **Required before completion:** `npm run typecheck` passes; `npm test` passes.

## 9. YAGNI (explicitly out of Phase 1)

- Phase 2: select code → ask/edit with diff/apply; slash commands in the editor.
- Phase 3: inline completion (ghost text while typing).
- A file-content transfer channel (avoided: project folder == agent project, files read on disk).
- Remote/relay connection (local loopback only; a relay is future work and over-engineering for MVP).

## 10. File layout (Phase 1)

```
src/main/ide/
  bridge.ts                      # WS server + pairing + session subscribe/forward + send
  install-guide.ts               # [meow] pairing + install guidance text
src/shared/ide-types.ts          # protocol types (no Node/Electron import)
src/shared/ipc.ts                # + Ide:* channels via Channels
src/preload/index.ts             # + window.api.ide.*
extension/ide/                   # the VSCode/Cursor extension package (separate build)
  package.json
  src/extension.ts               # activation, status-bar pair command, WS client + pairing
  src/webview/chat-panel.ts      # webview panel: chat render, send, context collection
  src/webview/views/chat.html    # + chat.js/css (or TS built)
electron.vite.config.ts          # + build entry for the extension
tsconfig.json / new tscofnig      # typecheck for the extension package
tests/unit/ide/                  # bridge pairing, one-peer, timeout, reconnect
tests/integration/ide/           # IdeBridge + fake WS client → chat_event/send flow
docs/reference/                  # updated per the documentation-sync rule
```

## 11. Open questions (resolve during planning)

- Which session does "active session of a project" map to when multiple sessions exist for the same
  project on the desktop (currently the desktop shows one session per project; confirm semantics).
- VSCode extension packaging: whether to ship VSIX (marketplace) or Load-unpacked folder for MVP
  (aligned with the Chrome Load-unpacked pattern; likely Load-unpacked + `--extensionDevelopmentPath`).

## 12. References

- Format mirrors `2026-08-10-meow-browser-extension-design.md` (browser bridge precedent).
- Browser bridge reality: `src/main/browser/bridge.ts`, `src/shared/browser-types.ts`,
  `src/browser-extension/` (MV3), `docs/reference/08-integrations.md` §8.3.
- Agent runtime / event contract: `docs/reference/05-ipc-contract.md` (`ChatEvent`,
  `PromptStateEvent`), `docs/reference/03-agent-runtime.md`.
- Conventions: AGENTS.md (loopback-only, `[meow]` prefix, docs/source in English for this repo, IPC via
  `Channels`, main-process-write-only).
