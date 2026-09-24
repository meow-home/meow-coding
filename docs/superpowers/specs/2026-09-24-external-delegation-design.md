# External Delegation (Claude → Meow) — Design Spec

Date: 2026-09-24 · Status: awaiting written-spec review

## 1. Goal

Let an external coding agent — Claude Code running in the Claude desktop app — hand implementation
tasks from a written plan to Meow, get notified when each task finishes, verify the result itself,
and send corrective feedback into the same Meow session.

The motivating flow is:

1. The user brainstorms, specs, and plans a change with Claude.
2. For each task in the plan, Claude delegates the task to Meow.
3. Meow implements it in a visible, per-plan session; the user approves permission prompts in the
   Meow UI as usual.
4. When the task ends, Claude is woken automatically, verifies the change (diff, typecheck, tests),
   and either moves to the next task or sends feedback to the same session.

Claude must not poll through its own turns. The notification mechanism is a background shell
command: Claude Code re-invokes the model when a `run_in_background` Bash command exits, so a CLI
that blocks until the Meow task is terminal delivers the "task finished" message into the Claude
session. This works in the desktop app today, unlike MCP Channels (research preview, CLI flag only).

## 2. Product decisions

| Topic | Decision |
|---|---|
| Unit of work | One plan task per delegation |
| Target session | One Meow session per plan (`[claude] <title>`), reused for later tasks and feedback |
| Project | Resolved from Claude's cwd; added to Meow automatically when missing |
| Permission prompts | Approved by the user in the Meow UI; the CLI keeps waiting |
| Notification | CLI blocks until terminal and exits; Claude runs it with `run_in_background` |
| Verification | Done by Claude, never trusting Meow's report alone |
| Feedback loop | `send` into the same session, at most 3 rounds per task, then ask the user |
| Transport | Loopback HTTP API + bearer token |
| Default | Disabled; the user turns it on in Settings |
| Claude skill | Installed from Meow Settings into `~/.claude/skills/meow-delegate/SKILL.md` |
| Concurrent edits | Claude does not edit the delegated task's files while it runs; no locks |

## 3. Considered approaches

1. **Loopback HTTP API + token (chosen).** Mirrors `BrowserBridge`: a small `node:http` server on
   `127.0.0.1`, a connection file with port + token, and a dependency-free Node CLI. Easy to test
   and debug, and a future MCP/Channel wrapper can sit on the same API.
2. **Named pipe / Unix socket.** No port and OS-level access control, but platform-specific code,
   harder to debug, and more work to wrap later.
3. **Meow as an MCP server, CLI as an MCP client.** One protocol everywhere, but the CLI would carry
   the MCP SDK for no present benefit.

## 4. Architecture

```
Claude (desktop) ─ Bash run_in_background ─▶ node meow-delegate.mjs start|send|status|cancel
                                                   │ HTTP 127.0.0.1:<port>, Bearer <token>
                                                   ▼
Meow main: ExternalApiServer ─▶ ExternalDelegationFacade ─▶ SessionDelegationService
                                                              └─▶ session "[claude] <plan title>"
```

New module `src/main/external-api/`:

| File | Responsibility |
|---|---|
| `server.ts` | `ExternalApiServer`: `node:http` on `127.0.0.1`, bearer auth (`timingSafeEqual`), 64 KiB body cap, rejects any request carrying an `Origin` header, routing, long-poll waiters woken by delegation changes. `start()` / `stop()`. |
| `facade.ts` | `ExternalDelegationFacade`: resolve/add the project for a cwd, resolve/create the per-plan session, create/cancel external delegations, map records to API DTOs. |
| `connection-file.ts` | Read/write `userData/external-api.json` (`{ port, token, cliPath }`); token generation and regeneration. |
| `cli/meow-delegate.mjs` | The CLI shipped to `userData/bin/meow-delegate.mjs` on every app start. |
| `claude-skill.ts` | Renders the Claude skill template with the absolute CLI path and writes it to `~/.claude/skills/meow-delegate/SKILL.md`. |

`MainApp` (`src/main/index.ts`) owns the server: starts it after `delegationService.start()` when the
setting is enabled, stops it on quit or when the setting is turned off, and forwards the service's
`onChanged` to the server's waiters.

## 5. Data model

`SessionDelegation` (`src/shared/types.ts`) gains optional fields, so existing
`userData/delegations.json` records stay valid:

```ts
sourceKind?: 'session' | 'external'   // absent = 'session'
externalClient?: 'claude'
planKey?: string                       // normalized plan path, external records only
```

External records set `sourceAgentId` and `sourceSessionId` to the sentinel `external:claude`, so
existing readers of those fields keep their types.

**Plan → session mapping.** No new store. The facade finds the most recent external delegation with
the same normalized `projectPath` and `planKey` whose target agent still exists and reuses its
target. Otherwise it creates a new native session in that project named `[claude] <title>` (title
defaults to the plan file's basename). `planKey` is the plan path resolved against `cwd`, then
normalized like project paths (Windows lower-cased, forward slashes).

## 6. Service changes (`session-delegation-service.ts`)

- `createExternal({ projectPath, targetAgentId, task, planKey })` — same task size limit (32 KiB),
  same per-target cap (5 nonterminal), same FIFO queue; skips the source-run checks.
- `finishTerminal` — for `sourceKind === 'external'`, do not call `appendResult` or `wakeSource`;
  only `markDelivered` and emit. Result truncation (64 KiB UTF-8) is unchanged.
- `cancel(id)` — `queued` → `cancelled` as today; `running` / `waiting_for_input` → call
  `runtime.stopRun(targetAgentId)` (the manager's existing `stop`, which aborts the turn and
  tree-kills its processes); the run then settles as `cancelled`. Terminal records return as-is.
- Restart recovery is unchanged: in-flight → `interrupted`, queued → resumed.

`DelegationRuntime` gains `stopRun(agentId: string): void`.

The delegated turn's incoming message uses the existing `ChatDelegationMeta` with
`direction: 'incoming'`, `peerAgentId: 'external:claude'`, `peerName: 'Claude (external)'`. The
renderer's incoming delegation bubble must not offer navigation when the peer id starts with
`external:`.

## 7. HTTP API

All routes are under `/v1`, JSON, `Authorization: Bearer <token>` required (401 otherwise). Any
request with an `Origin` header gets 403. Unknown route 404; malformed body 400.

| Route | Behavior |
|---|---|
| `GET /v1/health` | `{ version }` |
| `POST /v1/tasks` | Body `{ cwd, planKey, title?, task, sessionId? }`. With `sessionId` (a target agent id), queue into that session (must be an existing session created by this feature). Without it, resolve/create the per-plan session. Returns `{ taskId, sessionId, agentId, status }`. `cwd` must be an existing directory (400). |
| `GET /v1/tasks/:id` | `{ task: TaskDto }` |
| `GET /v1/tasks/:id/wait?timeout=<s>` | Returns as soon as the task is terminal, or after `timeout` (default 60, max 120): `{ done, task }` |
| `POST /v1/tasks/:id/cancel` | `{ task }` after the cancel is applied |

`TaskDto`: `{ id, status, sessionId, agentId, projectPath, planKey, createdAt, startedAt?,
finishedAt?, result?, resultTruncated?, error?, touchedFiles }`. `sessionId` in the API is the
Meow agent id (the UI's "session").

**Connection file** `userData/external-api.json`: `{ port, token, cliPath }`. The token is
32 random bytes (hex), created once and kept across restarts until regenerated. Preferred port
`3929`; if taken, bind port `0` and record the actual port. The file is rewritten on each start.

## 8. CLI (`meow-delegate.mjs`)

Plain Node ≥ 18, global `fetch`, no dependencies. Reads the connection file relative to its own
location (`<userData>/bin/../external-api.json`), so it follows the real `userData` directory —
which differs between dev (`meow-coding`), packaged builds (`Meow Coding`), and `MEOW_USER_DATA`
overrides. Overridable with `--config <path>`.

```
node meow-delegate.mjs start  --cwd <dir> --plan <plan.md> [--title <t>] --task-file <f> [--no-wait]
node meow-delegate.mjs send   --session <id> --message-file <f> [--no-wait]
node meow-delegate.mjs status <taskId>
node meow-delegate.mjs cancel <taskId>
```

Task text always comes from a file to avoid shell quoting problems on Windows. `start` and `send`
wait by default, looping on `/wait`. Transient connection failures are retried for 30 s.

Output when the task is terminal:

```
=== MEOW TASK RESULT ===
task: <id>   session: <id>   status: <status>
touched_files:
- <path>
--- final answer ---
<result or error>
```

Exit codes: `0` completed · `1` failed / interrupted · `2` cancelled · `3` Meow unreachable, feature
disabled, or 401 · `4` invalid arguments or 400/404.

## 9. Settings and IPC

- `MeowSettings.externalDelegation: { enabled: boolean }`, default `false`.
- Settings panel section "External delegation": enable toggle, status line (listening port or
  error), "Regenerate token", "Install Claude skill" (shows the written path).
- New `Channels` entries + `AgentApi` methods: `externalApiStatus`, `externalApiRegenerateToken`,
  `externalApiInstallClaudeSkill`. The toggle goes through the existing settings save path.

## 10. Claude skill (`meow-delegate`)

Template kept in the repo at `src/main/external-api/claude-skill.md`; the CLI path is substituted at
install time. The skill instructs Claude to:

1. Use it when a written plan exists and the user wants Meow to execute it.
2. For each task in order: write the task text (with the plan path and verification commands) to a
   temp file, then run `start` with Bash `run_in_background`.
3. While it runs, do not edit files in that task's scope.
4. When woken, parse the result block. Exit 3 → tell the user to open Meow / enable the feature and
   stop. Exit 2 → ask the user.
5. Verify independently: `git diff` on the touched files, run the plan's verification commands,
   compare against the task's requirements.
6. On failure, `send` concrete feedback to the same session; at most 3 rounds, then ask the user.
7. On success, continue with the next task; summarize at the end.

## 11. Error handling and security

- Loopback only, token required, constant-time comparison, `Origin` rejected (blocks browser
  pages), no CORS headers, 64 KiB body cap.
- Disabled feature or closed app → CLI exit 3 with
  `[meow] Meow is not running or external delegation is disabled.`
- Removing the target session or project fails/cancels queued tasks via the existing handlers; the
  CLI prints that terminal state.
- Server start failure is logged and surfaced in the Settings status line; it never blocks app start.

## 12. Testing

- Unit: `external-api-server` (auth, `Origin` rejection, routes, body cap, long-poll wake and
  timeout), `external-delegation-facade` (auto-add project, session reuse by `planKey`, new session
  after the old one is removed), `session-delegation-service` (`createExternal`, external terminal
  skips append/wake, `cancel` while running calls `stopRun`), `external-api-connection-file`
  (token persistence and regeneration).
- Integration: spawn the real CLI against an in-process server with a fake facade; assert output
  format and exit codes for completed / failed / cancelled / unreachable.
- Required: `npm run typecheck`, `npm test`.

## 13. Documentation

Update `docs/reference/08-integrations.md` (new section), `05-ipc-contract.md` (new channels),
`06-data-and-storage.md` (`external-api.json`, new delegation fields), `src/main/AGENTS.md`, and a
new `src/main/external-api/AGENTS.md` + `CLAUDE.md`.

## 14. Out of scope

- MCP server / Claude Code Channels wrapper (possible later on top of the same API).
- Headless Meow (the app must be running).
- Worktree isolation and file locks.
- Relaying Meow permission prompts to Claude.
