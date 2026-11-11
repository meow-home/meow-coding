# AGENTS.md — src/main/cli-agents

Antigravity CLI (`agy`) as a headless delegation worker. Meow keeps no accounts, profiles or sessions for it:
it uses the `agy` install and sign-in already on the machine. Settings only checks and tests readiness.

## Key files

- `runtimes.ts` — `ANTIGRAVITY_CLI`: binary names, minimum version (1.5.0), version args, docs URL, per-platform install command descriptor.
- `binary-manager.ts` — `CliBinaryManager`: resolves `agy` on known install directories (`%LOCALAPPDATA%\agy\bin`, `~/.agy/bin`, `~/.antigravity/bin`, `~/.local/bin`) then PATH; `check()` runs `--version`, compares semver and returns a `CliCheckResult` (installed, path, version, ready, error, install command). Electron-free.
- `policy.ts` — `deriveCliPolicy`: maps a run mode (`read`/`edit`/`full`) and Meow tool permissions (`bash`, `write`/`edit`/`apply-patch`, `webfetch`) to `CliPolicy`; `buildAntigravityArgs` builds the headless spawn flags and `--settings` JSON.
- `constants.ts` — byte size caps (`TASK_MAX_BYTES`, `RESULT_MAX_BYTES`, `STDERR_MAX_BYTES`), default task timeout, test timeout (`TEST_TIMEOUT_MS`), and environment allowlist matching (`ENV_ALLOWLIST`, `isEnvAllowed`).
- `run-manager.ts` — `CliRunManager`: runs one task at a time (FIFO queue, `maxConcurrent` default 1) keyed by run id, allowlisted environment (`buildCliEnv`), line-by-line NDJSON parsing, process tree termination (`tree-kill`), timeout and cancellation; a non-zero exit puts the captured stderr into the result error.
- `parsers/antigravity.ts` — `createAntigravityParser`, `parseAntigravityLine`: stateful parser for Antigravity stream-json NDJSON (`init`, `step_update`, `result`), deduplicates tool steps, parses usage, extracts denied actions.
- `index.ts` — `AntigravityCli`: facade with `check()` (install + version), `test()` (one short read-only prompt, proves the sign-in works; refuses while a delegated task runs), `runTask({ runId, task, cwd })` (edit mode with Meow permissions; throws when not ready), `cancelTask(runId)`, `cancelAll()`. Electron-free.
- `ipc.ts` — `registerCliAgentsIpc`: `cli:check` and `cli:test`.

## Conventions

- Nothing is persisted: no config file, no secrets, no transcripts. Sign-in is whatever `agy` has in the OS keyring.
- Injected dependencies (`env`, `platform`, `runCommand`, `runManager`, `binaryManager`) keep core logic Electron-free and unit-testable.
- The child environment is an allowlist; API keys from Meow's own environment never reach `agy`.
- Default permission map sets bash to 'ask', meaning commands are soft-denied in headless runs unless the user explicitly allows bash in permission rules.
