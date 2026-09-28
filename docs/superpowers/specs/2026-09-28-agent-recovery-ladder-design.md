# Agent Recovery Ladder — Design

Date: 2026-09-28 · Status: awaiting written-spec review
Supersedes: the `MAX_LOOP_BREAKS` stop rules in §5.2 and §6.2 of
[2026-09-24 agent loop robustness](./2026-09-24-agent-loop-robustness-design.md). Its detectors
(`repeatDetector`, `toolLoopDetector`, `createResponseGuard`), harness notes, sampling presets and
current-turn reasoning replay stand.

## 1. Problem and evidence

Long turns end with *"The model could not make progress and the turn was stopped. Its output kept
degenerating…"* (`done{reason:'stuck', stuckCategory:'stream'}`). The user then types "tiếp tục"
("continue") and the model carries on normally.

Evidence from session `9dab4c68` (project `triple-a`, model `ollama-cloud/deepseek-v4.1-flash`):

- The turn was stopped twice (transcript items 46 and 144). Both are assistant messages with
  ~21–23k chars of reasoning, no text, no tokens.
- Both are **real** loops, not false positives: the model had decided what to do but could not leave
  its reasoning to emit the tool call — "Let me write the tool calls now. / Go. / Writing. / OK. /
  Let me write A. / Writing A…". Both happened right before a large tool call (a full HTML file, or
  two calls at once).
- Every step in that turn reasons 10–24k chars, and the whole turn's reasoning is replayed on each
  step, so the prompt primes the model with its own repetitive thinking.
- No `interleaved` / `tool-flood` / tool-loop harness note appears in any of the 22 transcripts since
  2026-09-24, so the "consecutive cuts" path did not cause these stops.
- After the user's "tiếp tục" the model resumed immediately: a new user message drops the looped
  reasoning from the replay and gives the model a fresh start.

Root causes in the runner:

1. **Stop instead of recover.** A repetition with no tool calls is retried once with
   `frequencyPenalty 0.5`, and the retry request still carries the same history; a second hit ends
   the turn.
2. **Run-wide counter.** `loopBreaksThisRun` (shared by repetition retries and tool-loop trips) is
   never reset inside a run, so a long turn is stopped after its third stumble even when the
   stumbles are a hundred clean steps apart.
3. **No observability.** Guard verdicts are not logged, so the failing model and branch had to be
   reconstructed from transcripts.

Other harnesses: Claude Code and Codex run first-party models on native protocols, where this
failure is rare. OpenCode has no text-repetition detector at all — a looping model runs to
`max_tokens` — and its tool "doom loop" check asks the user instead of ending the turn.

## 2. Goal and success criteria

A degenerate step is recovered automatically, the way the user's "continue" recovers it today, and a
turn never ends with an error because of repetition while a user is present. When automatic recovery
is exhausted the turn pauses and asks the user.

Success: the evidence case has a reproduction test that recovers instead of stopping; a turn with
three stumbles separated by clean steps completes; `npm run typecheck` and `npm test` pass.

Out of scope: trimming reasoning replay on every step (DeepSeek's native API requires
`reasoning_content` to be passed back); automatic fallback to another model; Gemini thought
signatures in `meow-gateway`; the parked PTY runtime.

## 3. Approach

A new pure module decides the next recovery action; `SessionRunner` executes it. Rejected: raising
`MAX_LOOP_BREAKS` and resetting it on clean steps (the retry still replays the looped context, which
the evidence shows keeps looping), and prevention-only changes (they reduce frequency but leave no
recovery when a loop still happens).

| Unit | Responsibility |
|---|---|
| `agent/recovery-policy.ts` (new) | Sliding-window recovery ladder: hit → level |
| `agent/loop.ts` | Executes the level: ephemeral note, anti-repetition, force-compact, pause |
| `agent/harness-note.ts` | Adds the ephemeral recovery note text |
| `shared/types.ts` | `step-discarded.recovery` |
| `renderer/.../ChatPanel.tsx` | Recovery status line, updated stuck text |

## 4. Recovery policy (`recovery-policy.ts`)

```ts
export type RecoveryHit = 'repetition' | 'tool-loop'
export type RecoveryLevel = 1 | 2 | 3 | 4

export interface RecoveryPolicy {
  /** Record a hit; returns the level to apply now. */
  onHit(hit: RecoveryHit): RecoveryLevel
  /** A step that finished with no hit. */
  onCleanStep(): void
  /** The user chose to continue from the pause prompt. */
  reset(): void
}

export function recoveryPolicy(opts?: { resetAfterCleanSteps?: number }): RecoveryPolicy
```

- Each `onHit` raises the level by one, starting at 1, capped at 4.
- `onCleanStep` counts consecutive clean steps; after `RECOVERY_RESET_STEPS` (3) the level returns
  to 0, so the next hit is level 1 again. A hit resets the clean-step count.
- `reset()` returns the level to 0 and clears the clean-step count.
- `interleaved` and `tool-flood` cuts are **not** hits. They are still cut and annotated as today,
  and a cut step does not count as clean.

## 5. Runner handling

`loopBreaksThisRun`, `consecutiveCutsThisRun` and `MAX_LOOP_BREAKS` are removed. The runner creates
one `recoveryPolicy()` per run. The existing guard and tool-loop detection are unchanged; only what
happens after a hit changes.

### 5.1 Repetition with no tool calls in the step

Nothing from the step is written to the transcript (the looped reasoning is never replayed), the
provider request is aborted, and `step-discarded{reason:'repetition', recovery}` is emitted. The step
is re-run without consuming a step:

| Level | Re-run |
|---|---|
| 1 | Request = current history + ephemeral recovery note |
| 2 | As level 1, with `antiRepetition: true` sampling |
| 3 | `forceCompact()`, then as level 2 |
| 4 | Pause (§5.4) |

`forceCompact()` is a no-op when auto-compaction is off; level 3 then behaves like level 2.
Because the discarded step leaves the transcript untouched, the re-run request is the previous
request plus the note, so providers that require reasoning replay (DeepSeek native) accept it.

### 5.2 Repetition after tool calls, and tool loops

The step's accepted calls still run and get results. The existing cut note (repetition) or
tool-loop note stays on the last result. The hit then also goes through the ladder, applied to the
**next** step:

| Level | Next step |
|---|---|
| 1 | Normal (the note on the tool result is the nudge) |
| 2 | `antiRepetition: true` sampling |
| 3 | `forceCompact()` first, then `antiRepetition: true` |
| 4 | Pause (§5.4) before the next step |

### 5.3 Ephemeral recovery note

`buildMessages` appends one extra `user` message for the re-run only, like `MAX_STEPS_PROMPT` today.
It is never persisted. Text (`harness-note.ts`, `recoveryNote()`):

```
<system-reminder>
[meow] Your previous response started repeating itself and was discarded. You already have
the information you need: call the next tool or give your answer now, without restarting
your reasoning.
</system-reminder>
```

### 5.4 Pause

Only when the runner has an interactive `ask` (a top-level session with a user). The runner emits
`prompt-request{kind:'question'}` through the same path as the `question` tool, so a remounted chat
panel restores it through `PendingPromptInfo`:

- question: `The model keeps repeating itself and could not recover on its own. Continue this turn?`
- options: `Continue`, `Stop`; `custom: true`.

Responses:

- **Continue** → `policy.reset()`, re-run the step at level 1.
- **Custom text** → appended as a real user message through the steer path (`user-message` event),
  `policy.reset()`, and the loop continues. This is the automated form of the user's "tiếp tục".
- **Stop**, an empty or dismissed response → `done{reason:'stuck', stuckCategory, stuckTool?,
  recoveryCount}` as today.
- Run aborted while waiting → `done{reason:'stopped'}`.

Only top-level sessions pause (`LoopDeps.pauseOnStuck`, set by `MeowAgentManager`); delegated
sessions are top-level sessions and already block on permission prompts the same way. Subagents
run by the `task` tool do not pause: level 4 ends the subagent turn with `done{reason:'stuck'}`,
and the parent handles it as today.

### 5.5 Logging

Each hit and each pause response logs one `console.warn` line from the main process (captured in
`userData/logs/YYYY-MM-DD-log.txt`):

```
[meow] recovery agent=<id> model=<model id> hit=repetition|tool-loop channel=text|reasoning|- level=<1-4> step=<n> tail="<last 160 chars, whitespace collapsed>"
[meow] recovery agent=<id> pause=continue|custom|stop
```

## 6. Events and UI

- `ChatEvent` `step-discarded` gains `recovery?: { level: 1 | 2 | 3; of: 3 }`. The renderer still
  drops the discarded bubble and shows a display-only status line in the chat:
  `[meow] Model started repeating itself — recovering (1/3)`. It is not persisted.
- Level 3 reuses the existing compaction events.
- No new IPC channel.
- The stuck text in `ChatPanel.tsx` becomes
  `Stopped: the model kept repeating itself after automatic recovery.` for `stream`; the `tool`
  variant keeps naming the repeated tool. The "running past its tool calls" wording is removed, since
  cuts no longer end a turn.

## 7. Testing

Vitest; `npm run typecheck` and `npm test` must pass.

- `tests/unit/recovery-policy.test.ts` (new): levels 1→2→3→4 in order and capped at 4; reset after
  3 clean steps; a hit resets the clean-step count; `reset()`.
- `tests/unit/agent-loop.test.ts`:
  - **evidence reproduction**: a reasoning stream looping on "Let me write. / Writing. / OK." twice
    in a row → the step is re-run (not `stuck`); the re-run request contains the recovery note and
    none of the looped reasoning; the transcript has no synthetic message;
  - level 2 sets `antiRepetition`, level 3 calls `forceCompact`;
  - level 4 emits `prompt-request{kind:'question'}`; `Continue` re-runs at level 1; custom text
    appends a user message and continues; `Stop` → `done{stuck}`; abort while waiting →
    `done{stopped}`;
  - no interactive `ask` (subagent) → level 4 ends `stuck`;
  - three hits each separated by more than 3 clean steps → the turn completes;
  - repetition after calls and tool loops run their calls and escalate on the next step;
  - `interleaved` / `tool-flood` cuts never pause or end the turn.
- Existing tests that assert the `MAX_LOOP_BREAKS` behavior are updated to the ladder.
- e2e is not affected (no new UI surface; the pause reuses the question popup).

## 8. Documentation

Updated in the same commit as the code:

- `docs/reference/03-agent-runtime.md` — loop pseudo-code and the guard/recovery section.
- `docs/reference/05-ipc-contract.md` — `step-discarded.recovery`; the `stuck` description.
- `docs/reference/09-ui-guide.md` — recovery status line and the pause prompt.
- `src/main/agent/AGENTS.md` — `recovery-policy.ts`; `loop.ts` / `harness-note.ts` entries.

## 9. Constants

| Name | Value |
|---|---|
| `RECOVERY_RESET_STEPS` | 3 |
| Automatic levels before pause | 3 |
| `ANTI_REPETITION_FREQUENCY_PENALTY` | 0.5 (unchanged) |
| `MAX_LOOP_BREAKS` | removed |
