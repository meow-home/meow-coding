# AGENTS.md — src/main/external-api

Loopback API that lets an external coding agent (Claude Code) delegate plan tasks to Meow. Built on
`SessionDelegationService` with `sourceKind: 'external'`. Disabled by default.

## Key files

| File | Responsibility |
|---|---|
| `config-file.ts` | `ExternalApiConfigFile`: `userData/external-api.json` `{ enabled, port, token, cliPath }`; 32-byte hex token created once, `regenerateToken()`. |
| `server.ts` | `ExternalApiServer`: `node:http` on `127.0.0.1` (preferred 3929, fallback 0); bearer auth with `timingSafeEqual`; rejects any `Origin` header (403); 64 KiB body cap; `/v1/health`, `POST /v1/tasks`, `GET /v1/tasks/:id`, `GET /v1/tasks/:id/wait` (long-poll ≤ 120 s, woken by `notifyChanged`), `POST /v1/tasks/:id/cancel`. |
| `facade.ts` | `ExternalDelegationFacade`: resolves/auto-adds the project for `cwd`, reuses or creates the `[claude] <title>` session per `planKey`, validates the task (non-empty, ≤ 32 KiB) before creating a session, `ensureAgent` before `createExternal`, maps records to `TaskDto`; `resumeQueued()` registers each queued external target and calls `notifyAgentAvailable` (startup). |
| `manager.ts` | `ExternalApiManager`: copies the CLI to `userData/bin/` on start, starts/stops the server with the setting, status for the Settings tab, `installClaudeSkill()`. |
| `claude-skill.ts` | Renders `resources/external-api/claude-skill.md` with the CLI path into `~/.claude/skills/meow-delegate/SKILL.md`. |
| `errors.ts` | `ExternalApiError(status, message)` mapped to HTTP status by the server. |

The CLI itself is `resources/external-api/meow-delegate.mjs` (plain Node ≥ 18, no deps; packaged via
`extraResources` to `external-api/`). It reads `../external-api.json` relative to itself.

## Conventions

- Loopback only; never add CORS headers; never accept a request with `Origin`.
- External records use the sentinel `external:claude` for `sourceAgentId`/`sourceSessionId`; they are
  never appended to or woken on the Meow side — results are read back through the API.
- Permission prompts of a delegated run are answered in the Meow UI only.

## TODOs

- MCP server / Claude Code Channels wrapper over the same API (out of scope for v1).
