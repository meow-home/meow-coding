# Meow Web — Headless Multi-User Server with Routines — Design

Date: 2026-10-01 · Status: proposed

## 1. Problem

Meow Coding only runs as an Electron desktop app. Recurring office work (e.g. "every Telegram message
to my bot becomes a row in a Google Sheet") needs the machine to be on, or is built in a separate tool
(n8n) with brittle regex extraction. We want a web app — chat UI in the browser, like ChatGPT or Claude
Cowork — whose agent runs 24/7 on a VPS and executes **routines** triggered by schedules and events,
while the agent core stays the one in this repo.

Reference workload (today an n8n workflow "Reminded Tasks - Add To Sheet"):

1. Telegram bot receives a message.
2. If it has no text/caption → reply "no data".
3. Extract `MessageID`, `Link` (first URL or first line), `Time` (`\d{1,2}h`), `Date` (dd/mm/yyyy after
   a Vietnamese deadline keyword such as "hạn chót", "thời hạn", "deadline"), `Username`
   (forwarded-from or sender).
4. Append a row to the "Inbox Tasks" sheet.

## 2. Decisions (from the product owner)

- **Multi-user**: every person has their own account; data, secrets, sessions and routines are isolated
  per user.
- **Office tasks first**: documents, sheets, web lookup, messaging. Running code/shell on the server is a
  later phase.
- **Deployment**: a VPS under **PM2** first; a Docker image later.

## 3. What the codebase already gives us

| Area | Finding | Consequence |
|---|---|---|
| `src/main/agent/**` | No `electron` import in any of its 43 files | Runs unchanged in plain Node |
| `MeowAgentManager` | Every path and store is injected (`configPath`, `userSkillsDir`, `snapshots`, `savedPermissions`, `catalog`, …) — see `src/main/index.ts:153` | One instance per user, rooted at that user's data dir |
| Electron-bound modules | `vault.ts` (`safeStorage`), `notification-service.ts`, `tray-manager.ts`, `window-chrome.ts`, `browser/chrome-launcher.ts`, `file-viewer.ts`, `git-viewer.ts`; 33 `app.getPath` calls | Need a small platform layer |
| `AgentApi` (`src/shared/ipc.ts`) + 117 `ipcMain` handlers in `src/main/index.ts` | One RPC contract | Can be served over WebSocket; the renderer only talks to `window.api` |
| `external-api/` | Token-authenticated HTTP task delegation | Pattern for webhook triggers |
| MCP manager, skills, `office` tool, `question` tool, permissions | Present | Connectors, document work and approvals reuse them |
| File tools (`read`/`write`/`edit`/`glob`/`grep`) | **No path confinement** (only `artifact.ts` checks the project root) | Must add a hard jail before exposing them to multiple users |

## 4. Architecture

```
Browser (React UI, web build)  ─── HTTPS + WS ───┐
Telegram / webhooks / cron  ─── HTTPS ───────────┤
                                                  ▼
                              meow-web (one Node process, PM2 fork mode)
                              ├─ Gateway        auth (JWT), REST, WS JSON-RPC + event push
                              ├─ UserRuntimePool  userId → UserRuntime (lazy, idle-evicted)
                              │    └─ UserRuntime = MeowAgentManager + WorkspaceStore + McpManager
                              │                     rooted at  DATA_DIR/users/<userId>/
                              ├─ RoutineService   routines, triggers, run history
                              ├─ TriggerService   cron · webhook · telegram
                              ├─ ConnectorService Google (OAuth), Telegram bot, user MCP servers
                              ├─ ApprovalService  pending `ask` permissions → web inbox / Telegram
                              └─ Storage          SQLite (users, routines, runs, connectors meta)
                                                  + existing JSON session files per user
Desktop app (Electron) ─ keeps working, same core, same handlers via ipcMain
```

### 4.1 Platform layer (prerequisite, desktop behavior unchanged)

Introduce interfaces in `src/main/platform/`:

- `Paths { userData: string; builtinResources: string }` — replaces direct `app.getPath('userData')`.
- `SecretStore { has, get, set, delete }` — desktop: existing `safeStorage` vault; server: AES-256-GCM
  with a key derived from `MEOW_MASTER_KEY` (env) per user (HKDF with `userId` as info), stored in the
  user's `vault.json`.
- `Notifier { notify(title, body, meta) }` — desktop: Electron notifications; server: WS push + optional
  Telegram message.

Electron-only modules (tray, window chrome, Chrome launcher, browser bridge, file/git viewer windows)
are simply not wired on the server.

### 4.2 RPC router

Move the 117 handler bodies out of `src/main/index.ts` into `src/main/rpc/handlers.ts`:
`createHandlers(runtime) → Record<Channel, (params) => Promise<unknown>>`. Desktop registers each entry
with `ipcMain.handle`; the server dispatches WS messages `{ id, method, params }` to the same table.
Events (`ChatEvent`, status changes) go out as `{ event, payload }`.

The server exposes an **allowlist** of methods (`WEB_METHODS`) — no workspace-path picking, PTY, browser
bridge, updater, or desktop window methods.

### 4.3 Multi-user runtime

- `UserRuntimePool.get(userId)` builds a `MeowAgentManager` with every path under
  `DATA_DIR/users/<userId>/` and a per-user `SecretStore` namespace.
- Evict a runtime after 30 min with no WS client, no running session and no in-flight routine run;
  persistent state is already on disk.
- Per-user limits: concurrent running sessions (default 3), routine runs per minute (default 30),
  optional monthly token/cost budget (from the existing usage tracking).
- MCP stdio servers are per runtime and are stopped on eviction to keep VPS memory bounded.

### 4.4 Workspaces and file jail

- Each user gets workspaces under `DATA_DIR/users/<userId>/workspaces/<name>/` only; there is no
  arbitrary-path "add workspace".
- New `resolveInside(root, p)` guard (realpath, rejects `..`, absolute paths outside, and symlink
  escapes) applied in `read`, `write`, `edit`, `apply-patch`, `glob`, `grep`, `office`, `artifact`
  when a `jailRoot` is set in the tool context. Desktop leaves `jailRoot` unset.
- Uploads/downloads through REST into the active workspace.

### 4.5 Tool profile "office" (server default)

Enabled: `read`, `write`, `edit`, `apply-patch`, `glob`, `grep` (jailed), `office`, `webfetch`,
`websearch`, `todowrite`, `question`, `skill`, `artifact`, `task`, connector tools, user MCP tools.

Disabled: `bash`, `git`, `browser`, `lsp`, `monitor`, background processes, user tools loaded from
disk (`userData/tools` executes arbitrary code). These need OS sandboxing (Phase 4).

`webfetch` must block private/loopback/link-local addresses (SSRF), since it now runs on the VPS.

### 4.6 Authentication

Email + password (bcrypt), JWT access token (15 min) + rotating refresh token, same model as
`meow-social/backend/src/auth`. The first registered user is `admin`; afterwards registration is by
admin invite link. WS connections authenticate with the access token in the first message.

### 4.7 Connectors

- **Google (Sheets, Drive, Gmail later)** — native tools backed by per-user OAuth (server holds the
  OAuth client; tokens in `SecretStore`): `gsheets_read`, `gsheets_append`, `gsheets_update`. Native
  rather than a stdio MCP server per user, to avoid one process per user per connector.
- **Telegram** — user pastes a bot token; server calls `setWebhook` to
  `/hooks/telegram/<connectorId>/<secret>`. Tools: `telegram_send`, `telegram_reply`.
- **User MCP servers** — HTTP MCP only on the server (stdio MCP spawns processes; Phase 4).

### 4.8 Routines

```ts
interface Routine {
  id: string
  userId: string
  name: string
  enabled: boolean
  trigger:
    | { kind: 'cron'; expr: string; tz: string }
    | { kind: 'webhook'; secret: string }
    | { kind: 'telegram'; connectorId: string; filter?: { chatIds?: number[] } }
  instructions: string            // natural-language task, may reference a skill
  workspace: string
  toolPolicy: Record<string, 'allow' | 'ask' | 'deny'>  // narrows the office profile
  mode: 'agent' | 'compiled' | 'hybrid'
  compiled?: { source: string; version: number }        // see 4.9
  session: 'per-run' | 'persistent'
  maxRunsPerMinute?: number
}

interface RoutineRun {
  id: string; routineId: string; triggerEvent: unknown
  status: 'queued' | 'running' | 'waiting-approval' | 'done' | 'failed'
  path: 'compiled' | 'agent'      // which path handled it
  sessionId?: string; result?: string; error?: string
  costUsd?: number; startedAt: number; finishedAt?: number
}
```

- An `agent` run creates (or reuses) a session in the routine's workspace with the trigger event as a
  structured user message, and runs it non-interactively with the routine's `toolPolicy`.
- Runs are queued per routine (serial by default) so a burst of Telegram messages appends rows in
  order.
- The web UI lists routines, their runs, and opens any run as a normal chat session.
- Routines are created in chat ("every message to my bot → add a row to sheet X") through a
  `routine_create` tool that always asks for confirmation, or through a form.

### 4.9 Compiled / hybrid mode (cost control)

High-frequency triggers should not cost one LLM call per event.

- `compiled`: the agent writes a pure function
  `export default (event) => ({ action: 'append', sheet, row } | { action: 'reply', text } | null)`.
  It runs in a QuickJS sandbox (`quickjs-emscripten`: no I/O, 50 ms CPU, 16 MB memory). The server
  executes the returned action through the connector, not the script.
- `hybrid`: run the compiled function first; if it returns `null` or a row with empty required
  fields, fall back to an `agent` run. Fallback rate is shown per routine so the user can ask the agent
  to "improve the extractor" from the failing examples.
- The compiled source is versioned and diffable in the UI; the agent can only replace it with
  user confirmation.

Reference workload mapping: trigger `telegram`; `hybrid` mode; compiled extractor = today's n8n Set
node logic; fallback agent handles free-form deadlines ("thứ 6 tuần sau", "trước 5h chiều mai");
no-text messages → `reply` action "Không có dữ liệu".

### 4.10 Approvals

A permission `ask` during a routine run moves the run to `waiting-approval`, creates an approval item
(web inbox + WS push, optionally a Telegram message with inline Allow/Deny buttons), and resumes on the
answer. No answer within 24 h → deny. The `question` tool uses the same channel.

### 4.11 Web UI

- Build the existing renderer as a second Vite target (`web`) where `window.api` is a WS JSON-RPC
  client implementing the allowed subset of `AgentApi`; a `platform: 'web'` flag hides desktop-only
  UI (title bar, folder picker, Files overlay paths outside the jail, browser bridge, processes panel).
- New screens: Login/Invite, Routines (list, editor, run history), Connectors, Approvals inbox.
- Served as static files by `meow-web`.

## 5. Deployment

PM2 (Phase 1–3):

```js
// ecosystem.config.cjs
module.exports = { apps: [{
  name: 'meow-web', script: 'out/server/index.js',
  exec_mode: 'fork', instances: 1,          // in-memory runtimes, WS and queues: no cluster
  env: { NODE_ENV: 'production', PORT: 3930, DATA_DIR: '/var/lib/meow', MEOW_MASTER_KEY: '…' },
  max_memory_restart: '1500M', kill_timeout: 15000
}] }
```

- Caddy/Nginx terminates TLS (Telegram webhooks require HTTPS).
- Graceful shutdown: stop accepting triggers, let running steps finish up to `kill_timeout`, mark
  unfinished runs `failed` with `endReason: 'shutdown'`, retry queued runs on boot.
- Backups: `DATA_DIR` (SQLite + per-user files). `MEOW_MASTER_KEY` kept outside the backup.
- Docker (later): single image, `DATA_DIR` as a volume; the same image becomes the base for the
  per-user sandbox in Phase 4.

## 6. Phases

| Phase | Scope | Done when |
|---|---|---|
| P0 Platform refactor | `Paths`, `SecretStore`, `Notifier`; RPC handler table shared with `ipcMain`; `jailRoot` in file tools | Desktop typecheck/tests/e2e green, no behavior change |
| P1 Server + web chat | `meow-web` entry, auth, `UserRuntimePool`, WS gateway, web build of renderer, office tool profile, SSRF guard, PM2 file | Two users chat in parallel from browsers, isolated data, desktop still works |
| P2 Routines | Routine/run store, cron + webhook + Telegram triggers, Google Sheets + Telegram connectors, approvals inbox, `agent` mode | The reference workload runs end-to-end in `agent` mode |
| P3 Compiled/hybrid | QuickJS sandbox, extractor generation and versioning, fallback stats | Reference workload runs with 0 LLM calls for well-formed messages |
| P4 Code tasks | Per-user container sandbox for `bash`/`git`/stdio MCP, Docker image | `bash` usable by a user without access to other users or the host |

## 7. Risks

- **Isolation bugs** leak data between users → jail tests, per-user runtime objects, no shared mutable
  singletons (audit module-level state in `src/main/agent/**` during P0).
- **Prompt injection from trigger payloads** (a Telegram message telling the agent to email a file
  out) → routine `toolPolicy` narrows tools to what the routine needs; trigger content is wrapped as
  untrusted data in the user message; outbound-sending tools default to `ask`.
- **Cost runaway** on bursty triggers → per-routine rate limit, budgets, hybrid mode.
- **Single process** → one crash stops all users; PM2 restart + run recovery on boot. Revisit
  horizontal scaling only if needed (would require moving runtime state out of memory).

## 8. Open questions

1. Which LLM credentials: per-user API keys/accounts (existing Model Connections), a server-wide key
   with per-user budgets, or both?
2. Should `meow-social` later consume the same core (`@meow/core` package) for its planned Assistant,
   or call `meow-web` over HTTP?
3. Google OAuth app: one verified app owned by the operator, or each user brings their own client?
