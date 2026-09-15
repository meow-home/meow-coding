# Background Bash Design Spec

## Executive Summary

Give the native Meow agent the ability to run **long-lived shell commands in
the background** — dev servers, test watchers, long builds — instead of
blocking a turn until the command exits or times out. The agent starts a
command with `run_in_background: true`, gets a handle immediately, reads
incremental output with a new `bash_output` tool, and stops it with a new
`kill_shell` tool. When a background process exits, Meow surfaces the result
into the session feed and, if the agent is idle, wakes it so it can react —
mirroring the Claude CLI background-task experience.

This is the first of four proposed mechanisms (Background Bash, Monitor,
extended Hook events, Scheduled tasks). Scope here is **Background Bash only**;
Monitor is explicitly designed to attach to the same store in a later phase.

## Background & Motivation

Today `bash` ([src/main/agent/tools/bash.ts](../../../src/main/agent/tools/bash.ts))
uses `child_process.spawn` and **resolves only when the process exits**, with a
default 120s timeout. A `npm run dev` therefore hangs the whole turn until it
times out — the agent cannot start a dev server and then read its logs, run a
watcher, or kick off a long build and continue working.

Meow already ships two of the three "background" mechanisms Claude CLI has:

- **Background subagents** — `task(..., background: true)`
  ([src/main/agent/tools/task.ts](../../../src/main/agent/tools/task.ts)).
- **Detached sessions** — `setBackground`
  ([src/main/meow-agent-manager.ts](../../../src/main/meow-agent-manager.ts)).

The missing one is **background shell processes**, which this spec adds.

## Goals

- Run shell commands in the background; return a handle immediately.
- Read incremental (new-since-last-read) output on demand.
- Kill a background process, killing its whole process tree.
- On exit, surface output + exit code into the feed and notify; auto-wake the
  agent when it is idle.
- Reuse existing infrastructure: `buildShellCommand` (Git Bash on Windows),
  `tree-kill`, the notification service, and the queue/`drainQueue` machinery.

## Non-Goals (YAGNI)

- **Persistence across app restart.** Background processes are children of the
  main process and die on quit, consistent with "quitting kills every agent".
- **A dedicated per-pane background-shell UI indicator.** MVP surfaces through
  feed tool cards + desktop notifications only.
- **Monitor / wait-until-condition.** Designed to attach to this store later,
  not built here.
- **PTY substrate.** We use piped `child_process`, not `PtyManager` (see
  Alternatives).

## Requirements & Scope

### 1. `BackgroundProcessStore` (new)

New file: `src/main/agent/background-process-store.ts`. Owns all long-lived
background processes, in memory, per agent.

Each entry:

| Field | Meaning |
|-------|---------|
| `id` | Short background id (e.g. first 8 chars of a UUID), agent-facing handle |
| `agentId` | Owning agent |
| `sessionId` | Session that started it (so exit is delivered to the right session even if the user switched) |
| `command` | Original command string (for display / cards) |
| `child` | `ChildProcess` from `child_process.spawn` |
| `status` | `'running' \| 'exited'` |
| `exitCode` | Number, set on exit (`null` if killed by signal) |
| `buffer` | Ring buffer of merged stdout+stderr |
| `readOffset` | Index up to which `bash_output` has already returned |

Behavior:

- **Spawn** reuses `buildShellCommand(command, cwd)` from `bash.ts` so Windows
  Git Bash behavior is identical to the foreground bash tool. stdout and stderr
  are piped and appended to `buffer` in arrival order.
- **Ring buffer** keeps at most **256 KB or 2000 lines**, whichever is smaller,
  dropping oldest content. `readOffset` is clamped when content is dropped, and
  a `[…truncated N bytes…]` marker is inserted once at the drop point so the
  agent knows output was elided.
- **`readNew(id, filter?)`** returns `buffer` content after `readOffset`,
  advances `readOffset` to the end, and returns `{ text, status, exitCode }`.
  Optional `filter` is a regex applied line-by-line before returning.
- **`kill(id)`** runs `tree-kill` on the child pid (same approach and Windows
  caveats as `PtyManager.killProcess` / the `WINDOWS_KILL_GRACE_MS` note in
  `bash.ts`).
- **`onExit`** callback fires with `{ id, agentId, sessionId, exitCode }`.
- **Limits**: at most **10** running processes per agent. An 11th
  `run_in_background` returns a clear error (mirroring the "queue full"
  pattern), not silent failure.
- **Cleanup**: `killAllForAgent(agentId)` kills every process for an agent;
  called on session delete, agent stop, and app quit. Exited entries are
  retained until read once, then dropped (or dropped after a short TTL if never
  read) so buffers do not leak.

### 2. Tool surface (agent-facing)

Names mirror Claude CLI for familiarity.

**`bash` gains `run_in_background?: boolean`** (extend `BashInput` in
`bash.ts`). When true:

- Permission is decided **before** spawning, exactly as for a foreground bash
  command — `run_in_background` is only a flag; the command string is evaluated
  by the same `decidePermission(bash, input)` path in the loop. No new
  permission surface.
- Spawns via the store, then returns immediately:
  `{ output: "Background bash started. id=<id>. Read output with bash_output, stop with kill_shell.", background: true }`.
  (`ToolRunResult.background` already exists — see
  [src/main/agent/tools/types.ts](../../../src/main/agent/tools/types.ts).)

**`bash_output` (new tool)** — input `{ id: string, filter?: string }`.
Returns new output since the last read plus a status line, e.g.:

```
<bash id="a1b2c3d4" status="running">
...new stdout/stderr...
</bash>
```

or on exit `status="exited" exit_code="0"`. Unknown id → clear error.

**`kill_shell` (new tool)** — input `{ id: string }`. Tree-kills the process
and reports whether it was running. Unknown id → clear error.

Both new tools are registered in the tool registry
([src/main/agent/tools/registry.ts](../../../src/main/agent/tools/registry.ts))
and described so the agent understands the start→read→kill lifecycle.

### 3. Wiring (`ToolContext` + manager)

- Extend `ToolContext` ([types.ts](../../../src/main/agent/tools/types.ts))
  with `backgroundProcs?: BackgroundProcessStore`. Tools reach the store
  through ctx, never the manager directly — same boundary discipline as the
  rest of the tool layer.
- A **single** `BackgroundProcessStore` is owned by `MeowAgentManager`.
  Entries are keyed by `id` and indexed by `agentId` (for per-agent limits and
  cleanup). The manager registers one `onExit` handler that runs the completion
  flow below. Each running turn's `ToolContext` receives the same store
  instance.

### 4. Completion flow (notify + auto-wake)

On `onExit({ id, agentId, sessionId, exitCode })`:

1. Append an assistant/system message to `sessionId` via `store.appendMessage`,
   e.g. `[background bash <id>] exited (code N). Use bash_output to read the
   result.` — same delivery approach as subagent `onBackgroundResult`
   ([meow-agent-manager.ts](../../../src/main/meow-agent-manager.ts)).
2. Emit a feed event (a background-bash card) and fire a desktop notification
   through the existing notification service (respecting the same
   `notifications.onDone` preference used for turn completion).
3. **Auto-wake if idle**: if `!this.running.has(agentId)`, enqueue a short
   nudge and call `drainQueue(agentId)`. If the agent is mid-turn, the
   `drainQueue` guard (`if (this.running.has(agentId)) return`) leaves it
   alone; the appended message is picked up on the next turn. This is one step
   beyond today's subagent behavior, which appends but never wakes.

To avoid noise, only **one** nudge is enqueued per exit, and the nudge is
plain text the agent may ignore.

### 5. Lifecycle & cleanup

- App quit / `stopAll`: kill every background process (hook into the existing
  shutdown path that already tree-kills agents).
- Session delete / agent stop: `killAllForAgent`.
- Not persisted across restart (Non-Goal).

## Alternatives Considered

- **Reuse `PtyManager` (real xterm PTY).** Rejected for MVP: it is keyed
  1-process-per-`agentId`, so N concurrent background processes would need a
  new key scheme anyway; its output is a raw ANSI terminal stream that must be
  stripped before an LLM can read it cleanly; and a real TTY is not needed for
  the target use cases. A piped `child_process` matches Claude CLI semantics
  (line-oriented output) and reuses `bash.ts`'s shell-building.
- **Passive completion (buffer only, no wake).** Rejected: the agent would only
  learn of completion on its next unrelated turn, losing the "notified when
  done" experience.
- **Per-call `notify_on_exit` flag.** Rejected for MVP as extra surface; the
  idle-only auto-wake is a sensible always-on default and stays quiet while the
  agent is busy.

## Testing Strategy

TDD — tests before implementation.

**Unit (`BackgroundProcessStore`):**

- `echo` command → `readNew` returns the text once, then empty on second read
  (offset advances).
- Ring buffer caps at the byte/line limit and inserts the truncation marker;
  `readOffset` stays valid after a drop.
- Exit updates `status`/`exitCode` and preserves trailing output.
- `kill` stops a `sleep`/long process; status reflects it.
- 11th process for one agent returns the limit error.
- `filter` regex narrows returned lines.

**Integration (tool + manager):**

- `bash` with `run_in_background: true` returns immediately with
  `background: true` and a parseable id.
- `bash_output` unknown id and `kill_shell` unknown id return clear errors.
- Exit flow: message appended to the originating session; desktop notify fired;
  auto-wake enqueues + drains only when idle, and is a no-op when the agent is
  mid-turn (mock `running` / `drainQueue`).

## Rollout / Phasing

1. **This spec (MVP):** store + `bash.run_in_background` + `bash_output` +
   `kill_shell` + completion/auto-wake + cleanup + tests.
2. **Phase 2 (separate spec): Monitor** — a `monitor` tool that watches a
   background process's buffer/exit for a condition (regex / exit code) and
   wakes the agent when met, built on this store.
3. Later, separate specs: extended Hook events; Scheduled/cron tasks.
