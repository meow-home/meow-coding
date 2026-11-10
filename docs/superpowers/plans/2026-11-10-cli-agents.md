# CLI Agents (External Worker Sessions) Implementation Plan

Status: approved direction — implementation not started
Spec: [CLI Agents as Delegated Worker Sessions](../specs/2026-11-10-cli-agents-design.md)
Mockup: [`docs/design/cli-subagents-mockup/`](../../design/cli-subagents-mockup/index.html)

**Goal:** Antigravity CLI and OpenCode run as their own agents with their own sessions in the sidebar. The user gives
them tasks directly, and a Meow session can delegate a task to one of them, receive the result, verify it, and send
feedback — the same loop Claude → Meow uses today, in the opposite direction.

**Architecture:**

- `src/main/cli-agents/runtimes.ts` — static runtime catalog (binary names, min versions, install commands, flags).
- `src/main/cli-agents/binary-manager.ts` — detect on PATH + known dirs, version, guided install, manual path.
- `src/main/cli-agents/agents.ts` — agent records + `cli-agents.json`; defaults, status, activation.
- `src/main/cli-agents/profiles.ts` — OpenCode profile dirs, vault refs, Antigravity credential activation.
- `src/main/cli-agents/login-session.ts` — PTY login for `agy` / `opencode auth login`.
- `src/main/cli-agents/policy.ts` — agent mode + allow-list → CLI flags/settings; denied-action mapping.
- `src/main/cli-agents/run-manager.ts` — one child per task, env allowlist, queue, cancel, transcript.
- `src/main/cli-agents/parsers/{antigravity,opencode}.ts` — NDJSON → normalized items + terminal result.
- `src/main/cli-agents/session-store.ts` — `cli-sessions.json` + `<id>.jsonl`.
- `src/main/cli-agents/delegation-bridge.ts` — `SessionDelegationService` target `kind: 'cli'`.
- `src/main/cli-agents/index.ts` — `CliAgentsManager` facade used by IPC and the tool.
- `src/main/agent/tools/delegate-cli.ts` — the `delegate_cli` tool.
- Renderer: `components/cli/` (session pane, run transcript, agent picker), `Sidebar` agent grouping,
  `SettingsTab` "CLI Agents", delegation card in `components/chat/`.

**Tech Stack:** Electron 41, `@lydell/node-pty` (login PTYs), `@xterm/xterm` (login modal), React 19, TypeScript
strict, Vitest. No new npm runtime dependency for the first three phases.

## Global Constraints

- Source code, UI labels, `[meow]` notices, test names and docs are in **English**.
- Git commits: **do not** add a `Co-Authored-By` trailer. One commit per task.
- IPC strings only via `Channels` in `src/shared/ipc.ts`; `src/shared` imports no Node/Electron.
- Only the main process spawns/kills. Every exit path (cancel, timeout, session delete, agent switch, app quit)
  goes through `tree-kill`; no orphan `agy` / `opencode`.
- Do **not** change `buildSpawnCommand`; reuse its Windows `.cmd` shim handling for `opencode`.
- Menus/popups use `BaseDropdown` / `BaseSelect` / `BaseModal`; no custom overlay positioning.
- The renderer never receives tokens, keyring blobs or profile paths that contain secrets.
- Every code change updates the matching `AGENTS.md` entry and `docs/reference/*` page in the same commit, touching
  only the entries that changed and keeping each file's format.
- Before completion: `npm run typecheck`, `npm test`; `npm run build && npm run e2e` once session routing changes.
- Single test file: `npx vitest run <path>`.

## Design

### Types (`src/shared/types.ts`)

```ts
export type CliRuntimeId = 'antigravity' | 'opencode'
export type CliAgentKind = 'google' | 'gemini-key' | 'profile'
export type CliAgentStatus = 'ready' | 'needs-login' | 'quota' | 'disabled'
export type CliAgentMode = 'read' | 'edit' | 'full'
export type CliSessionStatus = 'idle' | 'running' | 'needs-attention' | 'failed'
export type CliTaskStatus =
  | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'interrupted'

export interface CliAgent {
  id: string
  runtime: CliRuntimeId
  kind: CliAgentKind
  label: string
  email?: string
  plan?: string
  provider?: string          // opencode only
  profileDir?: string        // relative to userData, opencode only
  model?: string
  mode: CliAgentMode
  status: CliAgentStatus
  active?: boolean           // antigravity google: the machine credential currently points here
  createdAt: number
  lastUsedAt?: number
}

export interface CliSessionMeta {
  id: string
  agentId: string
  projectPath: string
  cwd: string
  title: string
  status: CliSessionStatus
  cliConversationId?: string
  createdAt: number
  updatedAt: number
  delegatedBy?: { sourceAgentId: string; sourceSessionId: string; delegationId: string }
}

export type CliTranscriptItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | { kind: 'tool'; tool: string; input?: Record<string, unknown>; output?: string; error?: string; at: number }
  | { kind: 'notice'; level: 'info' | 'warn' | 'error'; text: string; at: number }
  | { kind: 'result'; status: CliTaskStatus; text: string; usage?: TokenUsage
      touchedFiles?: string[]; deniedActions?: string[]; at: number }

export interface CliRunEvent {
  sessionId: string
  item?: CliTranscriptItem
  status?: CliSessionStatus
}
```

`SessionDelegation` gains `targetKind?: 'session' | 'cli'`, `targetCliSessionId?: string`,
`targetCliAgentId?: string`; absent `targetKind` keeps the existing meaning.

### Constants (`src/main/cli-agents/constants.ts`)

| Name | Value |
|---|---|
| `MAX_CONCURRENT.antigravity` | 2 |
| `MAX_CONCURRENT.opencode` | 3 |
| `TASK_MAX_BYTES` | 32 KiB (reuse the delegation limit) |
| `RESULT_MAX_BYTES` | 64 KiB |
| `MAX_QUEUED_PER_AGENT` | 5 |
| `DEFAULT_TASK_TIMEOUT_MS` | 30 min |
| `LOGIN_TIMEOUT_MS` | 5 min |
| `TRANSCRIPT_MAX_BYTES` | 5 MiB per session, then rotate |
| `ENV_ALLOWLIST` | `PATH`, `Path`, `HOME`, `USERPROFILE`, `TMP`, `TEMP`, `LANG`, `LC_*`, `HTTP(S)_PROXY`, `NO_PROXY`, `SystemRoot`, `ComSpec`, `APPDATA`, `LOCALAPPDATA` |

### Runtime adapters

```ts
export interface CliRuntimeAdapter {
  id: CliRuntimeId
  minVersion: string
  binaryNames: string[]
  installCommand(platform: NodeJS.Platform): { file: string; args: string[] } | null
  versionCommand: string[]
  modelsCommand(agent: CliAgent): { file: string; args: string[]; env: NodeJS.ProcessEnv }
  loginCommand(agent: CliAgent): { file: string; args: string[]; env: NodeJS.ProcessEnv }
  buildTask(agent: CliAgent, task: string, policy: CliPolicy): { file: string; args: string[]; env: NodeJS.ProcessEnv }
  parseLine(line: string): CliParseResult | null   // { items, conversationId?, usage?, terminal? }
}
```

- Antigravity: `agy -p <task> --output-format stream-json --mode <accept-edits|plan> --settings <json>
  --print-timeout <ms> [--model] [--agent]`, plus `--dangerously-skip-permissions` for `full`.
- OpenCode: `opencode run <task> --format json --standalone [--model] [--agent] [--auto]`, env
  `XDG_DATA_HOME=<profile>`, `OPENCODE_DB=<profile>/opencode.db`.
- Both use `cwd` = session cwd; `stdout` parsed line by line; `stderr` collected as `notice` items, capped.

### Policy mapping (`policy.ts`)

| Agent mode | Antigravity | OpenCode |
|---|---|---|
| `read` | `--mode plan`, allow only `read_file(*)` / `search(*)` / `read_url(*)` | no `--auto`, agent `plan` if available |
| `edit` | `--mode accept-edits`, `permissions.allow` = workspace writes + project commands from `meow.json` permission rules | `--auto` with the same command allow-list via config content |
| `full` | `--dangerously-skip-permissions` | `--auto` |

`denied_actions` from the Antigravity `result` envelope and the OpenCode error events become `notice` items with
`level: 'warn'` plus a retry affordance (`allow once` re-runs the same conversation with a widened policy).

### IPC (`src/shared/ipc.ts`)

New `Channels` entries (names only; exact strings added there):

| Group | Channels |
|---|---|
| Status | `CliAgentsStatus`, `EventCliAgentsChanged` |
| Runtimes | `CliRuntimeDetect`, `CliRuntimeInstall`, `CliRuntimeSetPath`, `CliRuntimeSetEnabled` |
| Models | `CliModelsList` |
| Agents | `CliAgentAdd`, `CliAgentRename`, `CliAgentRemove`, `CliAgentActivate`, `CliAgentSetDefault` |
| Login | `CliLoginInput`, `CliLoginCancel`, `EventCliLogin` |
| Sessions | `CliSessionCreate`, `CliSessionRename`, `CliSessionDelete`, `CliSessionOpenTerminal`, `EventCliSessionsChanged` |
| Tasks | `CliTaskSend`, `CliTaskCancel`, `EventCliRun` |
| Delegation | `CliDelegationCancel` |

`tests/unit/ipc-contract.test.ts` is extended for every new channel and `AgentApi` method.

### Delegation flow

1. `delegate_cli` resolves the agent (label or id) and the target CLI session:
   - `session_id` given → validate it belongs to the same project and agent.
   - otherwise reuse the most recent non-terminal delegation's CLI session for the same `projectPath` + agent,
     else create one.
2. `SessionDelegationService.createCli(...)` queues the task (5 nonterminal per agent), records
   `targetKind: 'cli'`, `targetCliSessionId`, `targetCliAgentId`.
3. The bridge calls `CliAgentsManager.sendTask(sessionId, task, { delegationId })`.
4. On terminal status: result text, `touchedFiles`, `usage`, `deniedActions` are written into the delegation record;
   the source Meow session gets the existing result message + wake.
5. Cancel: Meow card → `cancelCliDelegation` → `cancelTask` (tree-kill) → delegation `cancelled`.
6. Restart: queued delegations resume; running ones become `interrupted`; CLI sessions keep their conversation id.

## Review Focus

- `policy.ts`: every mode maps to flags that cannot silently do nothing (the headless soft-deny trap).
- `run-manager.ts`: env allowlist, one process per session, tree-kill on every path, output caps.
- `parsers/*`: tolerate unknown events, partial lines, non-JSON stderr, and a missing terminal event.
- `session-store.ts`: atomic writes, transcript rotation, no secrets.
- Delegation: source session wake, feedback rounds, and restart recovery match the external-delegation behaviour.
- Renderer routing: CLI sessions must not break the existing Meow session pane, terminal dock or right panels.

## Task 0: Spikes (throwaway branch)

- [ ] OpenCode isolation: run `opencode auth login anthropic` with `XDG_DATA_HOME` + `OPENCODE_DB` in a temp profile,
      then `opencode run --standalone --format json` and confirm it uses only that profile (v2.2.7; repeat on v1.19.5
      to confirm `XDG_DATA_HOME` alone is enough).
- [ ] Antigravity stream: capture `agy -p … --output-format stream-json` for a read-only prompt, an edit prompt, a
      soft-denied command, an unknown model, and `--conversation <id>` resume; record exact event shapes.
- [ ] Antigravity policy: confirm `--settings` with `permissions.allow` works alongside `--mode accept-edits` and does
      not mutate `~/.gemini/antigravity-cli/settings.json`.
- [ ] Login PTY: confirm `agy` and `opencode auth login` work under `@lydell/node-pty` on Windows (ConPTY) and that the
      browser URL can be extracted from the output.
- [ ] Optional: read the `gemini`/`antigravity` keyring entry on Windows via PowerShell `CredRead` and restore it;
      decide whether the experimental switcher is feasible (P3 gate).

## Task 1: Shared types and IPC contract

- Add the types above to `src/shared/types.ts`, the delegation fields, and the channels/methods to
  `src/shared/ipc.ts` + `src/preload/index.ts`.
- Extend `tests/unit/ipc-contract.test.ts`.
- Update `docs/reference/05-ipc-contract.md` and `06-data-and-storage.md` skeletons.
- Verify: `npx vitest run tests/unit/ipc-contract.test.ts`, `npm run typecheck`.

## Task 2: Runtime catalog and binary manager

- `runtimes.ts`: catalog with labels, min versions (`agy >= 1.5`, `opencode >= 2.0`), install commands
  (`irm https://antigravity.google/cli/install.ps1 | iex`; `npm install -g @opencode/cli`), docs URLs.
- `binary-manager.ts`: resolve on PATH + known dirs (`%LOCALAPPDATA%\agy\bin`, npm global, `~/.opencode/bin`),
  `--version` parse, semver compare, install through a PTY (visible), manual path, update check.
- Unit tests with fake binaries in `tests/fixtures/cli-agents/`.

## Task 3: Agents, profiles and vault

- `agents.ts`: load/save `userData/cli-agents.json` atomically (reuse `atomic-write.ts`), CRUD, default agent,
  `active` bookkeeping for Antigravity, status transitions.
- `profiles.ts`: OpenCode profile dirs under `userData/cli-profiles/opencode/<agentId>/` (owner-only), vault refs
  `cli:agent:<id>` for Gemini API keys, optional keyring snapshot blobs.
- Unit tests: CRUD, default reassignment, removal wipes profile/vault, no secret in the JSON.

## Task 4: Login sessions (PTY)

- `login-session.ts`: spawn `agy` / `opencode auth login <provider>` in a PTY with the agent env, stream output,
  accept input, extract URLs, 5-minute timeout, cancel, kill on app quit.
- IPC: `CliAgentAdd` starts a login session and returns `loginId`; `CliLoginInput` / `CliLoginCancel` drive it;
  `EventCliLogin` streams chunks.
- Renderer modal: reuse `TerminalView` + `BaseModal`; "Open browser" opens the extracted URL.
- Antigravity Google: warn that the sign-in is machine-wide; save the previous credential first when snapshots are
  enabled.
- Tests: fake login script; timeout; cancel; no orphan.

## Task 5: Policy and parsers

- `policy.ts`: mode → flags/JSON; command allow-list derived from `meow.json` permission rules; `full` requires the
  agent-level opt-in.
- `parsers/antigravity.ts`: `init`, `step_update` (`agent_response`, `tool`, `subagent`, `checkpoint`), `result`
  (`status`, `usage`, `denied_actions`), unknown events ignored.
- `parsers/opencode.ts`: NDJSON text/tool/usage/error events; map to the same items.
- Pure unit tests with captured fixtures from Task 0.

## Task 6: Run manager

- `run-manager.ts`: per-session lock, runtime concurrency slots, queue, spawn with env allowlist, line parser,
  transcript append, `EventCliRun` push, timeout, cancel/tree-kill, terminal result normalization.
- Persist the transcript through `session-store.ts`; cap `stdout`/`stderr` buffers.
- Antigravity credential lock: a Google/snapshot task holds the machine lock for its duration; other Google tasks queue.
- Tests: fake binaries for completed / failed / cancelled / timeout / blocked / unknown event / partial line.

## Task 7: CLI session store and manager facade

- `session-store.ts`: index (`cli-sessions.json`) + JSONL transcripts, atomic writes, rotation, delete, rename.
- `CliAgentsManager` (`index.ts`): wires runtimes, agents, sessions, runs; exposes `sendTask`, `cancelTask`,
  `createSession`, `listModels`, `addAgent`, `removeAgent`, `activateAgent`.
- Main wiring in `src/main/index.ts`: construct after stores, restore sessions, stop all on quit.
- Tests: persistence across restart, transcript caps, deleting a running session cancels it.

## Task 8: Renderer — sidebar and session pane

- Extend the workspace/session view model with CLI sessions (per project), grouped by agent.
- Sidebar: Agents group (Meow + ready CLI agents), sessions under each agent, status dots, "New session with…".
- `CliSessionPane`: header (agent, model, mode, status, Stop, Open terminal), transcript items (markdown text, tool
  cards, notices, result card), composer; reuse `MarkdownText`, `ToolCallCard` primitives and `useChatScroll`.
- Route selection: `kind: 'meow' | 'cli'` in the session pane; hidden panes stay mounted.
- Verify: no regression in the existing chat, terminal dock, right panels.

## Task 9: Settings → CLI Agents

- New `CliAgentsTab` in `SettingsDialog` under Intelligence.
- Runtime cards, agent list with model/mode pickers, add-agent menu + login dialogs, delegation settings, defaults.
- Uses `BaseDropdown` / `BaseSelect` / `BaseModal`; no custom overlays.
- Update `src/renderer/src/components/settings/AGENTS.md`.

## Task 10: Delegation service extension

- Extend `SessionDelegation` + store + service with `targetKind: 'cli'`.
- `createCli({ sourceRun, targetCliAgentId, task, sessionId? })` with the same caps/queue.
- `finishTerminal` for CLI: write result/usage/files/denied actions; `appendResult` + `wakeSource` to the source
  Meow session (reuse the external-delegation path).
- `cancel` → `stopCliTask`; restart recovery.
- Tests: queue, caps, wake, cancel, restart, feedback into the same CLI session.

## Task 11: `delegate_cli` tool

- `src/main/agent/tools/delegate-cli.ts`, registered next to `delegate_session`.
- Schema: `{ agent: string, task: string, session_id?: string }`; user-origin runs only; returns
  `{ delegationId, cliSessionId, status: 'queued' }`.
- Description tells Meow to verify the result itself and not to edit the delegated scope while it runs.
- Unit test: schema, origin check, error when the agent is missing/needs login.

## Task 12: Delegation UI in the Meow chat

- Outgoing delegation card: agent, status, task, last step, elapsed, "Open CLI session", "Cancel".
- Result delivery: existing delegation result message + a card with stats, "Review diff", "Send feedback",
  "Open CLI session"; feedback composer (round n/3).
- Incoming-message meta: `ChatDelegationMeta` extended with `peerKind: 'session' | 'cli'` (optional field) so the UI
  can label "Delegated to Antigravity · Personal".
- Verify: result wake appends into the source session; cancel works from both sides.

## Task 13: Antigravity multi-account (P3)

- A: Google re-login flow when activating a non-active agent (with the warning and queueing).
- C: Gemini API key agents (`modelProvider` + per-run `GEMINI_API_KEY`), parallel-safe.
- B (approved, experimental): keyring snapshot save/restore via a small helper (PowerShell `CredRead`/`CredWrite` on
  Windows, `security` on macOS, `secret-tool` on Linux), encrypted in the vault, verified after each restore. Ships
  behind an off-by-default “Experimental account switching” toggle; the default path stays A + C.
- Agent activation takes the machine lock; every Antigravity Google run is serialized.

## Task 14: Terminal handoff and polish

- "Open in terminal" runs `agy --conversation <id>` / `opencode` in the existing session terminal dock, scoped to the
  CLI session's cwd.
- Empty states, error toasts, quota badges, session title rename, keyboard shortcuts.
- Prune transcripts per retention setting.

## Task 15: Docs and final verification

- Update `docs/reference/03-agent-runtime.md`, `05-ipc-contract.md`, `06-data-and-storage.md`,
  `07-providers-and-connections.md`, `08-integrations.md`, `09-ui-guide.md`, `11-conventions-and-pitfalls.md`.
- New `src/main/cli-agents/AGENTS.md` + `CLAUDE.md`; update `src/main/AGENTS.md`,
  `src/renderer/src/components/{settings,chat,cli}/AGENTS.md`.
- Run `npm run typecheck`, `npm test`, `npm run build && npm run e2e`.
- Manual matrix: install → sign in → direct task → resume → delegate → feedback → switch Antigravity account →
  quit mid-run (no orphans) → restart (interrupted/queued recovery).

## Commit plan

One commit per task, in order. Suggested messages:

1. `feat(cli-agents): shared types and IPC contract`
2. `feat(cli-agents): runtime catalog and binary detection`
3. `feat(cli-agents): agent and profile store`
4. `feat(cli-agents): PTY login sessions`
5. `feat(cli-agents): policy mapping and event parsers`
6. `feat(cli-agents): run manager`
7. `feat(cli-agents): session store and manager facade`
8. `feat(cli-agents): sidebar and CLI session pane`
9. `feat(cli-agents): settings tab`
10. `feat(cli-agents): delegation service target`
11. `feat(cli-agents): delegate_cli tool`
12. `feat(cli-agents): delegation UI`
13. `feat(cli-agents): antigravity multi-account activation`
14. `feat(cli-agents): terminal handoff and polish`
15. `docs(cli-agents): reference and agent docs`
