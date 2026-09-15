# Extended Hook Events Design Spec

## Executive Summary

Extend Meow's hook system from three events (`PreToolUse`, `PostToolUse`,
`Stop`) to eight by adding **`UserPromptSubmit`**, **`SessionStart`**,
**`SubagentStop`**, **`PreCompact`**, and **`SessionEnd`** — matching Claude
CLI's hook surface (minus `Notification`, intentionally deferred). The execution
engine (`HooksExecutor`) already supports `command` / `mcp_tool` / `http` /
`prompt` hook types and matcher semantics; this work adds each event's name,
payload, result mapping, and fire site.

## Background & Motivation

`HooksExecutor` / `HooksRunner` (`src/main/agent/hooks.ts`) implement a mature
hook engine used by the tool loop for `PreToolUse` / `PostToolUse` / `Stop`.
Users can automate around tool calls and turn endings, but not around the other
lifecycle moments Claude CLI exposes: when a prompt is submitted, when a session
starts or ends, when a subagent finishes, or before compaction. Adding these
unlocks context injection at prompt/session start, subagent post-processing, and
compaction/cleanup automation, with the existing hook types and safety controls.

## Goals

- Add five events with Claude-CLI-shaped payloads and control semantics.
- Fire each at the correct site: `UserPromptSubmit` / `SessionStart` /
  `SessionEnd` in the manager, `SubagentStop` in the task tool, `PreCompact` in
  the loop.
- Reuse the existing execution engine, matcher rules, and loop-detection
  safeguards.

## Non-Goals (YAGNI)

- **`Notification`** event — deferred (low value; Meow's notification path
  differs from Claude CLI's).
- No config-UI changes; hooks continue to be defined in project `.meow/` hooks
  and user settings via the existing `HooksConfig` shape.
- No `matcher` for `PreCompact` / `SessionStart` / `SessionEnd` /
  `UserPromptSubmit` / `SubagentStop` — like `Stop`, they ignore the matcher and
  all configured hooks fire.

## Requirements & Scope

### 1. Types & config (`hooks.ts`)

- `HookEventName` gains `'UserPromptSubmit' | 'SessionStart' | 'SubagentStop' | 'PreCompact' | 'SessionEnd'`; add each to `HOOK_EVENTS` and `HooksConfig`.
- New result types:
  - `UserPromptSubmitResult { block?: boolean; reason?: string; additionalContext?: string }`
  - `SessionStartResult { additionalContext?: string }`
  - `SubagentStop` reuses `StopResult { block: boolean; reason?: string }`.
  - `PreCompact` and `SessionEnd` have no result (`Promise<void>`).
- Per-event default timeouts in `DEFAULT_TIMEOUT_S` (UserPromptSubmit like
  PreToolUse — must not stall the turn; the others like Stop/PostToolUse).

### 2. Runner methods (`HooksRunner` interface + `HooksExecutor`)

Each mirrors the existing `runStop` / `runPreToolUse` shape: iterate the event's
hooks, build a payload (`hook_event_name`, `cwd`, event fields), call
`execute(hook, event, payload)`, read `hookOutput(exec.json)` + exit code,
aggregate.

- `runUserPromptSubmit(prompt: string): Promise<UserPromptSubmitResult>` —
  payload adds `prompt`. Exit 2 or `decision: 'block'` (or `ok === false`) →
  `block: true` with reason; `additionalContext` from stdout JSON is
  concatenated. Matcher ignored (all `UserPromptSubmit` hooks fire).
- `runSessionStart(source: 'startup' | 'resume'): Promise<SessionStartResult>` —
  payload adds `source`. Cannot block; only `additionalContext` is aggregated.
- `runSubagentStop(lastAssistantMessage: string, stopHookActive: boolean, subagentType: string): Promise<StopResult>` —
  payload adds `last_assistant_message`, `stop_hook_active`, `subagent_type`.
  First hook to block wins (identical to `runStop`).
- `runPreCompact(trigger: 'auto' | 'manual'): Promise<void>` — payload adds
  `trigger`. Fire-and-inform; return value ignored.
- `runSessionEnd(reason: 'delete' | 'exit'): Promise<void>` — payload adds
  `reason`. Fire-and-forget.

### 3. Fire sites

- **`UserPromptSubmit`** — `MeowAgentManager.send(agentId, text, …)`, before the
  message is enqueued/run. On block: do not run the turn; emit the reason to the
  feed and return. On `additionalContext`: prepend it to the user message text
  as a `<system-reminder>` block so it travels with the (possibly queued)
  message. Only genuine user submits go through `send()`; internal nudges
  (background-exit wake, monitor resolve) use `enqueueMessage` directly and do
  NOT fire this event.
- **`SessionStart`** — the manager fires it on the **first turn of a session**
  (tracked per session id), with `source: 'resume'` if the session already has
  transcript items, else `'startup'`. `additionalContext` is injected into that
  turn as a `<system-reminder>`.
- **`SessionEnd`** — `removeAgent` (`reason: 'delete'`) and `dispose`
  (`reason: 'exit'`).
- **`SubagentStop`** — `task.ts`, after the subagent's `runner.run()`
  completes, with its last assistant message and `subagent_type`. A block
  resumes the subagent (bounded like the main loop's `MAX_STOP_BLOCKS`); the
  `stop_hook_active` flag is passed to prevent infinite blocking.
- **`PreCompact`** — `loop.ts` inside the compaction path (`maybeCompact`),
  immediately before `compactTranscript`, with `trigger: 'auto'`.

The manager already builds a `hooks()` factory (`new HooksExecutor(...)`) that it
passes to the `SessionRunner` and the task tool; it calls `runSessionStart` /
`runSessionEnd` / `runUserPromptSubmit` on that same runner.

### 4. Safety & loop prevention

- `SubagentStop` carries `stop_hook_active` and is bounded by a max block count
  (mirroring the loop's `Stop` handling), so a blocking hook cannot loop
  forever.
- `PreCompact` cannot block, so it cannot loop.
- `UserPromptSubmit` block rejects the prompt once; it does not re-run.

### 5. Testing

TDD.

**Unit (`HooksExecutor`)** — using the injectable `spawnFn` (already in
`HooksExecutorDeps`) to stub hook processes:

- `runUserPromptSubmit`: payload carries `prompt`; a hook exiting 2 → `block`
  with reason; a hook emitting `{ hookSpecificOutput: { additionalContext } }` /
  `{ additionalContext }` on stdout → aggregated context; no hooks → empty
  result.
- `runSessionStart`: `source` in payload; `additionalContext` aggregated; cannot
  block (exit 2 produces no block).
- `runSubagentStop`: exit 2 / `decision: block` → `{ block: true }`.
- `runPreCompact` / `runSessionEnd`: fire the configured hooks without throwing
  and return void.

**Unit/integration (call sites):** `UserPromptSubmit` block prevents the turn
(manager does not enter the loop); `SessionStart` fires once per session with
the right `source`; `SessionEnd` fires on delete and dispose. These are verified
at the method level with a stubbed runner where the full manager is too heavy.

## Rollout / Phasing

Single cycle. Afterward Meow's hook surface matches Claude CLI except
`Notification`, which remains an explicit future addition.
