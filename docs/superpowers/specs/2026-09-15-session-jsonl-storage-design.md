# Session storage: single JSON array → per-session JSONL (Claude CLI-style)

**Date:** 2026-09-15
**Status:** Design approved, pending spec review
**Approach:** C — per-session JSONL, append on the hot path, records carry
`parentUuid` (tree-shaped, linear for now), undo via file rewrite.

## Problem

Meow stores every session of every agent in a single `userData/sessions.json`
array ([`src/main/agent/session.ts`](../../../src/main/agent/session.ts),
[`src/main/json-store.ts`](../../../src/main/json-store.ts)). Each appended
message or tool result rewrites the whole array (debounced 250 ms), and every
session's full transcript is held in memory. This is quadratic-ish for long
sessions and does not match how Claude CLI / Claude desktop store sessions.

Claude CLI and Claude desktop both persist transcripts as **one append-only
`.jsonl` file per session, grouped by project**
(`~/.claude/projects/<encoded-project>/<sessionId>.jsonl`), with records linked
by `parentUuid`. The parallelism / window layer (OS process for the CLI, a
per-PID runtime record under `~/.claude/sessions/` for the desktop app) is kept
**separate from the transcript** and never written into the session file.

## Goal

Adopt that architecture for Meow's transcript storage while **keeping Meow's
pane model unchanged**:

- On disk: `userData/projects/<encoded-projectPath>/<sessionId>.jsonl` — pure
  project → session, no pane tier, mirroring Claude CLI.
- Keep the `SessionStore` public API identical so the renderer,
  `meow-agent-manager`, and the pane model do not change.
- Provide a one-time, idempotent migration of existing `sessions.json` data,
  runnable as a script and automatically on first launch.

### Non-goals

- Interop with the real `claude` CLI (borrow the architecture only; Meow keeps
  its own record schema and remains the source of truth).
- Removing the pane/agent concept from the app. The pane is Meow's runtime
  equivalent of an OS process / desktop window and stays.
- Full branch/leaf-repoint undo and subagent sidechains (a later upgrade path;
  see "Future: upgrade to full tree").

## Key context (why the pane stays)

Meow's `agentId` is **not** the removed meow/claude/opencode provider concept
(that is `variant`). The real hierarchy is:

- **Workspace = project**, keyed by `projectPath`
  ([`Workspace`](../../../src/shared/types.ts)).
- **Agent = a pane/tab in a project** (`AgentConfig`: own `id`, `name`, `cwd`,
  `model`, `mode`, `variant`). Multiple panes per project run in parallel; a
  hidden pane keeps streaming.
- **Session = a conversation** (`StoredSession`) tied to an `agentId`.

In the UI, a sidebar "session" row **is** an `AgentConfig`
([`src/main/workspace-store.ts`](../../../src/main/workspace-store.ts):
`sessions: w.agents...map(a => ({ id: a.id, name: a.name }))`). `listSessions` /
`switchSession` (multiple `StoredSession` per agent) are **not wired to IPC or
the renderer** — dead code — so today pane ↔ conversation is effectively 1:1
via `activeSessionId(agentId) = latest(agentId) ?? create(...)`.

Because the sidebar and runtime status are keyed by `agentId`, `agentId` must
remain discoverable per session. It is stored in each file's `meta` record, so
the pane ↔ session link works exactly as today with no renderer changes.

## On-disk layout

```
userData/
  projects/<encoded-projectPath>/<sessionId>.jsonl   # transcript, one per session
  sessions-index.json                                # lightweight summaries only
  sessions.json.migrated-bak                         # old file kept as backup
  .sessions-migrated-v1                              # one-time migration flag
```

- **Path encoding** (`src/main/project-encode.ts`): replace every `:`, `\`, `/`
  with `-`, matching Claude CLI (`E:\Git\GitHub\meow-coding` →
  `E--Git-GitHub-meow-coding`). The encoding is **not required to be
  reversible** — the true `projectPath` is stored in the `meta` record and is
  the source of truth. (Distinct project paths can in theory collide to the
  same encoded dir; this is acceptable because sessions are keyed by
  `sessionId` and carry their real `projectPath`. If a collision is ever
  observed, the index disambiguates by `projectPath`.)

## File format (one JSON object per line)

Record types (discriminated by `type`):

| type | shape | semantics |
|------|-------|-----------|
| `meta` | `{ type:'meta', v:1, sessionId, agentId, projectPath, title, createdAt }` | Always the first line. Carries `agentId` (pane link) and `projectPath` (source of truth). |
| `message` | `{ type:'message', uuid, parentUuid, ts, message: ChatMessage }` | A transcript message. |
| `tool` | `{ type:'tool', uuid, parentUuid, ts, tool: ToolCallData }` | A transcript tool call. |
| `title` | `{ type:'title', ts, title }` | Latest-wins. |
| `todos` | `{ type:'todos', ts, todos: TodoItem[] }` | Latest-wins (setTodos replaces the whole list). |
| `usage` | `{ type:'usage', ts, usage: UsageSummary }` | Latest-wins **running total** snapshot (not a delta). |

- `parentUuid` of each new `message`/`tool` record = the `uuid` of the previous
  transcript record (a linear chain). This makes the records tree-shaped and
  ready for future branching, without any branching logic now. The first
  transcript record has `parentUuid: null`.
- `ts` is epoch ms.

### Load (reconstruct `StoredSession`)

Read all lines in order:

- `items[]` = `message`/`tool` records in file order (their linear
  `parentUuid` chain equals file order).
- `title` = last `title` record, else `meta.title`, else derived from the
  first user message (existing `titleFrom` logic).
- `todos` = last `todos` record (else `[]`).
- `usage` = last `usage` record (else zeros).
- `createdAt` = `meta.createdAt`; `updatedAt` = `ts` of the last record.
- **Crash tolerance:** a truncated/corrupt final line (append interrupted by a
  crash) is skipped, not fatal. A corrupt `meta` line parks the file as
  `.corrupt` (mirroring `json-store.ts`) and the session is dropped from the
  index on rebuild.

## `SessionStore` — public API unchanged, backing swapped

`SessionStore` keeps its current public methods and its `normalize` / title
logic. Its constructor takes a new `SessionFileStore` backing instead of
`JsonStore<StoredSession>`.

| Method | New behavior |
|--------|--------------|
| `create(agentId, projectPath)` | New `sessionId` (uuid); create the file; write the `meta` line; add to index. |
| `appendMessage` / `appendTool` | **Append one line** (O(1); the hot-path win). Update the cached transcript and the index (messageCount, updatedAt). First user message may append a `title` record via existing derivation. |
| `setTitle` | Append a `title` record; update index. |
| `setTodos` | Append a `todos` record. |
| `addUsage` | Compute the new running total, append a `usage` snapshot; update index. |
| `touch` | Bump `updatedAt` in the index (no transcript write). The index is authoritative for `updatedAt`/ordering; on a rebuild-from-scan (index lost) `updatedAt` is recomputed from the last record's `ts`, so a soft `touch` bump not backed by a record is not preserved across a rebuild — acceptable, since `touch` only re-sorts to the top. |
| `replaceItems` (compact) | **Rewrite the file**: keep `meta`, re-append the new `items` with a fresh linear `parentUuid` chain, then re-append latest `title`/`todos`/`usage`. |
| `truncateFromLastUser` (undo) | **Rewrite the file** dropping records from the last user message onward; return the removed items. |
| `removeMessage` (steering delete) | **Rewrite the file** without that message record. |
| `get` / `transcript` / `transcriptWindow` / `todos` / `getUsage` | From the per-session cache; lazily read the file if not cached. |
| `list(agentId)` / `latest(agentId)` / `listAll` | From the index — no transcript reads. `getStats` (listAll) needs only summary + usage + agentId, all in the index. |
| `delete` | Delete the file; drop from index. |
| `deleteForAgent(agentId)` | Delete every file whose `meta.agentId` matches (from the index); drop from index. |

### Index and memory

- `sessions-index.json`: `sessionId → { agentId, projectPath, title,
  messageCount, createdAt, updatedAt, usage }`. Serves `list` / `latest` /
  `listAll` / `getStats` without reading transcripts.
- Written **debounced 250 ms** (as today), but it is small (summaries only), so
  it is far cheaper than today's whole-transcript rewrite on every message.
- Transcripts are **read lazily per session and cached** (rather than loading
  every transcript into memory as today), lowering RAM. Reads are synchronous
  (`readFileSync` in the main process, like `json-store.ts`), so the sync
  `SessionStore` API is preserved.
- **Self-heal:** on startup, or when the index references a missing file or a
  `projects/` file is absent from the index, rebuild the index by scanning
  `projects/**/*.jsonl` and reading each `meta` line (plus a cheap tail read for
  `updatedAt`/counts).

## Migration

`scripts/migrate-sessions-to-jsonl.ts`, runnable manually **and** invoked once
automatically at startup, guarded by the `.sessions-migrated-v1` flag file
(same pattern as `.sessions-model-reset`,
[`src/main/index.ts`](../../../src/main/index.ts) ~line 989).

Steps:

1. If the flag file exists, no-op.
2. If `userData/sessions.json` is absent, write the flag and no-op (fresh
   install).
3. Load `sessions.json` (array of `StoredSession`).
4. For each session: encode `projectPath` → dir; write
   `projects/<enc>/<id>.jsonl` = `meta` line, then each `item` as a
   `message`/`tool` record with a generated `uuid` and a linear `parentUuid`
   chain, then `title` / `todos` / `usage` records.
5. Build `sessions-index.json`.
6. Rename `sessions.json` → `sessions.json.migrated-bak` (**keep as backup, do
   not hard-delete** — consistent with json-store's "never silently discard
   user data").
7. Write `.sessions-migrated-v1`.

**Idempotent** (flag-guarded; safe to re-run). The migration writes files
atomically (temp + rename) like `json-store.ts`.

## Cutover

Full switch, no dual-read in normal operation. The `JsonStore<StoredSession>`
wiring for sessions at [`src/main/index.ts`](../../../src/main/index.ts) ~line
146 is replaced by the new store. Migration handles the one-time move; the old
file survives only as `.migrated-bak`.

## Testing (TDD; extend existing suites)

Existing: `tests/unit/session-store.test.ts`,
`tests/unit/session-store-remove.test.ts`, `tests/unit/json-store.test.ts`.

- **Store unit tests** for every method above (mirror the two session-store
  suites): create/append/get/transcriptWindow/setTitle/setTodos/addUsage/
  replaceItems/truncateFromLastUser/removeMessage/delete/deleteForAgent.
- **Round-trip:** build a `StoredSession` → write jsonl → load → deep-equal
  (items, title, todos, usage, timestamps).
- **Index:** `list`/`latest`/`listAll` return the same summaries as today;
  ordering by `updatedAt` preserved; self-heal rebuild when index is
  missing/stale.
- **Migration:** a sample `sessions.json` with multiple sessions across
  multiple agents, image attachments, and tool calls → migrate → assert files,
  index, backup, and **running twice is a no-op** (idempotency).
- **Encoding:** `project-encode` matches the Claude CLI scheme; `projectPath`
  in `meta` remains the source of truth.
- **Crash tolerance:** a file with a corrupt trailing line loads (line skipped)
  without throwing.

## Files

**New**
- `src/main/agent/session-file-store.ts` — per-session JSONL backing + index.
- `src/main/project-encode.ts` — project path encoding.
- `scripts/migrate-sessions-to-jsonl.ts` — standalone + startup migration.
- Tests alongside the above.

**Modified**
- `src/main/agent/session.ts` — `SessionStore` uses the new backing; public API
  and `normalize`/title logic unchanged.
- `src/main/index.ts` — wire the new store (~line 146); run the one-time
  auto-migration guarded by the flag file.

## Future: upgrade to full tree (Approach B)

Records already carry `uuid`/`parentUuid`. A later change can make undo/steering
write a new `leafUuid`/`last-prompt` pointer instead of rewriting the file, add
`isSidechain` records for subagents, and add meta records for mode/permission —
reaching full Claude CLI fidelity without another storage migration.
