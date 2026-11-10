# AGENTS.md — src/main/cli-agents

CLI agent subsystem: manages external coding CLIs (Antigravity `agy`, OpenCode `opencode`) as first-class workers.

## Key files

- `runtimes.ts` — static runtime catalog for Antigravity (`agy`, min version 1.5.0) and OpenCode (`opencode`, min version 2.0.0), platform install command descriptors, docs URLs, models commands.
- `binary-manager.ts` — `CliBinaryManager`: resolves binaries on PATH and known install directories (`%LOCALAPPDATA%\agy\bin`, npm global, `~/.opencode/bin`), parses `--version`, compares semver, supports manual path override, generates install descriptors. Electron-free.
- `agents.ts` — `CliAgentStore`: CRUD for agents, `defaultAgentId`, Antigravity `active` Google account bookkeeping, status transitions, versioned `cli-agents.json` atomic store. Refuses to persist secrets.
- `profiles.ts` — `CliProfileManager`: OpenCode profile directories (`userData/cli-profiles/opencode/<agentId>/`, created owner-only), vault secret storage (`cli:agent:<agentId>`), removal cleanup wiping both directory and vault secret. Injected `VaultLike` interface.

## Conventions

- No secrets in `cli-agents.json`. Secrets are stored exclusively in the vault under `cli:agent:<id>` or inside owner-only profile directories.
- Injected dependencies (`userDataDir`, `env`, `platform`, `vault`) keep core logic Electron-free and unit-testable.
- Only one Antigravity Google agent may have `active: true` at a time on a machine.
