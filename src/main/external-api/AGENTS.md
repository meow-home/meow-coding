# AGENTS.md — src/main/external-api

Loopback API that lets an external coding agent (Claude Code) delegate plan tasks to Meow. Built on
`SessionDelegationService` with `sourceKind: 'external'`. Disabled by default.

## Key files

| File | Responsibility |
|---|---|
| `config-file.ts` | `ExternalApiConfigFile`: `userData/external-api.json` `{ enabled, port, token, cliPath }`; 32-byte hex token created once, `regenerateToken()`; file mode `0600` after every write (best effort, no-op on Windows). |
| `server.ts` | `ExternalApiServer`: `node:http` on `127.0.0.1` (preferred 3929, fallback 0 on `EADDRINUSE`/`EACCES`); bearer auth with `timingSafeEqual`; rejects any `Origin` header (403); 64 KiB body cap; `/v1/health`, `POST /v1/tasks`, `GET /v1/tasks/:id`, `GET /v1/tasks/:id/wait` (long-poll ≤ 120 s, woken by `notifyChanged`), `POST /v1/tasks/:id/cancel`. |
| `facade.ts` | `ExternalDelegationFacade`: resolves/auto-adds the project for `cwd`, reuses or creates the `[claude] <title>` session per `planKey` (a new session gets `defaultModel()` — the manager's `defaultSessionModel()`, i.e. the last used model; a reused one keeps its model), validates the task (non-empty, ≤ 32 KiB) before creating a session, `ensureAgent` before `createExternal`, maps records to `TaskDto`; `resumeQueued()` registers each queued external target and calls `notifyAgentAvailable` (startup). |
| `manager.ts` | `ExternalApiManager`: copies the CLI to `userData/bin/` on start (a copy failure is logged and reported as `error`, the server still starts), starts/stops the server with the setting (`stop()` clears `port`, keeps `enabled`), status for the Settings tab, `installClaudeSkill()`, `getToken()` (used by the Copy token IPC handler, which writes it to the clipboard in main). |
| `claude-skill.ts` | Renders `resources/external-api/claude-skill.md` with the CLI path into `~/.claude/skills/meow-delegate/SKILL.md`. |
| `errors.ts` | `ExternalApiError(status, message)` mapped to HTTP status by the server. |

The CLI itself is `resources/external-api/meow-delegate.mjs` (plain Node ≥ 18, no deps; packaged via
`extraResources` to `external-api/`). It reads `../external-api.json` relative to itself, and re-reads it
on each connection retry and once on a 401. `start`/`send` print the task id line before waiting; `wait <taskId>` resumes
waiting on an existing task; exit `5` = completed but stopped at a configured step cap (`endReason: 'max-steps'`), exit `6` = completed but
unfinished (`stuck`/`length`/`refusal`).

## Conventions

- Loopback only; never add CORS headers; never accept a request with `Origin`.
- External records use the sentinel `external:claude` for `sourceAgentId`/`sourceSessionId`; they are
  never appended to or woken on the Meow side — results are read back through the API.
- Permission prompts of a delegated run are answered in the Meow UI only.

## TODOs

- MCP server / Claude Code Channels wrapper over the same API (out of scope for v1).
