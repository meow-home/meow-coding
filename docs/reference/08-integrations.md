# 08 — Integrations

Five external-system integrations plus one companion service.

## 8.1 MCP (Model Context Protocol)

`src/main/agent/mcp/manager.ts`, using `@modelcontextprotocol/sdk`.

### Configuration

`meow.json` `mcp` maps a server name to either a stdio spawn or an HTTP endpoint:

```jsonc
"mcp": {
  "playwright":  { "command": "npx", "args": ["-y", "@playwright/mcp@latest"], "env": {} },
  "remote-tool": { "url": "https://mcp.example.com/sse", "headers": { "Authorization": "Bearer secret-token" } }
}
```

A `command` containing spaces is split into `command` + `args` on load when `args` is empty.

### Lifecycle

`McpManager.connect(servers, projectPath)` closes everything, then for each server:

1. Create a `Client({ name: 'meow-coding', version: '0.1.0' })` advertising the `roots` capability.
2. Register a `ListRootsRequestSchema` handler returning the project directory as a root URI —
   Playwright MCP and similar servers ask the client for workspace roots and anchor file access and
   output directories on them.
3. Build the transport: `StdioClientTransport` (spawned through `buildSpawnCommand`, so Windows
   `.cmd` shims work), `SSEClientTransport`, or `StreamableHTTPClientTransport`. HTTP endpoints support `transportType` (`auto`, `sse`, `streamable-http`) with automatic fallback from SSE to Streamable HTTP when set to `auto`.
4. `connect()`, then `listTools()`.
5. Record status `connected` with the tool names, or `error` with the message. **A failing server
   never crashes the app** — it just shows as `error` in Settings → MCP.

`getTools()` returns `ToolDefinition`s wrapping each MCP tool. `closeAll()` runs on dispose.

### Output cap

The `run` wrapper truncates output exceeding `mcpOutput.maxTokens` (default
`DEFAULT_MCP_OUTPUT_TOKENS = 25000`) into a head/tail preview plus the path of the full text written
by `TruncationStore`. Without this a single verbose MCP call could consume the entire context.

### Wiring

MCP tools are merged into the agent tool map in `MeowAgentManager.syncTools()`, after user tools.
`syncTools()` runs on `init()`, `reload()` (i.e. after any settings save) and `reconnectMcp()`.
Status is surfaced through `Channels.McpStatus`.

**Permission note:** MCP tool names come from the server, so they match no default permission rule
and fall through to `ask` until the user adds one.

## 8.2 LSP (Language Server Protocol)

`src/main/agent/lsp/`.

| File | Role |
|---|---|
| `servers.ts` | The server registry and `serverFor(ext)` / `serverByName(name)` lookups |
| `client.ts` | One stdio LSP client: initialize, `textDocument/didOpen`/`didChange`, collect `textDocument/publishDiagnostics` |
| `manager.ts` | `LspManager` — a client per language; `diagnosticsText(filePath, text)` returns a summary string; `dispose()` on shutdown |

Registered servers:

| Key | Command | Extensions |
|---|---|---|
| `typescript` | `typescript-language-server --stdio` | ts, tsx, js, jsx, mjs, cjs |
| `eslint` | `vscode-eslint-language-server --stdio` | js, jsx, ts, tsx |
| `biome` | `biome lsp-proxy` | js, jsx, ts, tsx, json |

Behavior:

- Runs **only in the main process**; the renderer never talks to LSP.
- Errors are swallowed per client — an offline or unsupported language yields no diagnostics, not a
  crash.
- Disabled entirely when `meow.json` `lsp.enabled` is `false`; `LspManager` is optional in
  `MeowAgentManagerDeps`.
- Two consumers: `ToolContext.diagnostics` (so `write` and `edit` append diagnostics to their tool
  output automatically) and the explicit `lsp` tool (`goToDefinition`, `findReferences`, `hover`,
  `documentSymbol`).
- `lsp.diagnosticsTimeoutMs` defaults to 3000.

## 8.3 Chrome browser bridge

Lets the agent drive the user's **real** Chrome profile — logged-in sessions, real extensions, real
cookies — instead of a throwaway automation profile.

```
BrowserBridge (main)                    Meow Browser Bridge (Chrome MV3 extension)
  HTTP+WS on 127.0.0.1:3927   ◀────────▶  background service worker
  extension-id allowlist + Origin check   + content script (<all_urls>)
  pending command map                     + debugger API for console/network
```

### Protocol (`src/shared/browser-types.ts`)

| Direction | Message | Purpose |
|---|---|---|
| ext → bridge | `{ type: 'hello', extensionId, version? }` | Announce the extension id on connect |
| bridge → ext | `{ type: 'hello_result', ok, paired, pending?, error? }` | Trusted (silent pair), pending approval, or rejected |
| bridge → ext | `{ type: 'cmd', id, name, params }` | Execute a command |
| ext → bridge | `{ type: 'result', id, ok, data? \| error }` | Command result |
| ext → bridge | `{ type: 'event', name, data }` | `console`, `network`, `domChanged`, `tabUpdated`, `status` |
| ext ↔ bridge | `ping` / `pong` | Keepalive |

`BrowserStatus` ∈ `idle` | `listening` | `pending` | `paired` | `disconnected` | `error`.

`GET http://127.0.0.1:3927/api/status` returns `{ port, status }` (CORS-open) so the extension popup
can discover the bridge.

### Bridge behavior

- **Loopback only** (`127.0.0.1`), preferred port `3927`.
- Exactly **one** trusted extension socket at a time; a trusted id reconnecting replaces the previous
  socket, while an unknown connection is rejected without touching the paired one.
- Trust is an **extension-id allowlist** (`userData/browser-trusted.json`) plus an `Origin` check: a
  `hello` is accepted only when the handshake `Origin` equals `chrome-extension://<claimed id>`, so a
  web page cannot impersonate an approved id. A local process can forge the header, but it could
  already read the pairing code from the same machine — the gate is against the browser, not the OS. A trusted id pairs silently on every
  reconnect (MV3 service workers get suspended while idle and drop the WebSocket); an unknown id parks
  the socket in `pending` for 2 minutes until the renderer approves or denies it.
- A connection that is not the trusted socket has its `result` / `event` / `ping` messages ignored, and
  a paired socket is never evicted by an unknown connection.
- Commands time out after **30s**; every pending command is rejected with
  `browser bridge closed` on shutdown.
- Result post-processing:
  - a payload containing `base64` is written to `userData/browser-screenshots/browser-<ts>.png` and
    the tool receives `{ path }`
  - a payload containing a `tree` is rendered by `snapshotToText` into
    `userData/browser-snapshots/browser-snapshot-<ts>.txt`; the tool receives
    `{ path, size, nodeCount, preview }` where the preview is the first 80 lines
- Console and network events are ring-buffered (default 200 entries each) and exposed both to the
  agent (`browser_console` / `browser_network`) and to the renderer
  (`getBrowserConsoleLogs` / `getBrowserNetworkLogs`).

### The extension (`src/browser-extension/`)

Manifest V3, name **Meow Browser Bridge**.

| Field | Value |
|---|---|
| `permissions` | `tabs`, `scripting`, `storage`, `debugger`, `tabGroups`, `alarms` |
| `host_permissions` | `<all_urls>` |
| `background` | `background.js` (service worker) — the WS client and command dispatcher |
| `content_scripts` | `content.js` on `<all_urls>` at `document_idle` |
| `action` | `popup.html` — bridge port and connection status |

Other sources: `ax-snapshot.ts` (accessibility-tree snapshot producing `role "name" [ref]` lines) and
`debug-session.ts` (Chrome debugger attach for console/network capture).

Build: `npm run build:extension` (esbuild, `scripts/build-extension.mjs`) → `out/browser-extension`.
This runs automatically via `predev` / `prebuild` / `predist*`.

### Install flow

1. On startup, `ensureExtensionInstalled(source, userData/browser-extension)` copies the built
   extension into `userData`. It **always re-syncs** rather than comparing manifest versions — a
   version comparison silently stops propagating source changes (new icons, for example) whenever a
   commit forgets to bump the manifest.
2. `browser_start` (or the Browser dialog) calls `showInstallGuide()`, which pushes
   `EventBrowserOpenInstallGuide` so the renderer opens an in-app dialog (not a native message box).
3. `openChrome()` launches the resolved Chrome executable at `chrome://extensions`, or falls back to
   `shell.openExternal`.
4. `openExtensionFolder()` reveals `userData/browser-extension` so the user can "Load unpacked".
5. The extension announces its id; the app asks once ("Extension `<id>` wants to connect") and the
   user clicks **Allow**. Later connections from that id are silent.

**Design constraint:** the bridge runs on the user's real Chrome profile. Do **not** add a
per-project profile.

## 8.4 OfficeCLI

`src/main/officecli/binary-manager.ts` + `agent/tools/office.ts`.

`OfficeCliBinary.resolveBinaryPath(signal)` resolves in order: a binary already on `PATH` → a
previously downloaded copy under `userData` → download.

Download sources, tried in order: the mirror `https://d.officecli.ai`, then GitHub releases of
`iOfficeAI/OfficeCLI`. The downloaded artifact is verified by checksum and a smoke test.
`OfficeCliVerificationError` (checksum mismatch, asset not listed, failed smoke test) **aborts** the
mirror→GitHub fallback rather than silently trying another source.

Asset naming by platform/arch:

| Platform-arch | Asset |
|---|---|
| `win32-x64` / `win32-arm64` | `officecli-win-x64.exe` / `officecli-win-arm64.exe` |
| `darwin-x64` / `darwin-arm64` | `officecli-mac-x64` / `officecli-mac-arm64` |
| `linux-x64` / `linux-arm64` | `officecli-linux-x64` / `officecli-linux-arm64` |

The `office` tool spawns the binary directly with an argv array (**no shell**), appends `--json`, and
sets `OFFICECLI_SKIP_UPDATE=1`. 120s default timeout, `tree-kill` on timeout, 1MB output cap per
stream. It defaults to permission `ask`.

## 8.6 External delegation (Claude Code → Meow)

Lets an external coding agent — Claude Code running in the Claude desktop app — hand plan tasks to
Meow, get notified when each one finishes, verify the result itself, and send feedback into the same
Meow session. Built on `src/main/external-api/` (see its `AGENTS.md`) plus the existing
`SessionDelegationService`, with delegations tagged `sourceKind: 'external'`. **Disabled by default.**

### Flow

```
Claude (desktop) ─ Bash run_in_background ─▶ node meow-delegate.mjs start|send|status|cancel
                                                   │ HTTP 127.0.0.1:<port>, Bearer <token>
                                                   ▼
Meow main: ExternalApiServer ─▶ ExternalDelegationFacade ─▶ SessionDelegationService
                                                              └─▶ session "[claude] <plan title>"
```

Claude never polls through its own turns: the CLI blocks until the Meow task is terminal (or the
`/wait` timeout), and Claude Code re-invokes the model when the `run_in_background` command exits,
delivering the "task finished" message into the Claude session.

### Config file (`userData/external-api.json`)

`{ enabled, port, token, cliPath }` — see [06 — Data & Storage](06-data-and-storage.md#62-userdata-inventory).
`enabled` is the Settings toggle; `port` is the bound port, `null` when not listening (cleared on
disable and on quit); `token`
is 32 random bytes (hex), created once and kept until regenerated; `cliPath` is the CLI's copied
location under `userData/bin/`. The file is written with mode `0600` on POSIX.

### Routes

All routes are under `/v1`, JSON, and require `Authorization: Bearer <token>` (401 otherwise).

| Route | Behavior |
|---|---|
| `GET /v1/health` | `{ version }` |
| `POST /v1/tasks` | Body `{ cwd, planKey, title?, task, sessionId? }`. With `sessionId` (a target agent id), queues into that existing session. Without it, resolves/creates the per-plan session (`[claude] <title>`, auto-adding the project for `cwd` when missing). A new session starts on the same model as a new draft session — the last used model (`meow.json` `lastUsedModel`), falling back to the default provider when that provider is no longer connected; a reused session keeps its own model. Returns `{ task: TaskDto }`. |
| `GET /v1/tasks/:id` | `{ task: TaskDto }` |
| `GET /v1/tasks/:id/wait?timeout=<s>` | Long-polls until the task is terminal, or `timeout` elapses (default 60s, max 120s): `{ done, task }` |
| `POST /v1/tasks/:id/cancel` | `{ task }` after the cancel is applied; a running task is stopped and the call waits up to 5 s for it to settle, so `task.status` is normally `cancelled` |

`TaskDto`: `{ id, status, sessionId, projectPath, planKey, createdAt, startedAt?, finishedAt?, result?,
resultTruncated?, error?, touchedFiles }`. `sessionId` is the Meow agent id (the UI's "session"); there
is no separate `agentId` field.

### CLI (`meow-delegate.mjs`)

Plain Node ≥ 18 (global `fetch`, no dependencies), packaged from `resources/external-api/` and copied
to `userData/bin/meow-delegate.mjs` on every app start; reads `../external-api.json` relative to its
own location, so it follows the real `userData` directory.

```
node meow-delegate.mjs start  --cwd <dir> --plan <plan.md> [--title <t>] --task-file <f> [--no-wait]
node meow-delegate.mjs send   --session <id> --message-file <f> [--no-wait]
node meow-delegate.mjs status <taskId>
node meow-delegate.mjs wait   <taskId>
node meow-delegate.mjs cancel <taskId>
```

Task text always comes from a file (avoids Windows shell-quoting problems). `start` and `send` wait
by default, long-polling `/wait`; transient connection failures are retried for 30s, re-reading the
config file on each retry (and once on a 401) to follow a restarted Meow or a regenerated token. Right after submitting (without
`--no-wait`) they print `task: <id>   session: <id>   status: <status>`, so a CLI killed mid-wait (e.g. a
foreground Bash timeout) still leaves the id; `wait <taskId>` resumes waiting on it without queueing
the work again. When the task is terminal:

```
=== MEOW TASK RESULT ===
task: <id>   session: <id>   status: <status>
touched_files:
- <path>
--- final answer ---
<result or error>
```

Exit codes: `0` completed · `1` failed/interrupted · `2` cancelled · `3` Meow unreachable, feature
disabled, 401 or 403 · `4` invalid arguments or 400/404/413 · `5` completed but the turn stopped at a
configured per-turn step cap (`endReason: 'max-steps'`, status `completed (max steps reached)`; the default
budget is unlimited, so this only happens with an opt-in `maxSteps`) · `6` completed but unfinished —
`endReason` `stuck` (loop detector), `length` (answer cut off) or `refusal`, shown as `completed (stuck)` etc.
A cut turn with no assistant text still completes (result `(no output)`); only an abort is `cancelled`.
`TaskDto.endReason` carries the reason; the delegation record stores it as `endReason`.

Queued external tasks survive a restart: after the API starts, `ExternalDelegationFacade.resumeQueued()`
registers each queued task's target session and wakes its pump.

### Security

- Loopback only (`127.0.0.1`), preferred port `3929`, fallback port `0` (OS-assigned) when the preferred
  port is taken (`EADDRINUSE`) or excluded on Windows (`EACCES`).
- Bearer token required on every route, compared with `crypto.timingSafeEqual`.
- Any request carrying an `Origin` header is rejected with 403 — blocks browser pages; no CORS headers
  are ever sent.
- Request body capped at 64 KiB (413 when exceeded).
- Feature is off until the user enables it in Settings → External delegation.

### Claude skill install

Settings → External delegation → **Install Claude skill** renders
`resources/external-api/claude-skill.md` (substituting the CLI's absolute path) to
`~/.claude/skills/meow-delegate/SKILL.md`. The skill instructs Claude to delegate one plan task at a
time, wait in the background, verify Meow's work itself (diff + the plan's verification commands), and
send corrective feedback into the same session (at most 3 rounds before asking the user).
