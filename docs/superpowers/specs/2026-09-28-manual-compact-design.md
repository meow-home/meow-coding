# Manual `/compact` and Progress-Based Compaction — Design

Date: 2026-09-28 · Status: implemented
Builds on: `c758dd7` (streamed usage for every OpenAI-compatible provider).

## 1. Problem and evidence

Long sessions on `ollama-cloud` reach a point where context can no longer be compacted, and the user has
no way to compact on demand.

Evidence:

- Before `c758dd7`, every assistant message in the three stored `ollama-cloud` sessions recorded
  `tokens: {input: 0, output: 0}` (219/219, 68/68, 4/4): the provider streamed no usage, so compaction
  only saw the transcript estimate, which misses the system prompt and tool definitions, and fired late.
  Fixed by `c758dd7`; the remaining causes are in the runner.

Root causes in `src/main/agent/loop.ts` / `compact.ts`:

1. **Nothing to summarize inside one long turn.** `selectHeadTail` keeps the last `tailTurns` (2) user
   turns verbatim and summarizes only what precedes them. A session with one or two user prompts and a
   long autonomous tool loop has an empty head, so `compact()` falls through to `hardTruncate`.
2. **`hardTruncate` keeps the final turn whole**, even when that turn alone exceeds the target, so the
   request still goes out over the limit.
3. **Fixed cap.** `MAX_COMPACT_PER_RUN = 2` LLM compactions per run; after that only `hardTruncate`
   runs. The same constant also caps context-overflow retries.
4. **Stale provider usage.** `lastTokens` is never cleared when the transcript is replaced and survives
   across runs. `compactIfOverThreshold` takes `max(estimate, lastTokens)`, so the first step after a
   compaction that happened outside a step (the new idle `/compact`) would compact again.
5. **No manual trigger.** The user cannot compact before the window fills, nor give the summary a focus.

## 2. Goal and success criteria

A long turn can always be brought under the context threshold; compaction keeps running as long as it
makes progress; the user can compact on demand, with optional focus instructions, whether the session is
idle or running.

Success:

- A single-prompt session with many tool steps compacts via LLM summary (not only truncation) and keeps
  running.
- A turn that compacts effectively more than twice is not forced into truncation.
- `/compact` works idle and mid-turn, with auto-compaction on or off.
- `npm run typecheck` and `npm test` pass.

Out of scope: a new UI surface (the existing compaction feed lines are reused); changing the context
readout; changing the summary template beyond the focus block; compaction for subagents (they share the
runner code path and inherit the fixes, but get no `/compact`).

## 3. Approach

Extend `SessionRunner` (one per session, kept in `MeowAgentManager.runners` while idle) with a manual
compaction entry point that shares the automatic path. New splitting and progress logic are pure
functions in `compact.ts`.

Rejected: extracting a separate `Compactor` class used by both runner and manager — cleaner long-term
but moves a lot of `loop.ts` code and risks the existing loop tests for no functional gain here.

## 4. Design

### 4.1 The `/compact` command

- `commands.ts`: add `COMPACT_COMMAND` — `name: 'compact'`, `type: 'system'`, `template: ''`,
  description `Summarize older context to free up space`. Registered with the built-ins, so it appears
  in the `/` menu and works from the remote client (which also routes through `runCommand`).
- `MeowAgentManager.runCommand`: the `system` branch dispatches `compact` to
  `compactSession(agentId, args)`.
- `args` (trimmed) are the optional focus instructions.

### 4.2 Flow

`compactSession(agentId, instructions)`:

- **Running** (`this.running.has(agentId)`): `runner.requestCompact(instructions)` records a pending
  manual request. At the next step boundary `compactIfOverThreshold` sees it, compacts regardless of the
  threshold, and clears it. The turn continues.
- **Idle**:
  - No API key → the same `[meow] No provider/API key configured…` error as a send.
  - Claim `running` (and `compacting`, so the idle auto-compactor skips it) and register an
    `AbortController` in `controllers`, so `stop()` (sidebar Stop, remote) cancels the compaction and
    prompts sent meanwhile are queued. No `turn-started` is emitted: this is not a turn, so the
    composer keeps its Send button.
  - Call `runner.compactNow(instructions, signal)`, which resolves the compaction settings the same way
    `run()` does and runs the shared compaction body.
  - Release `running`/`controllers` and drain the queue.
- Manual compaction runs even when `compaction.auto` is `false`.
- `PreCompact` hooks run with trigger `'manual'` (already supported by `HooksRunner`).
- Feed: reuses `compaction-start` / `compacted` / `compaction-failed`. No user bubble is created.
- Nothing to summarize (empty transcript, or one step only) and nothing to truncate → a `notice`
  `[meow] Nothing to compact yet.` and no LLM call.
- Notices travel as a new `ChatEvent` `{ type: 'notice'; agentId; text }`, rendered by `ChatPanel` as
  the existing feed-only `notice` row (never persisted).

### 4.3 Focus instructions

`buildCompactionPrompt(previousSummary, headText, focus?)`: when `focus` is non-empty, append

```
<focus>
{focus}
</focus>
The user asked to keep the details above in particular; preserve them in the summary.
```

before the history text. Automatic compaction passes no focus.

### 4.4 Summarizing inside a long turn

New pure function in `compact.ts`:

```ts
splitWithinTurn(items, keepTokens): { head: TranscriptItem[]; request: TranscriptItem; recent: TranscriptItem[] } | null
```

- Used by `compact()` (through `planCompaction`) when `selectHeadTail` returns an empty head.
  `selectHeadTail` already moves an older oversized turn into the head (its tail must fit
  `keepTokens`), so an empty head means the **last** turn is the one to split.
- Takes the last turn and splits it into **steps**: a step starts at an assistant message
  and runs through the tool items that follow it. The loop always persists an assistant message before a
  tool batch, so every tool item belongs to a step. Splitting only at step starts matters because
  `toLlmMessages` drops a tool item with no preceding assistant message.
- Keeps the most recent steps verbatim up to `keepTokens` (at least one), and returns everything
  before them as `head` (earlier turns with compaction pairs stripped, then the turn's older steps),
  the turn's user message as `request`, and the kept steps as `recent`.
- Returns `null` when the turn has fewer than two steps.

Resulting transcript:

```
[marker "What did we do so far?"] [summary] [request, verbatim] [recent steps…]
```

- Marker + summary stay at index 0/1, so `findPreviousSummary`, `stripCompactionPairs` and the
  Anthropic cache breakpoint (`withCacheBreakpoints`) keep working.
- The user's original request is preserved verbatim rather than folded into the summary.
- On the next compaction the request counts as a normal turn; if it grows again, `splitWithinTurn`
  applies again.

### 4.5 Step-aware `hardTruncate`

After clearing tool outputs and dropping whole older turns, if the final turn alone still exceeds the
target, drop its oldest steps one at a time, keeping its user message and at least one step. The result
never contains a tool item without its assistant message.

### 4.6 Progress instead of a fixed cap

- Before and after each LLM compaction, measure `estimateUsage(toLlmMessages(items, opts))`.
- After result ≥ the compaction target → `hardTruncate` immediately, in the same call, so the next step
  is under the threshold.
- Reduction < 20% (`MIN_COMPACTION_GAIN = 0.2`) → set `compactionStalled` for the run; later automatic
  compactions in that run skip the LLM call and go straight to `hardTruncate`.
- Otherwise automatic compaction may run again whenever the threshold is crossed.
- Safety cap: `MAX_COMPACT_PER_RUN = 10` LLM compactions per run (cost guard only).
- Manual `/compact` ignores `compactionStalled` and the cap and does not count toward it. A manual
  compaction that reaches the gain clears `compactionStalled`; one that does not keeps its result and
  emits a `notice` `[meow] Compaction saved little context — the recent steps are most of it.`
- Context-overflow retries get their own constant `MAX_OVERFLOW_RETRIES = 2` (unchanged behavior).

### 4.7 `lastTokens`

Clear `lastTokens` whenever `replaceItems` is called from compaction or truncation. The next threshold
check then uses the transcript estimate until the provider reports fresh usage.

## 5. Error handling

- Summary call fails or returns empty → `compaction-failed`, then `hardTruncate` (as today).
- Abort (Stop) during idle compaction → no transcript change; emit `compaction-failed` so the feed's
  `Compacting context…` line does not stay spinning (mid-run aborts keep today's behavior: the run's
  `done('stopped')` ends it); `running` and the controller are released in `finally`.
- Manual request pending when a run ends → cleared at run end; it does not carry into the next run.

## 6. Testing

Unit (`tests/unit/`):

- `compact`: `splitWithinTurn` — splits only at assistant boundaries, preserves the request, respects
  `keepTokens`, keeps at least one step, returns `null` for a one-step turn; step-aware `hardTruncate` —
  never orphans a tool item, keeps the request; `buildCompactionPrompt` with and without focus.
- `commands`: `compact` is a built-in system command.
- `agent-loop`: a single-turn many-step transcript over the threshold compacts via summary and
  continues; effective compaction runs more than twice in a run; low-gain compaction sets stalled and
  the next trigger truncates without an LLM call; after any compaction the transcript is under the
  target; `requestCompact` mid-run compacts at the next step below the threshold; `compactNow` works with
  `auto: false`, passes focus into the prompt, ignores stalled; the first step after an idle
  `compactNow` does not compact again (`lastTokens` cleared); overflow retries still stop at 2.
- `meow-agent-manager`: `/compact` idle claims `running` (a send meanwhile is queued) and releases it;
  `/compact` while running calls `requestCompact`; no API key → error.

## 7. Documentation

Update `src/main/agent/AGENTS.md` (`compact.ts`, `loop.ts`, `commands.ts` rows),
`docs/reference/03-agent-runtime.md` (compaction section) and the slash-command reference page, per the
documentation sync rule.
