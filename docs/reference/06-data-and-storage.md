# 06 — Data & Storage

Everything Meow Coding persists, where it lives, and what it contains.

## 6.1 Locations

**`userData`** is Electron's per-user application directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Meow Coding` |
| macOS | `~/Library/Application Support/Meow Coding` |
| Linux | `~/.config/Meow Coding` |

It can be overridden with the **`MEOW_USER_DATA`** environment variable — this is how e2e tests get
an isolated profile (`app.setPath('userData', process.env.MEOW_USER_DATA)` runs before anything else
in `src/main/index.ts`).

**Project-level** configuration lives in `<project>/.meow/` and in `AGENTS.md` / `CLAUDE.md` files.

## 6.2 `userData` inventory

| Path | Written by | Format | Notes |
|---|---|---|---|
| `meow.json` | `agent/config.ts` `writeMeowConfig` | object | The whole agent configuration; see [6.3](#63-meowjson-reference) |
| `delegations.json` | `session-delegation-store.ts` | `SessionDelegation[]` | Durable record of session-to-session delegation runs; see [6.4](#64-session-format) below |
| `workspaces.json` | `workspace-store.ts` | `Workspace[]` | Project path, name, agents (id, name, templateId, cwd, kind, mode, variant, model, accountId, background) |
| `projects/<encoded>/<sessionId>.jsonl` | `agent/session-file-store.ts` | JSONL records | **Current session storage** — one append-only file per session, one JSON object per line. See [6.4](#64-session-format) |
| `sessions-index.json` | `agent/session-file-store.ts` | `SessionIndexEntry[]` | Lightweight session summaries (id, agentId, projectPath, title, messageCount, timestamps, usage) so listing does not parse every transcript. Debounced; rebuilt by scanning `projects/` when missing or corrupt (parked as `.corrupt`). See [6.4](#64-session-format) |
| `sessions.json.migrated-bak` | `agent/session-migrate.ts` | `StoredSession[]` | The legacy single-file store, kept as a backup after the one-time migration. Never deleted |
| `.sessions-migrated-v1` | `agent/session-migrate.ts` | timestamp text | Flag for the one-time `sessions.json` -> per-session jsonl migration (flag-guarded, idempotent) |
| `.sessions-model-reset` | `fresh-start.ts` (boot block in `index.ts`) | timestamp text | Flag for the one-time **destructive** v0.37 model switch (every project reset to one native session, `sessions.json` deleted). Written only after the reset succeeds, so an absent flag means the migration is retried on the next launch |
| `snapshots.json` | `agent/snapshot.ts` | `SnapshotTurn[]` | `{ agentId, ts, before: {path: content}, after: {path: content} }`, max 50 turns |
| `permissions.json` | `agent/saved-permissions.ts` | `SavedPermission[]` | "Always allow" decisions per (project, tool) |
| `learned-limits.json` | `agent/learned-limits.ts` | `LearnedLimitEntry[]` | Debounced 500ms; keyed `baseUrl\|model`; values only ever tighten |
| `commands.json` | `agent/commands.ts` `CommandStore` | `Command[]` | User slash commands |
| `models.json` | `models-catalog.ts` | object | Cached models.dev catalog (falls back to the bundled `models-snapshot.json`) |
| `remote.json` | `remote/remote-settings.ts` | object | `{ enabled, relayUrl, deviceId, sessionToken? }` |
| `external-api.json` | `external-api/config-file.ts` | object | `{ enabled, port, token, cliPath }` for the external-delegation loopback API; `token` is 32 random bytes (hex), created once and kept until `regenerateToken()`; `port` is `null` when not listening; mode `0600` on POSIX. See [08 — Integrations](08-integrations.md#86-external-delegation-claude-code--meow) |
| `bin/meow-delegate.mjs` | `external-api/manager.ts` | file | The external-delegation CLI, copied from `resources/external-api/meow-delegate.mjs` on every app start |
| `logs/<agentId>.log` | `log-manager.ts` | text | Raw PTY output, append-only |
| `logs/<YYYY-MM-DD>-log.txt` | `system-logger.ts` | text | App-wide system log (main/render/agent), append-only, pruned after 7 days on startup |
| `truncation/<agentId>-<toolId>.txt` | `agent/truncation.ts` | text | Full text of truncated tool output; cleaned up after 7 days on startup |
| `connections/index.json` | `connections/connection-store.ts` | `{ version: 1, accounts: ConnectionAccount[] }` | **Metadata only** — never secrets |
| `connections/vault.json` | `vault.ts` | `{ ref: base64 }` | `safeStorage`-encrypted secrets |
| `connections/runtime/` | `connections/codex-proxy-manager.ts` | random owner-only dir | Sidecar config containing OAuth tokens; removed on graceful shutdown, stale dirs cleaned at next launch |
| `browser-screenshots/`, `browser-snapshots/` | `browser/bridge.ts` | png / text | Page screenshots and structure snapshots produced by `browser_*` tools |
| `browser-extension/` | `browser/chrome-launcher.ts` | files | The unpacked MV3 extension copied from the build output so the user can Load unpacked |
| `skills/` | user | `*.md` or `<name>/SKILL.md` | User-level skills |
| `agents/` | user | `*.md` | User-level subagent roles |
| `tools/` | user | `*.js` / `*.cjs` | User-level tools |

### `JsonStore` write semantics

`createJsonStore<T>(filePath, { debounceMs })` (`src/main/json-store.ts`):

- The in-memory cache is authoritative — the file is owned by this process, so `load()` never
  re-parses after the first read. (Re-parsing on every read made long sessions quadratic: the agent
  loop reads the transcript several times per step.)
- Writes are atomic: serialize → write `<file>.tmp` → `rename`.
- On Windows a rename over an existing file can throw `EPERM`/`EACCES`/`EBUSY` while the destination
  is transiently locked (antivirus, Search Indexer, OneDrive). The rename is retried with backoff
  `[10, 20, 40, 80]ms`, then falls back to an in-place `writeFileSync`.
- With `debounceMs > 0`, saves are batched and a `process.on('exit')` hook flushes them; `flush()`
  forces a write (called from `MeowAgentManager.dispose`).
- A file that fails to parse is **renamed to `<file>.corrupt`** rather than discarded, and the store
  starts empty.

## 6.3 `meow.json` reference

The complete configuration of the native agent. Missing keys are filled by `mergeDefaults`, so a
partially hand-written file is valid. The UI (Settings) reads it through `configToSettings` and
writes it through `settingsToConfig`.

```jsonc
{
  // ── Providers ────────────────────────────────────────────────────────────
  "provider": {
    "anthropic": {
      "keyRef": "provider:anthropic",     // preferred: reference into the vault
      "apiKey": "",                       // plaintext fallback when safeStorage is unavailable
      "apiKeyEnv": "ANTHROPIC_API_KEY",   // env fallback when neither is set
      "baseUrl": "https://api.anthropic.com",
      "models": ["claude-sonnet-4-5"],
      "providerType": "deepseek"          // optional: forces provider-specific API handling
    }
  },
  "model": "anthropic",                   // the DEFAULT PROVIDER id (historical key name)

  // ── Agents ───────────────────────────────────────────────────────────────
  "agents": {
    "meow": {
      "provider": "anthropic",            // optional per-agent provider override
      "model": "anthropic/claude-sonnet-4-5",  // "provider/model", or a bare provider id (legacy)
      "accountId": "codex-…",             // for account-scoped providers
      "systemPrompt": "You are Meow, a coding agent…"
    }
  },

  // ── Permissions ──────────────────────────────────────────────────────────
  "permission": {                          // merged over DEFAULT_MEOW_CONFIG.permission
    "read": "allow", "write": "allow", "edit": "allow", "glob": "allow", "grep": "allow",
    "apply-patch": "allow", "todowrite": "allow", "task": "allow", "revert": "allow",
    "skill": "allow", "question": "allow", "browser_*": "allow",
    "bash": "ask", "office": "ask"
  },

  // ── MCP servers ──────────────────────────────────────────────────────────
  "mcp": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"], "env": {} },
    "remote-thing": { "url": "https://mcp.example.com/sse", "headers": { "Authorization": "Bearer token" } }
  },

  // ── Budgets ──────────────────────────────────────────────────────────────
  "maxContextTokens": 200000,   // optional override; otherwise resolved (learned/live/catalog/128k)
  "maxOutputTokens": 32000,     // optional override; absent = min(known model limit, 32000) is sent
  "maxSteps": 100,              // steps per uninterrupted run (DEFAULT_MAX_STEPS)
  "subagentMaxSteps": 30,       // DEFAULT_SUBAGENT_MAX_STEPS

  // ── Compaction ───────────────────────────────────────────────────────────
  "compaction": {
    "auto": true,               // enable automatic compaction
    "tailTurns": 2,             // turns kept verbatim (also = keepFullTurns for tool-output caps)
    "buffer": null,             // undefined/absent = auto (15% of context, floor 10000)
    "keepTokens": null,         // undefined = auto (6%, floor 4000, clamped to half usable)
    "toolOutputMaxChars": null  // undefined = auto (1.5%, floor 1500)
  },

  // ── Tool output ──────────────────────────────────────────────────────────
  "toolOutput": { "maxBytes": 51200, "maxLines": 2000 },
  "mcpOutput":  { "maxTokens": 25000 },     // absent = DEFAULT_MCP_OUTPUT_TOKENS
  "sampling": { "glm-*": { "temperature": 0.7 } }, // optional per-model override of the built-in presets (temperature/topP/frequencyPenalty/presencePenalty); OpenAI-compatible providers only

  // ── Integrations ─────────────────────────────────────────────────────────
  "lsp": { "enabled": true, "diagnosticsTimeoutMs": 3000 },
  "notifications": { "needsInput": true, "onDone": true },

  // ── Subagent model overrides ─────────────────────────────────────────────
  "subagentModels": {
    "research": { "provider": "anthropic", "model": "claude-haiku-4-5" }
  }
}
```

### Normalization rules worth knowing

- **`provider.<id>.models`** accepts a legacy singular `model` string and lifts it into an array.
  Empty/blank entries are dropped.
- **`ollama-cloud`** base URLs are forcibly normalized to `https://ollama.com/v1`. Ollama's docs list
  `https://ollama.com/api`, which is the *native* REST API with no `/chat/completions` — requests
  would 404. Self-hosted Ollama on another host is left alone.
- **`agents.<name>.model`** without a `/` is treated as a *provider* reference (legacy format), not a
  model id.
- **`mcp.<name>.command`** containing spaces is split into `command` + `args` when `args` is empty.
- **`subagentModels`** entries are dropped unless the referenced provider+model exists in
  `provider` — except account-scoped refs (`accountId` present), which resolve through the
  connection subsystem instead.
- **API keys must be printable ASCII.** `connectProvider` rejects anything else with an actionable
  English `[meow]` message, and the LLM stream guards it again for keys stored before that check
  existed.
- **`settingsToConfig`** sets `apiKeyEnv: "<ID>_API_KEY"` for providers that carry neither an
  `apiKey` nor a `keyRef`, so environment-variable configuration keeps working.

### `resolveAgentConfig` resolution order

```
providerName = agentModel?.split('/')[0]
            ?? agents[name].model?.split('/')[0]
            ?? agents[name].provider
            ?? cfg.model                       // the default provider
modelName    = the part after '/', if any

if providerName === 'codex' && accountId:
    → resolve the loopback endpoint from ConnectionsManager (baseUrl + local credential)
else:
    → provider = cfg.provider[providerName]
      model    = modelName if listed in provider.models, else provider.models[0]
      apiKey   = provider.apiKey ?? vault.get(provider.keyRef) ?? env[provider.apiKeyEnv]
```

## 6.4 Session format

### 6.4a On-disk layout (per-session JSONL)

Sessions are **not** one array in one file. Each session is its own append-only JSONL file under an
encoded project directory, and a side index carries the list metadata:

```
userData/
  projects/<encoded-projectPath>/<sessionId>.jsonl   # transcript, one per session
  sessions-index.json                                # lightweight summaries only
  sessions.json.migrated-bak                         # the legacy file, kept as backup
  .sessions-migrated-v1                              # one-time migration flag
```

- **Path encoding** (`project-encode.ts` `encodeProjectPath`): every `:`, backslash or `/` becomes `-`
  (Claude CLI scheme), so `E:\Git\GitHub\meow-coding` maps to `E--Git-GitHub-meow-coding`. The encoding
  is **not reversible** — the real `projectPath` lives in the file's `meta` record and is the source of
  truth. Distinct project paths can in theory collide onto one directory; harmless, because sessions
  are keyed by `sessionId` and carry their own `projectPath`.
- **One JSON object per line**, discriminated by `type`:

  | type | shape | semantics |
  |---|---|---|
  | `meta` | `{ type:'meta', v:1, sessionId, agentId, projectPath, title, createdAt }` | Always the first line. Carries `agentId` (the pane link) and `projectPath` (source of truth) |
  | `message` | `{ type:'message', uuid, parentUuid, ts, message }` | A transcript message |
  | `tool` | `{ type:'tool', uuid, parentUuid, ts, tool }` | A transcript tool call |
  | `title` | `{ type:'title', ts, title }` | Latest-wins |
  | `todos` | `{ type:'todos', ts, todos }` | Latest-wins (replaces the whole list). `parseSessionJsonl` coerces a corrupt (non-array) `todos` to `[]` so a damaged file never propagates a bad value to the renderer |
  | `usage` | `{ type:'usage', ts, usage }` | Latest-wins **running total** snapshot, not a delta |

  Each new `message`/`tool` record links to the previous one via `parentUuid` (a linear chain;
  branching is reserved for future use). The in-memory `StoredSession` shape below is unchanged, so
  the manager, IPC and renderer are unaffected; `session-records.ts` is the pure conversion layer
  (`sessionToRecords` / `serializeSessionJsonl` / `parseSessionJsonl`).
- **`SessionFileStore`** (`agent/session-file-store.ts`) owns the filesystem side: `create`/`rewrite`
  do a full atomic write then reindex, `append` appends one line per record, `remove` deletes the file
  and drops it from cache + index, `get(id)` parses lazily on demand (cache-backed), `list()` serves
  from `sessions-index.json`. Index writes are debounced; `flush()` forces them.
- **One-time migration** (`session-migrate.ts` `migrateSessions`): converts the legacy `sessions.json`
  array into `projects/<encoded>/<id>.jsonl` files + `sessions-index.json`, renames the old file to
  `sessions.json.migrated-bak` (never deletes it) and writes `.sessions-migrated-v1`. It is
  flag-guarded and idempotent. It is **not** run from the store constructor — `index.ts` calls
  `sessionFiles.migrateLegacy()` from the app-ready chain *after* the v0.37 reset below, which deletes
  `sessions.json` on the launch that performs it. Migrating earlier would back that file up before the
  delete and resurrect it.
- **The v0.37 reset still runs first.** `resetToSingleSession` (`fresh-start.ts`, guarded by
  `.sessions-model-reset`) trims each project to one native session and `rmSync`s `sessions.json`.
  After the JSONL cutover that `rmSync` is a harmless no-op on an already-migrated profile (the file is
  `sessions.json.migrated-bak` then).

```ts
interface StoredSession {
  id: string                 // uuid
  agentId: string
  projectPath: string
  title: string              // 'New session' until the first user message; then its first line,
                             // whitespace-collapsed, truncated to 60 chars with an ellipsis
  items: ChatTranscriptItem[]
  todos: TodoItem[]
  usage: { input, output, cacheRead, cacheWrite, cost }
  createdAt: number
  updatedAt: number          // strictly increasing (see below)
}
```

- **`updatedAt` is guaranteed strictly increasing** (`nextUpdatedAt()` bumps by 1ms when two writes
  land in the same millisecond), so ordering by it is deterministic. Session lists sort by it
  descending; `latest(agentId)` picks the head.
- **Normalization runs once** on first load and the result is cached — normalizing on every read
  walked every transcript item of every session, and the loop reads the transcript several times per
  step.
- `truncateFromLastUser(id)` cuts from the last user message onwards (used by undo) and returns the
  removed items so redo can re-append them.
- `removeMessage(id, messageId)` removes a single message (a steered message the user deleted after
  it was injected).
- Deleting an agent (`removeAgent`) purges its sessions.
- `ensure(id, agentId, projectPath)` returns the session with the given id, creating it if
  absent — so a delegated turn can target a concrete session that does not exist yet.
- `hasMessage(sessionId, messageId)` / `appendMessageIfMissing(sessionId, message)` support
  deterministic, idempotent transcript writes: appending an already-present message id returns
  `false` without writing (used to avoid duplicating delegation/recovery payloads).

### 6.4b Session delegation (`delegations.json`)

`SessionDelegationStore` (`src/main/session-delegation-store.ts`) persists session-to-session
delegation runs as `SessionDelegation[]`. Each record identifies the source peer, the target peer,
their fixed session ids, the task, the lifecycle status and the durable result:

```ts
interface SessionDelegation {
  id: string
  projectPath: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string
  task: string
  status: 'queued' | 'running' | 'waiting_for_input'
        | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  revision: number          // bumped on every transition/metadata change
  targetBusyAtCreation: boolean
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  result?: string           // terminal result text (may be truncated)
  resultTruncated?: boolean // true when result was truncated at 64 KiB
  error?: string
  touchedFiles?: string[]
  deliveredAt?: number      // terminal; set once the result message is appended
  wakeAt?: number           // terminal; set once the source wake is claimed
  sourceKind?: 'session' | 'external'   // absent = 'session' (existing records stay valid)
  externalClient?: 'claude'             // set when sourceKind is 'external'
  planKey?: string                      // normalized plan path; external records only
}
```

- `sourceKind: 'external'` records come from the [external delegation](08-integrations.md#86-external-delegation-claude-code--meow)
  API: `sourceAgentId`/`sourceSessionId` are the sentinel `external:claude`, there is no source session
  to append results to or wake, and `planKey` is how the facade finds the session to reuse for a given
  plan.
- `projectPath` is normalized (Windows: lower-cased, forward slashes) for cross-process identity.
- Every state change is **revision-checked and idempotent**: `transition` accepts only
  `expectedRevision` and only a transition present in the explicit table; `markDelivered` /
  `markWoken` are the sole post-terminal metadata mutations and are also revision-checked. Callers
  receive clones so state cannot be mutated outside a transition.
- `recoverInterrupted()` lists `running`/`waiting_for_input` records (restart recovery).
- `purgeTerminalBefore(cutoff)` drops terminal records whose `finishedAt` predates the cutoff
  (30 days; earlier when both participating sessions have been deleted).

## 6.5 Project-level configuration (`.meow/`)

```
<project>/
  AGENTS.md            inlined into the system prompt (walked up to the git root)
  CLAUDE.md            fallback when no AGENTS.md exists anywhere along the walk-up path
  .meow/
    commands/*.md      project slash commands: frontmatter name/description, body = template
    skills/            project skills: <name>/SKILL.md or *.md with frontmatter name/description
    agents/*.md        project subagent roles
```

### Instruction discovery (`loadInstructions`)

1. The first existing **global** file: `~/.config/meow/AGENTS.md`, else `~/.claude/CLAUDE.md`.
2. Walk up from the agent cwd, stopping at the directory containing `.git` (or the home directory).
3. **Single-type priority**: if *any* `AGENTS.md` exists along that path, only `AGENTS.md` files are
   collected; otherwise the walk collects `CLAUDE.md` files. (This mirrors opencode.)
4. All collected files are inlined into the system prompt as
   `Instructions from: <path>\n<content>`.
5. Module-level instruction files *below* the root are **not** inlined — they attach on demand when
   the model reads a file near them, via `instructionFilesForFile` and `ToolContext.onFileRead`,
   deduped against both the system prompt and what was already attached this session.

### Subagent role file format

```markdown
---
name: db-migrator
description: Writes and runs database migrations
tools: read, glob, grep, edit, bash
model: anthropic/claude-sonnet-4-5
deny: git
ask: bash
---

You are a database migration subagent. …
```

`tools` is filtered against the tools that actually exist. `deny`/`ask` may only **tighten** what the
user's own rules already grant — **there is no `allow` key**.

### Project command file format

```markdown
---
name: deploy
description: Deploy the current branch
---

Deploy branch $1 to environment $2.
Current status: !`git status --short`
Everything else: $ARGUMENTS
```

## 6.6 Renderer-side persistence (`localStorage`)

| Key | Value |
|---|---|
| `meow.theme` | `'dark'` (default) or `'light'` |
| `meow.rightpanel.open` | `'1'` / `'0'` |
| `meow.rightpanel.tab` | `'tree'` / `'artifacts'` |
| `meow.rightpanel.width` | number, clamped to 240–600 |
| `meow.sidebar.expanded` | JSON map of project path → expanded (bool) |
| `meow.activeSessionByPath` | JSON map of project path → active session id |

`src/renderer/src/theme.ts` exposes `applyTheme()` and `watchTheme()`; `main.tsx` calls both for
*every* renderer entry point — including the Git viewer and File viewer popup windows — so popups
inherit the main window's theme automatically.

## 6.7 Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `MEOW_USER_DATA` | `src/main/index.ts` | Overrides the Electron `userData` directory (used by e2e tests) |
| `MEOW_E2E_MOCK_CONNECTIONS=1` | `src/main/index.ts` | Serves the connection IPC channels from `E2EConnectionFixtures` instead of the real manager |
| `MEOW_GIT_BASH_PATH` | `agent/tools/bash.ts` | Explicit Git Bash path on Windows |
| `TAVILY_API_KEY` | `agent/tools/websearch.ts` | Required for the `websearch` tool |
| `<PROVIDER>_API_KEY` | `agent/config.ts` `resolveApiKey` | Fallback API key when neither `apiKey` nor `keyRef` is set |
| `ELECTRON_RENDERER_URL` | `src/main/index.ts` | Dev-server URL; when absent the built `index.html` is loaded |
| `PORTABLE_EXECUTABLE_FILE` | `updater.ts` | Marks a Windows portable build → auto-update disabled |
| `APPIMAGE` | `updater.ts` | Marks a Linux AppImage → auto-update disabled |
| `OFFICECLI_SKIP_UPDATE` | `agent/tools/office.ts` | Always set to `1` when spawning OfficeCLI |
| `CLIPROXY_PLATFORM` / `CLIPROXY_ARCH` | `electron-builder.ts` | Selects which prebuilt sidecar binary to package |
| `PORT` | `server/index.ts` | Relay listen port (default 3928) |

## 6.8 Network endpoints and ports

| Endpoint | Direction | Purpose |
|---|---|---|
| `127.0.0.1:3927` (HTTP + WS) | app listens | Browser bridge. `GET /api/status` returns `{port, status}`; the WS endpoint speaks the pairing/command protocol |
| `127.0.0.1:<ephemeral base + i>` | app listens (via sidecar) | One OpenAI-compatible proxy port per Codex account |
| `localhost:1455` / `localhost:1457`, path `/auth/callback` | app listens temporarily | Codex OAuth redirect — these exact ports are registered with `auth.openai.com`; a random port is rejected |
| `0.0.0.0:3928` | separate relay process | Remote-control relay (`server/`) |
| `1305` | dev only | electron-vite renderer dev server (`strictPort: true`) |

Everything the app itself listens on binds **loopback only**.
