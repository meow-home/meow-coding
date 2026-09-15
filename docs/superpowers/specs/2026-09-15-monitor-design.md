# Monitor Design Spec

## Executive Summary

Add a `monitor` tool that watches an already-running **background shell**
(started via `bash run_in_background`) and **wakes the agent when a condition is
met** — a regex appears in the shell's output, the shell exits, or a timeout
elapses — without blocking the current turn. This is Phase 2 of the Background
Bash work (`docs/superpowers/specs/2026-09-15-background-bash-design.md`) and
builds directly on `BackgroundProcessStore`.

Scope here is **Monitor only** (watching a background process by id). A separate
UI overlay for background shells/monitors is a later cycle and is out of scope.

## Background & Motivation

Background Bash lets the agent start a long-lived shell and read its output with
`bash_output`. But to *wait for* something — "the dev server printed `Local:`",
"the build finished" — the agent must poll `bash_output` in a loop, spending a
turn each time. `monitor` removes the polling: the agent registers a condition
once, gets control back immediately, and is woken when the condition is met,
reusing the exact notify + auto-wake path built for background-bash exit.

The interaction model is **async watch + wake** (not a blocking call), so the
agent can keep working and run several monitors at once.

## Goals

- Watch a background shell (by its id) for: a regex in newly-produced output,
  its exit (optionally requiring a specific exit code), and/or a timeout.
- Register and return immediately; wake the agent when the first condition is
  met, reporting which (`matched` / `exited` / `timeout`) and a detail (the
  matched line or the exit code).
- Observe output **without disturbing** the agent's own `bash_output` read
  offset.
- Reuse the notify + auto-wake-if-idle machinery from background-bash exit.

## Non-Goals (YAGNI)

- **Poll-a-command mode** (running a shell command on an interval until it
  matches). Monitor watches an existing background process only.
- **A cancel/stop-monitor tool.** A monitor auto-resolves when its target is
  killed (`kill_shell` → the store's exit event) or on timeout; no manual
  cancel is exposed in the MVP.
- **UI.** Feed message + desktop notification only, like background-bash exit.
- **Persistence across restart.**

## Requirements & Scope

### 1. Make `BackgroundProcessStore` observable

A monitor must see output/exit without consuming the agent's `readOffset`
(which `bash_output` advances). So the store gains an event channel:

- `BackgroundProcessStore extends EventEmitter`.
- In `appendOutput`, emit `('data', { id, chunk })` with the **raw chunk** just
  received (before any ring-buffer trim).
- In the child `close` handler, emit `('exit', { id, exitCode })` **in addition
  to** the existing `opts.onExit(...)` call — the opts callback (manager's
  background-exit handling) is unchanged; the event is purely additive and
  multi-subscriber.

Monitors filter events by `id` and keep their own small tail buffer to test the
regex, so nothing touches `readOffset`.

### 2. `MonitorStore` (new)

New file: `src/main/agent/monitor-store.ts`. Owns active monitors, in memory,
per agent.

Each entry:

| Field | Meaning |
|-------|---------|
| `id` | Short monitor id (agent-facing handle) |
| `agentId` / `sessionId` | Owner + originating session (captured at start) |
| `targetId` | The background shell id being watched |
| `untilRegex` | Optional compiled regex tested against each new output chunk (line-wise) |
| `untilExit` | Optional: resolve when the target exits; if a number, only when the exit code equals it |
| `timeoutMs` | Optional timeout |
| `status` | `'watching' \| 'resolved'` |

Constructor opts:
`{ procs: BackgroundProcessStore; getSessionId: (agentId) => string; onResolve: (info: MonitorResolveInfo) => void; maxPerAgent?: number }`.

Behavior:

- `start(agentId, targetId, opts): { id } | { error }`:
  - Error if the target is unknown, or if neither `untilRegex` nor `untilExit`
    is provided, or if the per-agent limit (default **10**) is exceeded.
  - If the target has already exited, resolve immediately with reason `exited`.
  - Otherwise subscribe to the store's `data`/`exit` events for `targetId`,
    start the timeout timer (if any), and capture `sessionId` via
    `getSessionId(agentId)`.
- **Resolution** fires on the **first** of:
  - `matched` — a new output chunk contains a line matching `untilRegex`
    (detail: the matched line, trimmed/capped).
  - `exited` — the target exits (detail: its exit code). When `untilExit` is a
    number and the code differs, still resolve as `exited` (the target is gone;
    the agent is told the actual code) — a monitor never outlives its target.
  - `timeout` — `timeoutMs` elapsed (detail: the elapsed seconds).
  - On resolution: set `status='resolved'`, unsubscribe, clear the timer, and
    call `onResolve({ id, agentId, sessionId, targetId, reason, detail })`.
- `cancelAllForAgent(agentId)` / `cancelAll()`: unsubscribe + clear timers for
  cleanup (no wake).

Produces:
`interface MonitorResolveInfo { id: string; agentId: string; sessionId: string; targetId: string; reason: 'matched' | 'exited' | 'timeout'; detail: string }`.

### 3. Tool `monitor`

Input `{ id: string; until_regex?: string; until_exit?: boolean | number; timeout_s?: number }`.

- Requires `ctx.monitors` and `ctx.agentId`; else a clear "not available" error.
- Requires at least one of `until_regex` / `until_exit`; else a clear error.
- Invalid `until_regex` → clear error (compiled up front).
- On success, returns immediately:
  `{ background: true, output: "Monitoring shell <id>; you'll be woken when <condition>. (monitor <monitorId>)" }`.

Registered in the tool registry alongside `bash_output` / `kill_shell`.

### 4. Wiring (`ToolContext` + loop + manager)

- `ToolContext.monitors?: MonitorStore` (mirrors `backgroundProcs`).
- `LoopDeps.monitors?: MonitorStore`; passed into the `toolCtx`.
- `MeowAgentManager` owns one `MonitorStore`, constructed with the existing
  `backgroundProcs`, `getSessionId`, and an `onResolve` handler; passes it into
  the `SessionRunner`.

### 5. Completion flow (notify + auto-wake) — reused pattern

On `onResolve(info)`, run a handler that mirrors `handleBackgroundExit`:

- Append an assistant message to `info.sessionId`, e.g.
  `[monitor <id>] shell <targetId> — <reason>: <detail>. Read output with bash_output({ id: "<targetId>" }).`
- Fire a desktop notification (respecting `notifications.onDone`).
- **Auto-wake if idle**: if `!running.has(agentId)`, enqueue a nudge and drain.

This is provided as pure, spy-testable functions
(`monitorResolveMessage(info)`, `handleMonitorResolve(info, deps)`) in
`monitor-store.ts`, with `deps = { appendMessage, notify?, isRunning, wake }`.

### 6. Lifecycle & limits

- Target killed via `kill_shell` or natural exit → the store's `exit` event
  resolves the monitor as `exited` (never orphaned).
- Agent stop / dispose → `cancelAllForAgent` / `cancelAll` (hook into the same
  `stop(agentId)` / `dispose()` sites that already clean up `backgroundProcs`).
- Max **10** monitors per agent.
- Not persisted across restart.

## Testing Strategy

TDD — tests before implementation.

**Unit (`MonitorStore`)** — drive it with a fake/real `BackgroundProcessStore`:

- regex match in a new chunk → resolves `matched` with the matched line.
- target exits → resolves `exited` with the exit code.
- timeout elapses with no match → resolves `timeout`.
- target exits before the regex matches → resolves `exited` (not left hanging).
- unknown target id → `start` returns an error.
- missing both conditions → error; invalid regex → error.
- 11th monitor for one agent → limit error.

**Unit (resolve handler):** `handleMonitorResolve` appends to the originating
session, notifies, and wakes only when idle (spies).

**Integration (tool):** `monitor` returns immediately with `background: true`;
unknown id and missing-condition return clear errors.

## Rollout / Phasing

1. **This spec (MVP):** store events + `MonitorStore` + `monitor` tool +
   resolve/auto-wake + cleanup + tests.
2. **Next cycle (separate spec): UI overlay** for background shells and monitors
   — a right-docked panel like the Files overlay, listing running shells/monitors
   with their output and a kill control.
