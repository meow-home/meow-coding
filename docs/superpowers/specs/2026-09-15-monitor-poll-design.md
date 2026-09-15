# Monitor Poll-a-Command Design Spec

## Executive Summary

Extend the existing `monitor` tool so it can, besides watching a background
shell by `id`, **poll a short command on an interval** and wake the agent when
that command succeeds (or its output matches a regex, or a timeout elapses).
This unifies waiting on a condition under one tool — matching Claude CLI's
single "Monitor" wait primitive — and closes the gap where a monitor could only
observe a shell Meow itself started.

Scope is the poll mode plus its wiring into the tool, the manager, and the
Processes list. The existing id-mode (`MonitorStore`) is unchanged.

## Background & Motivation

`monitor` today only watches a `BackgroundProcessStore` shell by id
(`MonitorStore`). To wait on anything else — "poll `curl -sf localhost:3000`
until it succeeds", "wait until `git status` is clean" — the agent must wrap the
check in a background `until`-loop and monitor that shell's exit. That works but
is indirect and the model rarely constructs it. A first-class poll mode makes
"wait until this command succeeds" a direct, obvious tool call, the way Claude
CLI's Monitor does.

Waiting stays **async**: `monitor` returns immediately and the agent is woken on
resolution, reusing the notify + auto-wake path (`handleMonitorResolve`) built
for id-mode.

## Goals

- One `monitor` tool that accepts either `id` (watch a shell — unchanged) or
  `command` (poll it periodically).
- Poll conditions: command exit code (default success / exit 0), a regex over
  the command's output, and/or a timeout.
- Reuse `MonitorResolveInfo` + `handleMonitorResolve` (append message, desktop
  notify, auto-wake when idle).
- Poll monitors appear in the Processes overlay's Monitors list alongside
  shell-watch monitors.

## Non-Goals (YAGNI)

- No exponential backoff; a fixed `interval_s`.
- No history of past poll runs — only the last run's output feeds the resolve
  detail.
- No streaming of poll output to the UI (polls are short, unlike a background
  shell).
- No change to id-mode (`MonitorStore`) behavior.
- No persistence across restart.

## Requirements & Scope

### 1. Tool schema (merged `monitor`)

`monitor` gains `command`, `interval_s`, and accepts `until_exit` for both modes:

| Param | Meaning |
|-------|---------|
| `id?` | Watch this background shell (existing id-mode). |
| `command?` | Poll this shell command on an interval (new poll-mode). |
| `until_regex?` | Resolve when output matches (both modes). |
| `until_exit?` (`boolean \| number`) | id-mode: the shell exits (a number notes an expected code). poll-mode: a poll of `command` exits 0, or the given code. |
| `interval_s?` | poll-mode only: seconds between polls (default 5, min 1). |
| `timeout_s?` | Resolve as `timeout` after this many seconds (both modes). |

Rules:

- Exactly one of `id` / `command` must be present; neither or both → clear
  error.
- poll-mode with no `until_regex` and no `until_exit` defaults to
  `until_exit: 0` (poll until the command succeeds).
- Invalid `until_regex` → clear error.
- Returns immediately: `{ background: true, output: "Monitoring ... (monitor <id>)" }`.

### 2. `PollMonitorStore` (new)

New file `src/main/agent/poll-monitor-store.ts`, owning active poll monitors,
per agent, separate from `MonitorStore` (single responsibility: it spawns
commands on a timer rather than subscribing to shell events).

Each entry: `{ id, agentId, sessionId, command, cwd, untilRegex?, untilExit, intervalMs, until, status, timer, timeoutTimer? }`.

Behavior:

- `start(agentId, command, cwd, opts): { id } | { error }` — validates
  conditions and the per-agent limit (default **10**), captures `sessionId` via
  `getSessionId`, computes a human `until` summary, and schedules the first poll
  immediately then every `intervalMs`.
- Each **poll** spawns `command` via `buildShellCommand` (reusing the bash Git
  Bash handling) with `windowsHide`, capturing stdout+stderr (capped) and the
  exit code, and a **per-poll timeout** (e.g. min(intervalMs, 30s)) that
  tree-kills a hung poll so the interval never stalls.
- **Resolution** on the first of:
  - `succeeded` — a poll exits with the expected code (0 by default, or
    `untilExit` when a number). Detail: the exit code.
  - `matched` — a poll's output matches `untilRegex`. Detail: the matched line
    (capped 500 chars).
  - `timeout` — `timeoutMs` elapsed. Detail: elapsed seconds.
  - On resolution: stop the interval + timers, delete the entry, and call
    `onResolve(MonitorResolveInfo)`.
- `count`, `list(agentId)`, `cancelAllForAgent`, `cancelAll` mirror
  `MonitorStore`.

`MonitorResolveInfo` is reused as-is; for poll monitors `targetId` carries the
command string (so the resolve message and the UI show what was polled).

Constructor opts:
`{ getSessionId, onResolve, maxPerAgent? }` (no `procs` dependency — poll mode
does not touch `BackgroundProcessStore`).

### 3. Tool dispatch + context

- `ToolContext.pollMonitors?: PollMonitorStore` (mirrors `monitors`).
- The `monitor` tool inspects the input: `id` present → `ctx.monitors.start`
  (unchanged); `command` present → `ctx.pollMonitors.start(ctx.agentId,
  command, ctx.cwd, …)`.
- `LoopDeps.pollMonitors?` threads it through the loop into `toolCtx`.

### 4. Manager wiring

- `MeowAgentManager` owns one `PollMonitorStore`, built with the same
  `getSessionId` and an `onResolve` that runs `handleMonitorResolve` with the
  manager's append/notify/isRunning/wake deps (the same handler used for
  id-mode).
- `monitorsList(agentId)` returns `MonitorStore.list(agentId)` concatenated with
  `PollMonitorStore.list(agentId)` so the Processes overlay lists both.
- `stop(agentId)` / `dispose()` also cancel the agent's poll monitors.

### 5. Resolve message (poll-mode)

`handleMonitorResolve` is reused. Because a poll monitor has no shell to read,
its `MonitorInfo`/message reference the command, e.g.
`[monitor <id>] command \`<cmd>\` — succeeded (exit code 0).` — no
`bash_output` hint (there is no background shell id to read).

> Note: `monitorResolveMessage` currently always appends a `bash_output` hint.
> This spec adjusts it to omit that hint when the monitor is a poll monitor
> (distinguished by a flag on `MonitorResolveInfo`, e.g. `kind: 'shell' | 'poll'`).

### 6. Lifecycle & limits

- Interval and timers are `unref`'d; a hung poll is tree-killed at the per-poll
  timeout.
- Cancel on resolve/timeout and on agent stop/dispose.
- Max 10 poll monitors per agent. Not persisted.

## Testing Strategy

TDD.

**Unit (`PollMonitorStore`)** — with real short commands (Git Bash on Windows):

- `command` that exits 0 (e.g. `true` / `exit 0`) → resolves `succeeded`.
- `until_exit` a specific number → resolves only on that code.
- a command whose output matches `until_regex` → resolves `matched`.
- a command that never satisfies the condition within `timeout_s` → resolves
  `timeout`.
- missing both conditions defaults to exit-0 success.
- 11th poll monitor for one agent → limit error.

**Unit (resolve message):** `monitorResolveMessage` omits the `bash_output`
hint for a poll monitor and includes it for a shell monitor.

**Integration (tool):** `monitor({ command })` returns immediately with
`background: true`; `monitor({})` and `monitor({ id, command })` return clear
errors; `monitorsList` includes poll monitors.

## Rollout / Phasing

Single cycle, completing the Monitor line: shell-watch (done) + poll-a-command
(this spec). After this, `monitor` matches Claude CLI's unified wait primitive.
