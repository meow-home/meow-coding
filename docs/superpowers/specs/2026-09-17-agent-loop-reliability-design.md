Status: pending review

# Agent Loop Reliability — Design

Date: 2026-09-17

## 1. Goal and evidence

Make long-running sessions reliable across providers by preserving streamed content,
making Windows file edits predictable, distinguishing repeated actions from lack of
progress, and providing a real asynchronous wait for monitors.

Investigation of the latest Triple A session found two failed edits whose LF search
strings matched the saved CRLF read output after newline normalization. The model
then attempted shell/Python repairs repeatedly, producing invalid regular expressions
and quoted strings. The transcript contains two recovery nudges during that sequence.
Earlier history was compacted; the initial introduction of the broken regex is unknown.

Independent reproductions confirmed:

- The shared stream helper changes `hel` + `lo` into `helo`.
- The tool guard flags test/edit/test/edit/test despite intervening changes.
- A mocked runner making changing successful tool results terminates as `stuck`
  after 17 requests, with three tool-start events lacking terminal tool results.
- Monitor registration returns immediately and currently permits duplicate watches.

These establish application defects, not proof that every reported model loop has
the same cause. The saved transcript does not retain raw rejected stream chunks or
the exact trigger of each recovery.

## 2. Scope and alternatives

The selected scope includes stream assembly, CRLF edits, repetition detection,
bounded recovery, diagnostic events, and both shell and command-poll monitors.

A minimal stream/edit patch would leave false positives in the guard. A separate
supervisor model or automatic provider switching adds cost without repairing the
underlying defects. Use deterministic runtime changes and tests first.

No provider switch, new supervisor model, broad shell rewrite, or session migration
is part of this design. Existing persisted messages remain readable.

## 3. Lossless stream assembly

Treat SDK text-delta and reasoning-delta events as incremental content. Concatenate
them verbatim in the main process and renderer. Do not infer duplication from a
matching suffix/prefix. Persisted messages and rendered messages must agree exactly.

If a provider demonstrably supplies cumulative snapshots, adaptation belongs at that
provider's boundary with an explicit contract and fixture. The existing synthetic
overlap test must not define the contract for every provider.

Feed text and reasoning detectors separately from the same canonical deltas. Keep
their state scoped to the current provider response; cross-step lack of progress is
handled by the tool guard rather than concatenating unrelated assistant sentences.

## 4. CRLF-safe edits

First attempt the existing exact match. If there is no match, normalize CRLF to LF
for matching only, retaining an offset mapping into the original file. Reject zero
or multiple matches. Never relax indentation, punctuation, or other whitespace.

Use slicing and literal insertion rather than replacement-string interpolation so
replacement text containing JavaScript dollar substitution sequences stays literal.
Preserve bytes outside the replacement. Normalize inserted newlines to the matched
region's consistent LF/CRLF style; reject a fallback spanning mixed newline styles
with an actionable error instead of silently rewriting unrelated content.

Retain snapshots, artifacts, and diagnostics. Reject an empty search string. Error
messages should distinguish not-found, ambiguous-match, and mixed-newline cases and
recommend reading the relevant region before another attempt.

## 5. Tool progress and repetition

Replace the unconditional pre-execution three-in-eight rule with bounded observations
of completed calls: canonical tool/input fingerprint, success/error classification,
and digest of the full result before transcript truncation. Object key ordering must
not affect fingerprints; preserve array ordering and string values.

Use an eight-completed-call window. Three identical call/result observations identify
a no-progress candidate, not an automatic verdict based on inputs alone. Changing
results break that candidate. Changing timestamps can evade this heuristic, so retain
the existing maximum-step limit independently; do not claim semantic certainty.

Known successful file mutations carry internal path and before/after content hashes.
Re-reading a changed path is allowed. A changed file between test/build invocations
allows revalidation even when the resulting error text is unchanged. Track the
workspace mutation-state digest within the run: revisiting the same observed file
states must not indefinitely reset the guard. Do not infer progress from every shell
command's exit code or claim arbitrary shell mutations are fully observable.

For opaque tools and shell commands, changed results and bounded targeted recovery
provide the fallback. The guard is a heuristic; diagnostics must say which evidence
triggered it. Never reset the run's overall step/recovery budget merely because a
tool reports success.

Repeated successful monitor reuse is a pending state, not completed task progress;
its recovery directs the model to await the existing condition. An awaited timeout
is distinct from an immediate duplicate registration.

## 6. Stream repetition and recovery

For reasoning, require a sustained repetitive suffix rather than four occurrences
anywhere in a mixed-channel history. For final text, use a more conservative rule:
three consecutive identical blocks of at least 80 whitespace-delimited tokens.
For reasoning use four consecutive identical blocks of at least 12 tokens. Preserve
Unicode and punctuation in token comparison. These deliberately conservative initial
rules are deterministic and do not promise to detect every paraphrased loop.

Keep at most two recovery attempts per run. Generate recovery instructions from the
trigger: repeated edit failure, unchanged command result, pending monitor, or repeated
stream. Include the relevant tool name, count, and a bounded error excerpt. Treat
tool excerpts as quoted data, not instructions. Keep discarded looping stream text
out of subsequent prompts; retain diagnostic metadata about its length and trigger.

Every announced tool call receives one terminal result, including calls skipped by
recovery or stream cancellation. Do not execute partially generated or abandoned
calls. Retain replayable assistant/tool pairs in the transcript. A stream interruption
without tool calls need not persist the repetitive content.

Add optional structured stop details to the existing done event: trigger category,
tool name when relevant, and recovery count. Keep `reason: stuck` for compatibility.
The UI should report the observed failure rather than asserting that every stop was
an infinitely repeating model. Log bounded metadata and hashes, not raw prompts,
credentials, or complete tool arguments/results.

## 7. Monitor registration and waiting

### Registration identity

Deduplicate active registrations within the same agent and originating session.
Shell identity includes target shell and normalized match/exit conditions. Command
identity includes the exact command, resolved cwd, normalized conditions, and effective
poll interval. Do not merge distinct commands or conditions. Repeating a registration
with a different timeout reuses its original deadline and explicitly reports that;
it must not extend the deadline or create another watch.

Check reuse before the per-agent capacity limit. Return the existing monitor ID and
whether it was reused. Equivalent omitted/default values have identical keys. Fix
the condition normalization so explicit `until_exit: false` disables exit-success
matching in command mode. Shell exit still terminates a shell watch and reports the
actual exit code; it is not automatically success of the requested condition.

### Awaiting results

Add optional `wait: boolean` to the monitor tool, defaulting to false for compatibility.
`wait: true` registers or reuses the same condition and awaits its result asynchronously.
There is no provider request while this tool call is awaiting. Document this mode as
the normal choice when the next action depends on completion; subscription mode is
for work that can continue independently.

A wait call lasts at most 60 seconds or the monitor's earlier deadline. On wait-window
expiry return a structured pending result with the existing monitor ID; do not cancel
or re-register the watch. Subsequent waits with the same condition reuse the watch.
Repeated pending wait results are not instant-repeat candidates because they have
actually waited, but the run's existing step budget still applies.

Expose an atomic register-and-wait operation internally so immediate resolution cannot
occur between registration and listener attachment. Concurrent waiters share one
watch and each settle once. Remove abort listeners on settlement. Run cancellation
settles the waiter; the manager's existing Stop lifecycle cancels its watches.

When an active tool waiter receives the result, deliver it as that tool's result and
do not also inject a recovery/wakeup user message for the same resolution. With no
active waiter, preserve the existing session-scoped background notification path.
Session switching and late callbacks must never wake a different active session.

Track spawned poll processes so cancellation/timeout tears down listeners/timers and
kills the process tree. Stopping a shell watch alone does not kill the watched shell;
the existing explicit shell-stop/session-stop behavior owns that operation.

## 8. Components and documentation

Keep stream assembly in the current main/renderer paths; pure repetition decisions
in `repetition.ts`; integration/recovery in `loop.ts`; file matching in the edit tool;
monitor lifecycle in the two stores; wakeup routing in the manager.

Update affected module AGENTS.md entries narrowly alongside implementation. Update
reference pages 03 (runtime), 04 (tools), and 05 (event contract), plus 09 if the stop
notice behavior is described there. This draft does not claim those changes exist.

## 9. Acceptance tests and delivery

1. Different chunk partitions yield identical persisted and rendered text/reasoning,
   including repeated letters, punctuation, whitespace, and Unicode.
2. CRLF file + LF search succeeds uniquely and preserves unrelated bytes; ambiguous,
   empty, and mixed-style fallback cases reject safely; dollar text remains literal.
3. Test/edit/test/edit/test and changed read/poll results do not cause false stops.
   Unchanged repeated errors recover and eventually stop. Alternating known file states
   do not reset the budget indefinitely.
4. Structured final text with repeated labels and separate reasoning/text channels
   is not mistaken for a sustained stream loop. Actual repetitive suffix fixtures stop.
5. Recovery leaves no pending tool cards or orphan transcript results and reports its
   trigger. Exhaustion is bounded independently of apparent progress.
6. Duplicate shell/poll registrations reuse IDs and deadlines, including at capacity;
   different sessions or conditions remain separate.
7. Awaiting issues no new LLM calls until settlement; immediate resolution, timeout,
   abort, concurrent waits, explicit false conditions, and session switches are covered.
   Each resolution is delivered once through the appropriate route.
8. Poll cancellation cleans up child processes and timers. User Stop remains responsive.

Implement in independently tested stages: stream/edit correctness, guard/recovery,
then monitor lifecycle and UI integration. Run typecheck and the full unit/integration
suite, followed by build and e2e for the affected UI flow. Baseline investigation found
two bash-suite failures (abort timeout and shell-profile stderr); record and investigate
remaining failures rather than reporting the suite as green.

Validate representative Gemini and DeepSeek sessions after deterministic tests, with
the user's configured providers. Mock tests establish application behavior, not a
guarantee that a provider will never generate a loop.
