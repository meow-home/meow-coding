# CLI Agents as Delegated Worker Sessions — Design / Brainstorm

Date: 2026-11-10 · Status: **implemented** — Tasks 0–13 + docs; Task 14 (terminal handoff) and option B (keyring snapshots, P4) deferred
[2026-11-10-cli-agents.md](../plans/2026-11-10-cli-agents.md) (implemented)
Mockup: [`docs/design/cli-subagents-mockup/`](../../design/cli-subagents-mockup/index.html)
Scope: install and sign in to external coding CLIs from Settings, give them tasks directly, and let a Meow session
delegate a task to them the same way Claude delegates to Meow.

## 1. Direction

The first draft treated the CLIs as Meow sub-agents (a `cli_task` tool call with Meow's role/permission wrapping).
That is the wrong model. The CLI agent has its own loop, tools, permission engine, context window and conversation
history; wrapping it as a restricted tool call throws all of that away.

This design makes a CLI agent a **first-class worker**:

- An **agent** is a CLI runtime signed in with an account: `Antigravity · Personal`, `OpenCode · Anthropic Work`.
- An **agent session** is one conversation with that agent, listed in the sidebar next to Meow sessions. The user
  gives it any task, watches it work, stops it, or continues it.
- **Meow delegates** a task into an agent session and gets the result back when it finishes — the same
  queue → run → result → feedback loop the existing Claude → Meow integration uses, in the opposite direction.

```
User ──────────────▶ Meow session ──delegate_cli──▶ CLI agent session ──▶ result wakes the Meow session
  └────────────────▶ CLI agent session (direct: any task, any time)
```

Not in scope: a CLI agent delegating back into Meow. The existing external API already covers Claude → Meow.

## 2. Research: what the CLIs support (verified 2026-11-10)

### 2.1 Antigravity CLI — `agy` 1.5.4 (Windows, installed locally)

| Capability | Reality |
|---|---|
| Headless run | `agy -p "<task>"` |
| Structured output | `--output-format json\|stream-json` — NDJSON: `init`, `step_update` (text / tool / subagent / checkpoint), `result` |
| Multi-turn | `--conversation <id>`, `-c`; `--input-format stream-json` keeps one process alive for many turns |
| Model / effort / agent | `--model`, `--effort`, `--agent` (`agy models`, `agy agents`) |
| Per-run settings | `--settings '<json>'` — session-only, never saved |
| Permissions | `permissions.allow/ask/deny` with `action(target)` rules (`command(git status)`, `write_file(*)`, `read_url(...)`) |
| Headless permission | A tool that would ask is **soft-denied**: exit `0`, empty `response`, stderr notice, JSON `denied_actions` |
| Auto-approve | `--dangerously-skip-permissions` |
| Auth | OS keyring (`zalando/go-keyring`, service `gemini`, user `antigravity`), shared with the Antigravity app; `/logout` clears it |
| Other auth | `GEMINI_API_KEY` + `modelProvider: "gemini"` per process; `AGY_ADC_AUTH` for Google Cloud ADC |
| **Profiles** | **None.** No `--profile` / `--account` / `--auth-store` / config-dir override. `AGY_ACCOUNT` in the binary refers to **plugin accounts**, not Google sign-in |

Verified locally: a plain headless run soft-denied `run_command` and still exited `0`; the same prompt with
`--settings '{"permissions":{"allow":["command(*)","write_file(*)"]}}'` completed and wrote the file.
`agy models` currently lists Gemini 3.8 Flash (high/medium/low), Claude Sonnet 4.6, Claude Opus 4.6 Thinking,
GPT-OSS 120B.

**Conclusion:** drivable headless, resumable by conversation id, policy injectable per run — but only **one Google
sign-in per machine**.

### 2.2 OpenCode — v2 (`@opencode/cli` 2.2.7; legacy `opencode-ai` 1.19.5)

| Capability | Reality |
|---|---|
| Headless run | `opencode run "<task>"` with `--model`, `--agent`, `--session`, `--continue`, `--file`, `--auto`, `--archived` |
| Structured output | `--format json` (newline-delimited) |
| Isolation | `--standalone` private server; `XDG_DATA_HOME` and `OPENCODE_DB` move its SQLite DB |
| Accounts | v2: several accounts per provider — `auth login`, `auth list [--format json]`, `auth switch`, `auth logout`, `auth export/import` |
| Credential store | the server's SQLite DB (`opencode debug paths db`), default `~/.local/share/opencode/opencode.db` |
| Login UX | API-key / auth-code entry needs a TTY; OAuth offers a browser URL or device code |
| Install | `curl -fsSL https://opencode.ai/v2/install \| bash`, `brew install anomalyco/tap/opencode-v2`, `npm install -g @opencode/cli`; no PowerShell installer, so Windows uses npm or a managed binary |

**Conclusion:** OpenCode has native multi-account; per-account **profiles** (data dir + DB) give real isolation and
parallelism without global `auth switch`.

## 3. Product model

### 3.1 Agents

An agent is `runtime + account + defaults`:

| Field | Example |
|---|---|
| `id` | `agy_personal` |
| `runtime` | `antigravity` \| `opencode` |
| `label` | `Antigravity · Personal` |
| `account` | Google sign-in, Gemini API key, or OpenCode profile |
| `model` | `claude-sonnet-4-6` / `anthropic/claude-sonnet-5-5` |
| `mode` | `read` \| `edit` \| `full` (maps to CLI flags) |
| `status` | `ready` \| `needs-login` \| `quota` \| `disabled` |

Agents are created in **Settings → CLI Agents** and appear in the sidebar and in “New session with…”.

### 3.2 Sessions

A CLI session is one conversation with an agent, in one project:

| Field | Notes |
|---|---|
| `id` | Meow id; the CLI's own id is stored beside it |
| `agentId`, `projectPath`, `cwd` | `cwd` defaults to the project root |
| `cliConversationId` | `agy` `conversation_id` / OpenCode `ses_…`; used to resume |
| `title` | First task, trimmed; renameable |
| `status` | `idle` \| `running` \| `needs-attention` \| `failed` |
| `transcript` | Normalized items: user, assistant text, tool step, notice, result |
| `delegatedBy?` | `{ sourceAgentId, sourceSessionId, delegationId }` when Meow started the task |

Sessions are listed per project, grouped by agent, and sorted like Meow sessions. Selecting one renders the CLI
session pane instead of the Meow chat. The CLI owns the context; Meow never compacts or rewrites it.

### 3.3 Tasks

A task is a user message inside a CLI session. The agent runs it with its own loop and permissions. A session runs
one task at a time; several sessions of the same agent may run in parallel up to the runtime cap. Antigravity
Google accounts are serialized machine-wide (one keyring credential); Gemini API key agents and OpenCode profiles
are parallel-safe.

### 3.4 Delegation (Meow → CLI)

Mirrors the Claude → Meow flow:

1. Meow calls `delegate_cli({ agent, task, session_id? })`.
2. The task is queued into a CLI session (new session, or the given one for a feedback round).
3. Meow returns immediately and keeps working; the delegation is visible in its transcript.
4. When the CLI task finishes, its final answer, touched files, usage and denied actions are appended to the source
   Meow session and the session is woken, exactly like `SessionDelegationService` does for external clients.
5. Meow verifies independently (`git diff`, tests) and may send up to 3 feedback rounds into the same CLI session.
6. Cancel is available from both the Meow card and the CLI session.

The tool is only available to user-origin Meow runs (same rule as `delegate_session`), which prevents recursion.

## 4. Decisions

| Topic | Decision |
|---|---|
| CLI agent role | Peer worker with its own loop and permissions — **not** a Meow sub-agent |
| Visibility | CLI sessions are first-class sidebar sessions, not hidden tool cards |
| Delegation tool | New `delegate_cli` (queue + wake, like `delegate_session`) |
| Result delivery | Appended to the source Meow session as a delegation result message; the session wakes |
| Feedback | `delegate_cli` with `session_id` continues the same CLI conversation; max 3 rounds per plan task |
| Session reuse | Default one CLI session per delegated plan/project; `session_id` for feedback |
| Accounts | Agents are accounts; OpenCode = profile per account; Antigravity = one active Google account, Gemini API key agents in parallel, keyring snapshots experimental and off by default (see 6) |
| Install | Detect first; guided install runs in a visible terminal; never silent |
| Permission policy | Per agent (`read` / `edit` / `full`), injected with `--settings` / `--auto`; blocked actions surface in the transcript |
| Concurrency | Per runtime cap (Antigravity 2, OpenCode 3) plus one task per session; Antigravity Google serialized |
| Secrets | Vault for API keys/snapshots; owner-only profile dirs; never in logs or the renderer |

## 5. Architecture

```
renderer: Sidebar (agents + sessions) · CliSessionPane · DelegationCard · Settings → CLI Agents
    │ IPC
main:
  CliAgentManager      runtimes, accounts, install, login, model lists
  CliSessionStore      userData/cli-sessions.json + <id>.jsonl
  CliRunManager        spawn → NDJSON → normalized events → transcript; queue, cancel, tree-kill
  CliDelegationBridge  SessionDelegationService with targetKind 'cli'
  agent tool           delegate_cli
```

New module `src/main/cli-agents/`:

| File | Responsibility |
|---|---|
| `runtimes.ts` | Catalog: id, binary, min version, install commands, model/agent list commands |
| `binary-manager.ts` | Detect on PATH + known dirs, version, guided install, manual path |
| `agents.ts` | Agent CRUD, defaults, status; `cli-agents.json` |
| `profiles.ts` | OpenCode profile dirs, vault refs, Antigravity credential activation |
| `login-session.ts` | PTY login for `agy` / `opencode auth login`, streamed into a modal |
| `policy.ts` | Agent mode → flags + `--settings` permissions; maps `denied_actions` |
| `run-manager.ts` | One child process per task; env allowlist; parser dispatch; transcript persistence; cancel |
| `parsers/antigravity.ts`, `parsers/opencode.ts` | Normalize NDJSON into `CliTranscriptItem` + terminal result |
| `session-store.ts` | CLI session index + JSONL transcripts; titles; delegatedBy |
| `delegation-bridge.ts` | `runCliTask` / `stopCliTask` for `SessionDelegationService` |
| `index.ts` | `CliAgentsManager` facade for IPC and the tool |

`src/main/index.ts` owns the manager, restores sessions, stops all runs on quit, and forwards run events.

### 5.1 Spawn matrix

| Runtime | Account kind | Command | Env |
|---|---|---|---|
| Antigravity | Google | `agy -p <task> --output-format stream-json --mode accept-edits --settings <policy> [--model] [--agent] [--print-timeout]` | minimal env; **no** inherited `*_API_KEY` |
| Antigravity | Gemini key | same + `--settings '{"modelProvider":"gemini",…policy}'` | `GEMINI_API_KEY=<account key>` |
| Antigravity | Snapshot | same as Google after restoring the credential and taking the machine lock | minimal env |
| OpenCode | any profile | `opencode run <task> --format json --standalone [--model] [--agent] [--auto]` | `XDG_DATA_HOME=<profile>` (v1 + v2), `OPENCODE_DB=<profile>/opencode.db` (v2) |

Windows: `.cmd` shims (`opencode`) go through `cmd.exe` like `buildSpawnCommand`; `agy.exe` spawns directly.
Cancel and quit use `tree-kill`.

### 5.2 Run lifecycle

1. Resolve agent → session → policy → env.
2. Take the session lock and a runtime slot (and the Antigravity credential lock when needed).
3. Spawn; parse events; append `CliTranscriptItem`s; push `CliRunEvent`s to the renderer.
4. Terminal result: final text, `cliConversationId`, usage, touched files, denied actions, status.
5. Persist transcript, release locks, mark the session idle.
6. If the task came from a delegation, hand the result to `SessionDelegationService` → wake the source.
7. Cancel/timeout/quit → tree-kill, status `cancelled`/`timeout`, same delivery path.

### 5.3 Delegation integration

`SessionDelegation` gains optional fields (existing records stay valid):

```ts
targetKind?: 'session' | 'cli'   // absent = 'session'
targetCliSessionId?: string
targetCliAgentId?: string
```

`DelegationRuntime` gains `runCliTask(input)` / `stopCliTask(sessionId)` / `resolveCliAgent(id)`.
The service keeps its queue (5 nonterminal per target), 32 KiB task cap, 64 KiB result cap, FIFO per target,
restart recovery (queued → resume, running → interrupted), and wake semantics. A CLI delegation's result is the
CLI's final answer plus a short machine-readable footer (files, usage, denied actions); Meow must still verify.

## 6. Accounts and switching

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. One active Google account** | `/logout` + browser sign-in; agents remember a label | Supported, no hacks | Switching costs a browser round-trip; cannot keep several ready |
| **B. Keyring snapshots (experimental)** | Read/write the `gemini`/`antigravity` credential, encrypted copies in the vault; activating an agent restores its blob | Pre-login many accounts, ~1 s switch, can decode the ID token for the email | Machine-wide; every `agy` process must be closed; may break on CLI updates; unsupported by Google |
| **C. Gemini API key agents** | `modelProvider: "gemini"` + per-run `GEMINI_API_KEY` | Isolated, parallel, no keyring | AI Studio quota, not the Pro/Ultra subscription |
| **D. Enterprise ADC** | `AGY_ADC_AUTH` + credentials per profile | Proper enterprise isolation | Enterprise only |

**Approved 2026-11-10:** ship **A + C** as supported and **B** as an experimental switch, **off by default**. With
agents, switching is automatic: starting a task in `Antigravity · Work` activates that agent's credential (or asks
to sign in when snapshots are off) and queues other Antigravity Google tasks until the swap finishes.

OpenCode needs none of this: each account is a profile directory, so agents never share credentials.

## 7. Data model and storage

`userData/cli-agents.json`:

```jsonc
{
  "version": 1,
  "runtimes": {
    "antigravity": { "enabled": true, "binaryPath": "C:\\…\\agy.exe", "version": "1.5.4", "maxConcurrent": 2 },
    "opencode":    { "enabled": true, "binaryPath": "C:\\…\\opencode.cmd", "version": "2.2.7", "maxConcurrent": 3 }
  },
  "agents": [
    { "id": "agy_personal", "runtime": "antigravity", "label": "Antigravity · Personal", "kind": "google",
      "email": "user@gmail.com", "model": "claude-sonnet-4-6", "mode": "edit", "status": "ready", "active": true },
    { "id": "oc_work", "runtime": "opencode", "label": "OpenCode · Anthropic Work", "kind": "profile",
      "provider": "anthropic", "profileDir": "cli-profiles/opencode/oc_work", "model": "anthropic/claude-sonnet-5-5",
      "mode": "edit", "status": "ready" }
  ],
  "defaultAgentId": "agy_personal",
  "delegation": { "allow": true, "maxRounds": 3, "maxNonterminalPerAgent": 5 }
}
```

`userData/cli-sessions.json` + `userData/cli-sessions/<id>.jsonl`:

```jsonc
{ "id": "cs_1", "agentId": "agy_personal", "projectPath": "C:\\…\\meow-coding", "cwd": "C:\\…\\meow-coding",
  "cliConversationId": "8f3c1a…", "title": "Billing review", "status": "idle", "createdAt": 0, "updatedAt": 0,
  "delegatedBy": { "sourceAgentId": "…", "sourceSessionId": "…", "delegationId": "dl_1" } }
```

Secrets: vault refs `cli:agent:<agentId>` for API keys and snapshots; OpenCode profiles are owner-only dirs under
`userData/cli-profiles/opencode/<agentId>/`.

## 8. IPC

All channels through `Channels` in `src/shared/ipc.ts`; `AgentApi` gains:

| Method | Purpose |
|---|---|
| `getCliAgentsStatus()` | runtimes, agents, sessions, delegation settings, active runs |
| `detectCliRuntime` / `setCliRuntimePath` / `installCliRuntime` / `setCliRuntimeEnabled` | runtime management |
| `listCliModels(runtime, agentId)` / `listCliAgents()` | pickers |
| `addCliAgent(runtime, kind, provider?)` → `loginId`; `cliLoginInput` / `cancelCliLogin` | account setup |
| `renameCliAgent` / `removeCliAgent` / `activateCliAgent` / `setDefaultCliAgent` | agent management |
| `createCliSession(agentId, projectPath)` / `deleteCliSession(id)` / `renameCliSession` | sessions |
| `sendCliTask(sessionId, text)` / `cancelCliTask(sessionId)` / `openCliSessionTerminal(sessionId)` | direct use |
| `cancelCliDelegation(delegationId)` | Meow-side cancel |
| Events | `EventCliAgentsChanged`, `EventCliLogin`, `EventCliRun(sessionId, item)`, `EventCliSessionsChanged` |

## 9. UI

Mockup: `docs/design/cli-subagents-mockup/` — `settings.html`, `session.html`, `delegation.html`.

1. **Sidebar** — agents with their sessions; status dot per session (running / needs attention); “New session with…”
   lists Meow and every ready CLI agent.
2. **CLI session pane** — agent header (model, mode, account, status), transcript of tasks + streamed steps + tool
   cards + blocked-action notices, completion summary (files, tokens, conversation id), composer for the next task.
3. **Meow delegation card** — outgoing delegation with status, last step, “Open CLI session”, cancel; on completion
   the result, verification and “Send feedback” composer appear in the Meow transcript.
4. **Settings → CLI Agents** — runtimes, agents (model, mode, account, activate, remove), add-account flows,
   delegation settings, policy, concurrency.
5. **Session terminal** — “Open in terminal” resumes the same CLI conversation in the existing terminal dock.

## 10. Permissions and security

- The CLI agent's permission engine is authoritative. Meow sets the agent's mode (`read` / `edit` / `full`) and a
  per-run allow-list; it does not rewrite the CLI's rules.
- Headless CLIs cannot ask; a blocked action is a visible “needs attention” item with “Allow once & retry” and
  “Always allow for this agent”. The task continues from the same conversation.
- Environment allowlist for child processes: PATH, HOME/USERPROFILE, TEMP, locale, proxy; drop Meow's provider keys
  so a CLI cannot bill a different account.
- `cwd` must resolve inside the session project (symlink check); transcripts are ANSI-stripped and capped.
- Delegation is only available to user-origin Meow runs; the task text and result are capped; no recursion.
- No new listening socket; child processes are tree-killed on cancel, session delete, agent switch and quit.

## 11. Errors and edge cases

| Case | Behaviour |
|---|---|
| Binary missing | Settings card “Not installed”; starting a session offers install |
| Not signed in | Agent `needs-login`; session start asks to sign in |
| Version too old | Require `agy >= 1.5`, `opencode >= 2.0` for multi-account; v1 runs single-profile |
| Soft-denied action | `needs-attention` + allow-once/always; run continues after retry |
| Quota exhausted | Agent `quota`; error text surfaced; queued tasks wait or fail with a clear message |
| Timeout | `--print-timeout` from the agent policy; tree-kill; status `timeout` |
| Delegation target busy | Queued FIFO per agent; visible as “queued” in the Meow card |
| App restart | Queued delegations resume; running ones become `interrupted`; sessions keep their CLI conversation id |
| Windows PATH | Detect known install dirs so a fresh install works without restarting Meow |

## 12. Phases

| Phase | Scope | Est. |
|---|---|---|
| P0 spike | OpenCode profile isolation (`--standalone` + `OPENCODE_DB` + `XDG_DATA_HOME`), `agy` stream parsing, `--conversation` resume, policy JSON | 0.5–1 d |
| P1 | Agents + accounts + Settings, install/login, CLI sessions (user → agent), streaming transcript, terminal handoff | 4–5 d |
| P2 | Meow → CLI delegation (`delegate_cli`, queue, result wake, feedback rounds, cancel) | 3–4 d |
| P3 | Sidebar grouping, new-session picker, Antigravity multi-account switching (A + C, optional B), polish, docs | 2–3 d |

## 13. Testing

- Unit: runtime detection, policy mapping, NDJSON parsers, session store, queue/caps, delegation target resolution,
  restart recovery, transcript caps.
- Integration: fake `agy` / `opencode` binaries emitting the documented streams; assert transcript items, result,
  cancel/tree-kill, timeout, blocked actions, delegation wake.
- Manual: install → sign in → direct task → resume → delegate from Meow → feedback → switch Antigravity account.
- Required: `npm run typecheck`, `npm test`; `npm run build && npm run e2e` if session routing changes.

## 14. Docs to update when implemented

`docs/reference/03-agent-runtime.md` (delegation tool), `05-ipc-contract.md`, `06-data-and-storage.md`
(`cli-agents.json`, CLI sessions), `07-providers-and-connections.md` (accounts), `08-integrations.md`,
`09-ui-guide.md` (sidebar, session pane, Settings), `src/main/AGENTS.md`, new
`src/main/cli-agents/AGENTS.md`, `src/renderer/src/components/settings/AGENTS.md`.

## 15. Open questions for approval

1. Antigravity accounts: A (re-login) + C (Gemini API keys) only, or also B (experimental keyring snapshots)?
2. Session reuse for delegation: one CLI session per plan/project (proposed, like Claude → Meow), or a new session
   per task?
3. Default agent mode: `edit` with workspace auto-approval (proposed), or `read` until the user opts in?
4. Should a CLI session keep running when the user switches away or closes the app to tray? (Proposed: yes while the
   app runs; runs are stopped on quit.)
5. Is “Open in terminal” enough for interactive permission prompts, or do we need an ACP/serve integration later?
