# Agent Loop Robustness — Design

Date: 2026-09-24 · Status: awaiting written-spec review
Supersedes: §6 (stream repetition) and the recovery-prompt parts of §5 of
[2026-09-17 agent loop reliability](./2026-09-17-agent-loop-reliability-design.md).
Its §3 (lossless stream assembly), §4 (CRLF edits) and §7 (monitors) stand.

## 1. Problem and evidence

Users on open models behind OpenAI-compatible endpoints (Ollama Cloud `https://ollama.com/v1`,
the local `meow-gateway`) see reasoning that "repeats characters" and turns that loop on tool
calls. Claude Code and Codex do not show this. The investigation used the real transcripts in
`userData/projects/**.jsonl` and reproductions against the current code.

Evidence:

- **One response with 274 tool calls** (`f116cced`, gemini-3.8-flash via the gateway), 156 distinct.
  Its text reads `"counselorNow let me add a test…counselorcounselorcounselor…Let me use a different
  approach…"`. The model never stopped after its first call and hallucinated about a dozen steps
  into one response. All 274 calls ran through one `Promise.all`.
- **Busy-polling** (`f8145e56`, glm-5.3-flash): 6 of 7 recovery nudges fired on `bash_output`
  returning `(no new output)` immediately, call after call. The nudge text ("you keep repeating
  the same analysis") did not describe the situation and the model kept polling.
- **False positive**: the 7th nudge in `f8145e56` fired right after the user gave a new
  instruction through `question`.
- **Detector reproductions** against `repetition.ts` `loopDetector`:
  - four near-identical `it('renders the <x> panel…')` test cases **trip** it;
  - `"counselor"` × 2000 **never** trips it (`/[a-z0-9]+/` sees one word). The same regex shreds
    Vietnamese text into one-letter fragments.
- **UI duplication**: after a loop break or a length resume the runner appends a message
  without emitting an event, and `ChatPanel.flushDeltas` glues the next step's deltas onto the
  previous assistant bubble, so a retried thought visibly "repeats".

Root causes:

1. **No per-response bound.** `max_tokens` is usually omitted (`LimitsService` → `output: null`),
   and there is no cap on tool calls per response.
2. **Wrong detector design.** "A 12-word phrase appears 4 times in the last 360 words" is both
   too eager (code) and blind (character loops, non-ASCII). On a hit it discards everything and
   writes an accusatory user message into the permanent transcript.
3. **Recovery messages are fake user turns**, not tool-result annotations.
4. **No blocking wait primitive.** `bash_output` returns immediately, forcing a poll loop.
5. **Full-history reasoning replay.** `@ai-sdk/openai-compatible` serializes every replayed
   reasoning part as `reasoning_content` on every past assistant message.
6. **Missing step boundaries in the UI.**
7. **Loose provider layer**: no sampling parameters, a stub `execute` on every tool definition,
   SDK-flagged invalid tool calls executed anyway.

Why Claude Code / Codex do not show it: the Anthropic API requires `max_tokens`; native
protocols keep signed thinking / thought signatures and stop after tool calls; waiting is
blocking (Codex `write_stdin` `yield_time_ms`) or notification-based; and neither harness cuts
output with a text heuristic and injects scolding messages into history.

## 2. Goal and success criteria

The agent stays productive on open models behind OpenAI-compatible endpoints for coding work,
without character loops, tool-call floods, or busy-polling, while Anthropic/Google behavior is
unchanged except for the always-sent output cap.

Success: every evidence case above has a reproduction test that passes, `npm run typecheck`,
`npm test`, `npm run build && npm run e2e` pass.

Out of scope: Gemini thought signatures in `meow-gateway` (separate repo; note only); the parked
PTY runtime.

## 3. Approach

Keep `SessionRunner` as the orchestrator and move each responsibility into a pure, separately
tested module. Rejected: a state-machine rewrite of the loop (regression risk across compaction,
hooks, steering, delegation that work today) and the AI SDK's built-in multi-step loop (loses
permission prompts, steering, mid-run compaction and per-step abort).

| Unit | Responsibility |
|---|---|
| `agent/response-guard.ts` | Per-step stream verdicts: tool flood, interleaving, repetition |
| `agent/repetition.ts` | Tandem-repeat detector (`repeatDetector`) + rewritten `toolLoopDetector` |
| `agent/tool-scheduler.ts` | Order-preserving batches: concurrency-safe calls in parallel, others serial |
| `agent/harness-note.ts` | Formats `[meow]` notes appended to tool results |
| `agent/sampling.ts` | Built-in sampling presets + `meow.json` overrides |
| `agent/config.ts` | `resolveWireOutputTokens` |
| `agent/message.ts` | Current-turn-only reasoning replay; no stub `execute` |
| `agent/tools/bash.ts` + `background-process-store.ts` | `bash_output` `wait_s` |
| `renderer/.../ChatPanel.tsx` | `step-start` / `step-discarded` handling |

## 4. Response budget

`resolveWireOutputTokens(limitOutput: number | null, override?: number): number`:

- `override` (from `meow.json` `maxOutputTokens`) is returned unchanged.
- Otherwise `min(limitOutput ?? DEFAULT_OUTPUT_WIRE_CAP, DEFAULT_OUTPUT_WIRE_CAP)` with
  `DEFAULT_OUTPUT_WIRE_CAP = 32_000`.

`MeowAgentManager` uses it for `maxOutputTokensWire`, so `max_tokens` is always sent, for every
provider. The output **reserve** keeps using `resolveOutputTokens` fed with the wire value.
`reduceBudgetForMaxTokensError` and learned limits keep working unchanged (a learned lower value
still wins because it flows in through `limitOutput`).

## 5. Response guard

`createResponseGuard(opts?)` is created per step. The runner feeds it every stream part before
acting on it:

```ts
type GuardVerdict =
  | { kind: 'ok' }
  | { kind: 'tool-flood'; keptCalls: number }
  | { kind: 'interleaved'; keptCalls: number; keptTextChars: number }
  | { kind: 'repetition'; channel: 'text' | 'reasoning'; keepChars: number }

interface ResponseGuard {
  text(delta: string): GuardVerdict
  reasoning(delta: string): GuardVerdict
  toolCall(): GuardVerdict   // called before the call is accepted
}
```

Rules:

| Verdict | Trigger | Kept |
|---|---|---|
| `tool-flood` | the 33rd tool call of a response (`MAX_TOOL_CALLS_PER_RESPONSE = 32`) | the first 32 calls |
| `interleaved` | a tool call that arrives after non-whitespace text which itself followed an earlier tool call (call → text → call) | calls before that text; text streamed before the first call |
| `repetition` | a tandem repeat at the tail of the text or reasoning channel (§5.1) | the channel up to the start of the repeated span plus one unit |

A call is only announced (`tool-start`) once the guard accepts it, so a dropped call never has a
dangling tool-start without a result. Text streamed after the first tool call is not persisted
when a flood or interleave verdict fires.

### 5.1 Tandem-repeat detector (`repeatDetector`)

- One detector per channel per step, so text and reasoning never mix and nothing carries over
  from an earlier step.
- Normalization for comparison: collapse whitespace runs to one space, lowercase. Offsets are
  mapped back to raw-string offsets for `keepChars`.
- Every ≥ 64 new normalized characters, take the last 32 characters as an anchor and find its
  previous occurrence with `lastIndexOf`. The distance is the candidate period `p`
  (1 ≤ p ≤ 1024). Then count how many consecutive copies of the last `p` characters end the tail.
  The work per check is linear in the tail, bounded to the last 8 KiB.
- Thresholds:
  - `p ≤ 16`: the repeated span is ≥ 256 characters;
  - `16 < p ≤ 1024`: ≥ 3 consecutive copies.
- A unit with no letter or digit (Unicode `\p{L}` / `\p{N}`) is ignored, so separator lines,
  box drawing and indentation stay legal.
- Near-identical code (four test cases differing in one word) is not a tandem repeat and does
  not trip. Paraphrased loops are not detected by design; the output cap (§4) bounds them.

### 5.2 Runner handling

On any non-`ok` verdict the runner stops consuming and calls `stepController.abort()`, which
really cancels the provider request.

- **`tool-flood` / `interleaved`**: persist the assistant message (kept text + reasoning) and run
  the kept calls normally. The last kept call's result gets a harness note (§7):
  "Your response was cut: it contained N more tool calls" or "…it continued writing after calling
  tools. Tool results only arrive after your response ends — call tools, then wait for their
  results." No user message is added.
- **`repetition`, first hit in this step**: discard the step output (nothing written to the
  transcript), emit `step-discarded`, and retry the same step with anti-repetition sampling
  (§9.3). The retry does not consume a step.
- **`repetition` again on that retry**: persist the kept prefix as the assistant message (if
  non-empty), then end the turn with `done{reason:'stuck', stuckCategory:'stream'}`.
- Recoveries of all kinds share `MAX_LOOP_BREAKS = 2` per run; past it the turn ends `stuck`.

Removed: the old `loopDetector`, `LOOP_RECOVERY_PROMPT`, and the run-wide text detector state.

## 6. Tool execution

### 6.1 Scheduler

`ToolDefinition` gains `concurrencySafe?: boolean` (default `false`, so MCP and user tools are
serial). Marked safe: `read`, `glob`, `grep`, `webfetch`, `websearch`, `lsp`, `skill`,
`bash_output`, `task`.

`scheduleCalls(decided)` partitions calls **in model order** into batches: a run of consecutive
concurrency-safe calls whose decision is `allow` forms one batch executed in parallel with at most
`MAX_TOOL_CONCURRENCY = 10` in flight; any other call (unsafe, `ask`, or `deny`) is a batch of
one. Batches run sequentially. `PreToolUse` hooks and permission decisions still run up front for
all calls, as today.

Results are appended to the transcript and emitted (`tool-result`) in model order after each batch.
On abort, a call that settles is still appended as soon as it settles, so no orphan tool items
appear.

### 6.2 Tool-loop detector

`toolLoopDetector` keeps its observation model (canonical `tool + input + output + error`
fingerprint, 8-call window, 3 identical observations). It now returns a verdict instead of a
boolean:

```ts
type ToolLoopVerdict = { kind: 'ok' } | { kind: 'poll' | 'repeat'; tool: string; count: number }
```

`poll` is a `bash_output` observation whose shell is still running with no new output; `repeat`
is any other identical triple. The runner appends a harness note to the result of the triggering
call before it is appended:

- `poll`: "The shell is still running with no new output. Wait with
  `bash_output({ id, wait_s: 120 })`, or end your turn — you will be woken when it exits."
- `repeat`: "This exact call returned the same result N times; repeating it will not change the
  result. Use what you have, try a different approach, or end your turn and explain what is
  blocking you."

Each note counts as one loop break. When the limit is spent and the pattern recurs, the turn ends
with `done{reason:'stuck', stuckCategory:'tool', stuckTool}`.

## 7. Harness notes

`harnessNote(text)` renders `<system-reminder>\n[meow] ${text}\n</system-reminder>`, appended to
a tool's output with the existing reminder joiner (after hook context and git or memory
reminders). If the call errored, the note is appended to the error text. Harness notes are the
only way the loop speaks to the model mid-turn; the loop never adds synthetic user messages for
recovery. The length-resume nudge and Stop-hook reasons keep their current user-message form.

## 8. `bash_output` with `wait_s`

- `BackgroundProcessStore.waitForNew(id, ms, signal): Promise<void>` resolves immediately if
  unread output exists or the process has exited. Otherwise it resolves on the next `data` or
  `exit` event for that id, on timeout, or on abort. Listeners are always removed.
- `bash_output` schema adds `wait_s` (number, default 15, clamped to 0–300). With a `filter`, the
  tool keeps waiting while the filtered read is empty, the shell is running and time remains.
- The description tells the model to pass `wait_s` to wait, and that an exited shell wakes it.

## 9. Provider layer

### 9.1 Reasoning replay

`toLlmMessages` emits a `reasoning` part only for assistant messages after the last `user`
message in the transcript. Earlier assistant messages keep text and tool calls only. The
hard-coded `provider: 'deepseek'` field is removed.

### 9.2 Tool definitions and invalid calls

- `toToolDefinition` no longer sets `execute`; the SDK only emits tool calls.
- A `tool-call` part the SDK marks invalid (unknown tool or schema mismatch) is recorded with
  `permission: 'denied'` and `error: "invalid tool call: <reason>. Check the tool name and
  arguments against the schema."` and is never executed. The exact SDK v6 part fields are
  verified in `node_modules/ai` at implementation time. The accompanying `tool-error` part is
  ignored. Invalid calls still count toward the guard.

### 9.3 Sampling

`resolveSampling(modelId, overrides)` returns
`{ temperature?, topP?, frequencyPenalty?, presencePenalty? }`, passed to `streamText` as
standard settings. It applies **only** on the OpenAI-compatible branch of `createLlm`; the
Anthropic, Google and Codex paths send nothing.

- **Built-in presets** keyed by model-family regex: qwen, glm, deepseek, kimi, minimax, gpt-oss,
  gemma, mistral, nemotron. Values come from each publisher's current model card, verified and
  cited in code comments at implementation time; no invented numbers. An unmatched family sends
  nothing.
- **Override**: optional `meow.json` key `sampling: Record<modelGlob, SamplingParams>`, matched
  with the same pattern semantics as permission rules against the bare model id. The first match
  wins over the preset, per field.
- **Anti-repetition retry** (§5.2): the preset plus `frequencyPenalty: max(preset ?? 0, 0.5)` for
  that one retry only. The sampling is passed via a new optional `LlmStreamOptions.sampling`
  field.

## 10. UI events

New `ChatEvent` members (no new IPC channel):

- `{ type: 'step-start'; agentId: string; step: number }` — emitted right before each
  `llm.stream` call, including retries.
- `{ type: 'step-discarded'; agentId: string; reason: 'repetition' }`.

`ChatPanel`:

- On `step-start`, flush pending deltas and arm `startNewBubble`; the next text or reasoning delta
  pushes a new assistant row.
- On `step-discarded`, remove the streaming assistant row(s) created since the last `step-start`
  and show a transient feed-only line: "Model output started repeating — retrying…". It clears on
  the next delta, like the retry line.
- The `stuck` / `stream` error text is updated to describe the repetition stop.

`task.ts` ignores both events. They are display-only and never stored.

## 11. Testing

Unit (model stub, no real API):

- `response-guard` / `repeatDetector`:
  - 274 calls → flood at call 33;
  - call → text → call → interleaved;
  - `counselor` × N → repetition;
  - four near-identical test cases → ok;
  - `────`, `====` and indentation → ok;
  - repeated Vietnamese paragraph → repetition;
  - `keepChars` maps to raw offsets.
- `tool-scheduler`:
  - reads run in parallel with at most 10 in flight;
  - `edit`/`bash` run serially and in order;
  - `ask` calls run alone;
  - results are appended in model order.
- `toolLoopDetector`:
  - polling → `poll` note;
  - identical triple → `repeat` note;
  - test/edit/test progress → ok;
  - repeat after two notes → `stuck`/`tool`.
- `agent-loop`:
  - a repetition retry carries `frequencyPenalty` and leaves the transcript clean, with no
    synthetic user message;
  - a second hit → `stuck`/`stream` with the kept prefix;
  - flood/interleave → kept calls run and the note is on the last result;
  - `step-start` and `step-discarded` are emitted;
  - an invalid call is not executed.
- `message`: reasoning is replayed only after the last user message.
- `sampling`: presets match, glob override wins, the Anthropic/Google branches send no sampling.
- `config` and the manager: the wire value is always set, capped at 32k, override untouched,
  learned limit wins.
- `bash_output` / `waitForNew`: resolves on data, on exit, on timeout and on abort; listeners are
  cleaned up; the filter keeps waiting.

Existing `loopDetector` / `LOOP_RECOVERY_PROMPT` tests are removed or rewritten to the new
behavior.

## 12. Documentation

In the same change:

- `src/main/agent/AGENTS.md`, `src/main/agent/tools/AGENTS.md`,
  `src/renderer/src/components/chat/AGENTS.md`;
- `docs/reference/03-agent-runtime.md` (loop, guard, scheduler, constants),
  `04-tool-catalog.md` (`bash_output wait_s`, `concurrencySafe`),
  `05-ipc-contract.md` (new ChatEvents), `06-data-and-storage.md` (`sampling` key),
  `07-providers-and-connections.md` (sampling, always-sent `max_tokens`).

## 13. Constants

| Constant | Value |
|---|---|
| `DEFAULT_OUTPUT_WIRE_CAP` | 32 000 |
| `MAX_TOOL_CALLS_PER_RESPONSE` | 32 |
| `MAX_TOOL_CONCURRENCY` | 10 |
| `MAX_LOOP_BREAKS` | 2 (unchanged) |
| Repeat detector | anchor 32, check every 64, period ≤ 1024, tail 8 KiB, short-period span 256, long-period copies 3 |
| `bash_output` `wait_s` | default 15, max 300 |
| Anti-repetition `frequencyPenalty` | 0.5 (retry only) |
