# AGENTS.md — src/main/cli-agents

CLI agent subsystem: manages external coding CLIs (Antigravity `agy`, OpenCode `opencode`) as first-class workers.

## Key files

- `runtimes.ts` — static runtime catalog for Antigravity (`agy`, min version 1.5.0) and OpenCode (`opencode`, min version 2.0.0), platform install command descriptors, docs URLs, models commands.
- `binary-manager.ts` — `CliBinaryManager`: resolves binaries on PATH and known install directories (`%LOCALAPPDATA%\agy\bin`, npm global, `~/.opencode/bin`), parses `--version`, compares semver, supports manual path override, generates install descriptors. Electron-free.
- `agents.ts` — `CliAgentStore`: CRUD for agents, `defaultAgentId`, Antigravity `active` Google account bookkeeping, status transitions, versioned `cli-agents.json` atomic store. Refuses to persist secrets.
- `profiles.ts` — `CliProfileManager`: OpenCode profile directories (`userData/cli-profiles/opencode/<agentId>/`, created owner-only), vault secret storage (`cli:agent:<agentId>`), removal cleanup wiping both directory and vault secret. Injected `VaultLike` interface.
- `policy.ts` — `deriveCliPolicy`: maps mode (`read`/`edit`/`full`) and Meow tool permissions (`bash`, `write`/`edit`/`apply-patch`, `webfetch`) to `CliPolicy`; `buildAntigravityArgs` and `buildOpenCodeArgs` for CLI spawn flags and settings JSON.
- `constants.ts` — concurrency limits (`MAX_CONCURRENT`), byte size caps (`TASK_MAX_BYTES`, `RESULT_MAX_BYTES`, `STDERR_MAX_BYTES`), default timeout, and environment allowlist matching (`ENV_ALLOWLIST`, `isEnvAllowed`).
- `run-manager.ts` — `CliRunManager`: task execution lifecycle, per-runtime concurrency slots with FIFO queueing, Antigravity Google credential mutex lock, minimal environment construction (`buildCliEnv`), line-by-line NDJSON parser dispatch, process tree termination (`tree-kill`), timeout and cancellation handling, and session status transitions.
- `parsers/antigravity.ts` — `createAntigravityParser`, `parseAntigravityLine`: stateful parser for Antigravity stream-json NDJSON (`init`, `step_update`, `result`), deduplicates tool steps, parses usage, extracts denied actions.
- `parsers/opencode.ts` — `createOpenCodeParser`, `parseOpenCodeLine`: tolerant NDJSON parser for OpenCode events (text/delta, tool use/result, usage, errors, terminal results).
- `session-store.ts` — `CliSessionStore`: stores session metadata in `userData/cli-sessions.json` and transcripts in `userData/cli-sessions/<id>.jsonl` with atomic writes, session id validation (`/^[a-z0-9_-]+$/i`), 5 MiB transcript cap rotation with 4 MiB truncation and notice insertion, and retention pruning.
- `index.ts` — `CliAgentsManager`: facade wiring agent store, profile manager, binary detection, session persistence, policy derivation, run execution, and models listing. Electron-free.

## Conventions

- No secrets in `cli-agents.json`. Secrets are stored exclusively in the vault under `cli:agent:<id>` or inside owner-only profile directories.
- Injected dependencies (`userDataDir`, `env`, `platform`, `vault`) keep core logic Electron-free and unit-testable.
- Only one Antigravity Google agent may have `active: true` at a time on a machine.
- Default permission map sets bash to 'ask', meaning commands are soft-denied in headless CLI runs unless the user explicitly allows bash in permission rules or chooses 'full' mode.
