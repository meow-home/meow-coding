# Processes UI Pane Design Spec

## Executive Summary

Add a right-docked **"Processes"** overlay (modeled on the Files overlay) that,
for the session it is opened from, lists the agent's **background shells**
(started via `bash run_in_background`) and **monitors**, streams a selected
shell's output live, and offers a **Kill** control per shell. This surfaces the
Background Bash + Monitor features (which today reach the user only as feed
messages) as a first-class, always-visible panel.

This is the third and final cycle of the Background Bash line of work
(Background Bash → Monitor → this UI). Scope is the panel and the IPC needed to
feed it; no changes to how shells/monitors behave.

## Background & Motivation

`BackgroundProcessStore` and `MonitorStore` live in the Electron **main**
process. The renderer has no way to see running background shells or monitors —
they only appear as appended chat messages when they exit/resolve. This spec
exposes that state over IPC and renders it in an overlay so the user can watch
output live and kill a runaway shell without going through the agent.

Two facts from the existing code shape the design:

- The store already exposes `inspect(id)` (a non-consuming read of the buffer)
  and emits `data`/`exit` events (added for Monitor). We reuse both — output
  streaming never touches the agent's `bash_output` read offset.
- The Files overlay (`src/renderer/src/components/files/FilesOverlay.tsx`)
  already implements right-docking, edge-resize, full-screen toggle, and Esc to
  close, opened from a pane's `⋮` menu. The Processes overlay mirrors it.

## Goals

- Per **session/agent** panel (opened from that pane's `⋮` menu), docked right
  like Files, resizable, full-screen-toggleable, Esc to close.
- Left column: a **Shells** list (id, command, status, exit code, Kill) and a
  **Monitors** list (id, target shell, condition, status).
- Right column: the **live output** of the selected shell (backlog + streamed
  new chunks), auto-scrolling.
- Kill a shell from the panel.

## Non-Goals (YAGNI)

- No `xterm`/full ANSI terminal — output is piped (non-TTY), rendered in a
  `<pre>`.
- No cross-agent/whole-workspace aggregation (per-session only).
- No monitor cancel control (monitors auto-resolve; matches the tool surface).
- No persistence across restart.
- No renderer unit-test harness beyond what exists; the React component is
  verified by typecheck + a documented manual smoke test.

## Requirements & Scope

### 1. Store accessors (main)

- `BackgroundProcessStore.list(agentId): BackgroundProcInfo[]` where
  `BackgroundProcInfo = { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }`.
  Includes both running and (not-yet-reaped) exited entries.
- `MonitorStore.list(agentId): MonitorInfo[]` where
  `MonitorInfo = { id: string; targetId: string; until: string }` (`until` is a
  human summary of the conditions, e.g. `/READY/ or exit or 30s`).

### 2. IPC surface

New channels + `AgentApi` methods (following the existing `agent:*` /
`onAgentBackground` pattern in `src/shared/ipc.ts`, preload, and main):

- `backgroundProcsList(agentId): Promise<BackgroundProcInfo[]>`
- `monitorsList(agentId): Promise<MonitorInfo[]>`
- `backgroundProcKill(id): Promise<void>`
- `backgroundProcSubscribe(id): Promise<{ backlog: string; status: 'running' | 'exited'; exitCode: number | null }>` — returns the current buffer and starts live forwarding for `id`.
- `backgroundProcUnsubscribe(id): Promise<void>`
- Event `onBackgroundProcData(cb: (e: { id: string; chunk: string }) => void)` — forwarded only for currently-subscribed ids.
- Event `onBackgroundProcExit(cb: (e: { id: string; exitCode: number | null }) => void)` — for subscribed ids, so the panel updates a shell's status live.

`BackgroundProcInfo` / `MonitorInfo` types live in `src/shared/types.ts`.

### 3. Subscription forwarding (main)

`MeowAgentManager` owns the subscription set and bridges store events to the
renderer:

- A `Set<string>` of subscribed proc ids.
- On construction, attach listeners to `backgroundProcs` `data`/`exit`; for a
  subscribed id, emit the corresponding renderer event (via the existing
  `onEvent`/IPC bridge used for `agent:background` etc.).
- `subscribe(id)` adds to the set and returns `inspect(id)` (backlog + status).
- `unsubscribe(id)` removes from the set.
- On `stop(agentId)` / `dispose()`, drop subscriptions for that agent's procs
  (best-effort; the panel also unsubscribes on close).

### 4. Renderer overlay (`ProcessesOverlay`)

New `src/renderer/src/components/processes/ProcessesOverlay.tsx`, mirroring
`FilesOverlay`:

- Props: `{ agentId, full, width, onWidthChange, onToggleFull, onClose }`.
- Constants `PROCESSES_MIN_WIDTH` / `MAX` / `DEFAULT` (reuse Files' 320/900/420).
- Header (title "Processes", Expand/Restore, Close) + edge resizer, same markup
  classes pattern as Files (new `processes-*` CSS, added to the same stylesheet
  Files uses).
- Left column: **Shells** section (each row: status dot, command (title=id),
  exit code when exited, Kill button) and **Monitors** section (each row:
  target id + `until` summary + "watching"). Polls `backgroundProcsList` +
  `monitorsList` every ~1.5s while open.
- Right column: live output of the selected shell in an auto-scrolling `<pre>`.
  On select → `backgroundProcSubscribe(id)` (render backlog, then append
  streamed chunks via `onBackgroundProcData`); update status via
  `onBackgroundProcExit`. On deselect/close/unmount → `backgroundProcUnsubscribe`.

### 5. App wiring (`App.tsx`)

Mirror the Files overlay state, opened by **agent** (not project path):

- State `processesOpenFor: string | null` (agentId), `processesFull: boolean`,
  `processesWidth: number` (persisted to `localStorage` under
  `meow.processes.width`).
- Render `<ProcessesOverlay>` as a sibling of the panes, same slot logic as
  Files (they are mutually exclusive-friendly but may co-exist; keep it simple:
  render whichever are open).
- Add a **"Processes"** entry to the pane `⋮` menu next to "Files"
  (`onOpenProcesses(agentId)`), wired through the same prop chain as
  `onOpenFiles`.

### 6. Lifecycle & cleanup

- Panel unsubscribes on close / shell change / unmount.
- Main drops an agent's subscriptions on `stop`/`dispose`.
- Nothing persisted.

## Testing Strategy

TDD for the main-process parts; the React component is typecheck + manual smoke.

**Unit (main):**

- `BackgroundProcessStore.list(agentId)` returns running + exited entries with
  correct fields, scoped to the agent.
- `MonitorStore.list(agentId)` returns active monitors with a readable `until`.
- Manager subscription bridge: after `subscribe(id)`, a store `data` emit for
  that id produces a forwarded renderer event; after `unsubscribe(id)`, it does
  not. (Test against the manager's forwarding function with a captured emit.)

**Integration (IPC):** the `backgroundProcsList` / `monitorsList` /
`backgroundProcKill` / `backgroundProcSubscribe` handlers round-trip through the
manager (can be exercised at the manager method level).

**Manual smoke (documented in the plan):** run the app, start a background
shell (`bash run_in_background`), open the pane `⋮` → Processes, confirm the
shell appears, its output streams live, Kill works, and a `monitor` shows in the
Monitors list.

## Rollout / Phasing

Single cycle. After this, the Background Bash → Monitor → Processes UI line is
complete; persistence-across-restart remains intentionally out of scope.
