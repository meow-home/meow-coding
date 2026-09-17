# Agent Loop Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Meow sessions resilient across Gemini, DeepSeek, and other providers by preserving streamed content, handling CRLF edits, detecting genuine no-progress loops, and making monitor waits deduplicated and cancellable.

**Architecture:** Keep provider adaptation at the LLM boundary and make the shared text path lossless. Keep pure matching and loop heuristics in small testable helpers; let `SessionRunner` own recovery state and let monitor stores own registration/wait lifecycle. Preserve existing `done('stuck')` compatibility while adding bounded structured diagnostics.

**Tech Stack:** TypeScript strict mode, Electron main process, React renderer, Vitest unit/integration tests, Playwright e2e where the UI contract changes.

**Spec:** `docs/superpowers/specs/2026-09-17-agent-loop-reliability-design.md`

## Global Constraints

- Use `Channels` for IPC; do not hardcode channel strings.
- Keep Node/Electron imports out of `src/shared`.
- Keep all source, UI text, and documentation in English.
- Preserve context isolation and main-process-only process management.
- Do not expose raw prompts, credentials, or complete tool arguments/results in diagnostics.
- Preserve existing persisted transcript compatibility and `done.reason === 'stuck'`.
- Every change must update affected module `AGENTS.md` and matching `docs/reference` pages before completion.
- Use TDD: write a focused failing test, run it, implement the smallest change, then rerun focused and full checks.

---

### Task 1: Make stream assembly lossless

**Files:**
- Modify: `src/shared/text.ts`
- Modify: `src/main/agent/loop.ts`
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Test: `tests/unit/text.test.ts`
- Test: `tests/integration/agent-stream-overlap.test.ts`
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Keep `appendStreamDelta(buffer: string, delta: string): string` as the public helper, but make it literal concatenation for incremental deltas.
- If a provider needs cumulative-snapshot handling, add a provider-local adapter in `src/main/agent/llm.ts`; do not put snapshot inference in the shared helper.

- [ ] Add failing tests for `hel` + `lo`, repeated letters, Unicode, punctuation, whitespace, and separate text/reasoning buffers.
- [ ] Add an integration fixture that emits true incremental SSE deltas and asserts the persisted assistant message equals the rendered event stream.
- [ ] Implement literal concatenation in the shared helper and remove overlap inference from main and renderer call sites.
- [ ] Add a separate fixture/test for any provider that emits cumulative snapshots; adapt only at that provider boundary if the repository contains evidence of such a provider.
- [ ] Run `npx vitest run tests/unit/text.test.ts tests/integration/agent-stream-overlap.test.ts tests/unit/agent-loop.test.ts` and verify the old overlap assumption is replaced by the provider contract.
- [ ] Update `src/shared/AGENTS.md`, `src/main/agent/AGENTS.md`, `src/renderer/src/components/chat/AGENTS.md`, and reference pages 03 and 09.
- [ ] Commit: `fix(agent): preserve incremental stream deltas`.

### Task 2: Add CRLF-safe exact editing

**Files:**
- Create: `src/main/agent/tools/text-match.ts`
- Modify: `src/main/agent/tools/edit.ts`
- Test: `tests/unit/agent-tools.test.ts`
- Test: `tests/unit/text-match.test.ts`

**Interfaces:**
- Produce `findUniqueText(content: string, search: string): { start: number; end: number; newline: 'lf' | 'crlf' } | { error: string }`.
- Keep `editTool.run()` returning `ToolRunResult`; preserve snapshot, artifact, and diagnostic hooks.

- [ ] Write failing tests for exact LF matching, CRLF file with LF search, ambiguous search, empty search, mixed newline fallback, and literal `$&`/`$1` replacement text.
- [ ] Implement exact matching first, then LF-normalized matching with an offset map back to the original string; reject zero or multiple matches.
- [ ] Use slicing rather than `String.replace` replacement interpolation; preserve unrelated bytes and normalize inserted newlines to the matched region style.
- [ ] Return distinct actionable errors for not-found, ambiguous, empty, and mixed-newline cases.
- [ ] Run focused tool tests and confirm the Triple A CRLF reproduction succeeds.
- [ ] Update `src/main/agent/AGENTS.md` and reference page 04.
- [ ] Commit: `fix(agent): make exact edits newline safe`.

### Task 3: Replace input-only tool-loop detection with progress-aware observations

**Files:**
- Modify: `src/main/agent/repetition.ts`
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/agent/tools/edit.ts`
- Modify: `src/main/agent/tools/write.ts`
- Modify: `src/main/agent/tools/apply-patch.ts`
- Test: `tests/unit/repetition.test.ts`
- Test: `tests/unit/agent-loop.test.ts`
- Test: `tests/unit/agent-tools.test.ts`

**Interfaces:**
- Replace the current `ToolLoopDetector.next(calls)` contract with completed observations containing `tool`, canonical input fingerprint, result digest, success/error state, and optional mutation digest.
- Keep the detector pure and bounded to an eight-observation window; keep max-step enforcement in `SessionRunner`.

- [ ] Write failing tests proving `test/edit/test/edit/test` and changed-result calls do not trigger a stuck stop.
- [ ] Write failing tests proving three identical completed call/result observations trigger a no-progress candidate.
- [ ] Add stable canonical JSON fingerprinting with sorted object keys, preserved array order, and literal strings.
- [ ] Add bounded result hashing before transcript truncation; exclude secrets and raw diagnostic payloads from emitted metadata.
- [ ] Add file mutation metadata for successful edit/write/apply-patch calls: path plus before/after content hashes.
- [ ] Feed the detector only after a call has a terminal tool result; never count a streamed `tool-start` as completed progress.
- [ ] Preserve the independent maximum-step limit and do not reset it after successful tools.
- [ ] Run focused repetition and loop tests, including the mocked runner that previously ended `stuck` after 17 requests.
- [ ] Update `src/main/agent/AGENTS.md` and reference page 03.
- [ ] Commit: `fix(agent): detect tool loops from completed progress`.

### Task 4: Make stream recovery bounded and diagnostic

**Files:**
- Modify: `src/main/agent/repetition.ts`
- Modify: `src/main/agent/loop.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Test: `tests/unit/repetition.test.ts`
- Test: `tests/unit/agent-loop.test.ts`
- Test: `tests/unit/chat-panel-events.test.ts` (create if no existing pure event test covers this path)

**Interfaces:**
- Add optional stop detail fields to the done event: `stuckCategory?: 'stream' | 'tool' | 'monitor'`, `stuckTool?: string`, and `recoveryCount?: number`.
- Keep `reason: 'stuck'` unchanged for existing consumers.

- [ ] Add failing tests for conservative reasoning suffix detection and long final-text repetition detection, with normal repeated labels excluded.
- [ ] Add failing tests for exactly two recovery attempts, then a structured `stuck` completion.
- [ ] Generate recovery prompts from the trigger category with bounded error excerpts; treat excerpts as quoted data.
- [ ] Ensure a cancelled stream does not leave orphan tool calls: every announced call either executes and emits a result or is explicitly marked skipped/cancelled.
- [ ] Remove repetitive partial stream text from the next LLM prompt while retaining bounded diagnostic metadata.
- [ ] Render category-specific UI text in `ChatPanel` without breaking the existing generic stuck message fallback.
- [ ] Run focused loop/UI tests and inspect transcript ordering for assistant/tool replay validity.
- [ ] Update `src/main/agent/AGENTS.md`, `src/renderer/src/components/chat/AGENTS.md`, and reference pages 03, 05, and 09.
- [ ] Commit: `fix(agent): bound and explain loop recovery`.

### Task 5: Deduplicate shell monitor registrations

**Files:**
- Modify: `src/main/agent/monitor-store.ts`
- Modify: `src/main/agent/poll-monitor-store.ts`
- Modify: `src/main/agent/tools/monitor.ts`
- Test: `tests/unit/monitor-store.test.ts`
- Test: `tests/unit/poll-monitor-store.test.ts`
- Test: `tests/unit/agent-tools-monitor.test.ts`

**Interfaces:**
- Extend monitor start results to `{ id: string; reused: boolean; pending: boolean }` while accepting existing callers that only read `id`.
- Add an optional `wait?: boolean` field to monitor input; default remains `false`.

- [ ] Add failing tests for duplicate shell registrations, duplicate poll registrations, different conditions, different sessions, and capacity reuse before limit rejection.
- [ ] Normalize condition identity, including explicit `until_exit: false`, effective interval, resolved cwd, and regex text.
- [ ] Preserve the first registration deadline when a duplicate uses a different timeout; report reuse explicitly.
- [ ] Fix command polling so `until_exit: false` disables exit-success matching and omitted condition retains the documented default.
- [ ] Update monitor tool output to state whether a watch was created or reused and whether it is pending.
- [ ] Run focused monitor tests and verify active list counts remain correct after resolve/cancel.
- [ ] Update `src/main/agent/AGENTS.md` and reference page 04.
- [ ] Commit: `fix(agent): deduplicate monitor registrations`.

### Task 6: Implement atomic asynchronous monitor waits

**Files:**
- Modify: `src/main/agent/monitor-store.ts`
- Modify: `src/main/agent/poll-monitor-store.ts`
- Modify: `src/main/agent/tools/monitor.ts`
- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/monitor-store.test.ts`
- Test: `tests/unit/poll-monitor-store.test.ts`
- Test: `tests/unit/meow-agent-manager.test.ts`

**Interfaces:**
- Add an internal `wait(agentId, identity, signal, maxWaitMs): Promise<MonitorWaitResult>` operation shared by concurrent waiters.
- `MonitorWaitResult` must represent `resolved`, `pending`, `timeout`, and `aborted`, include the monitor ID, and settle each waiter once.

- [ ] Add failing tests for immediate resolution, delayed resolution, 60-second wait cap, monitor deadline earlier than cap, timeout without cancellation, abort cleanup, and concurrent waiters.
- [ ] Register listeners before checking buffered output/target state so immediate matches cannot fall through the subscribe gap.
- [ ] Reuse one active watch for concurrent waits and resolve all waiters exactly once.
- [ ] Return a structured pending result when the wait window ends; retain the watch for later waits.
- [ ] Remove abort listeners and timers on every settlement; kill poll child process trees on cancellation/timeout.
- [ ] Prevent `onMonitorResolve` from injecting a second wakeup message when an active waiter consumed the resolution; retain background wakeups when no waiter exists.
- [ ] Verify session ID checks prevent late monitor callbacks from waking another session.
- [ ] Run focused manager and monitor tests.
- [ ] Update `src/main/AGENTS.md`, `src/main/agent/AGENTS.md`, and reference pages 03, 04, and 05.
- [ ] Commit: `feat(agent): await deduplicated monitor conditions`.

### Task 7: Integrate documentation, regression coverage, and release verification

**Files:**
- Modify: `src/main/agent/AGENTS.md`
- Modify: `src/main/AGENTS.md`
- Modify: `src/shared/AGENTS.md`
- Modify: `src/renderer/src/components/chat/AGENTS.md`
- Modify: `docs/reference/03-agent-runtime.md`
- Modify: `docs/reference/04-tool-catalog.md`
- Modify: `docs/reference/05-ipc-contract.md`
- Modify: `docs/reference/09-ui-guide.md` if stop-detail rendering is documented there
- Test: `tests/integration/agent-stream-overlap.test.ts`
- Test: `tests/e2e/prompt.spec.ts` if the visible stuck/monitor behavior is covered by an existing fixture

- [ ] Add an integration scenario combining a streamed response, a CRLF edit, a failed test, a corrected edit, and a monitor wait; assert no false stuck stop and no duplicate wakeup.
- [ ] Add provider-neutral fixtures for Gemini-like incremental text and DeepSeek-like reasoning/tool replay; do not call real APIs.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`; record or fix the baseline bash failures (abort timeout and `.bashrc` stderr) before claiming green.
- [ ] Run `npm run build && npm run e2e` when the renderer or user-visible event contract changed.
- [ ] Inspect `git diff --check` and verify the unrelated existing spec file remains untouched.
- [ ] Commit: `test(agent): cover loop reliability regressions`.

## Execution order

Implement Tasks 1 and 2 first because later loop tests depend on canonical stream and edit behavior. Implement Tasks 3 and 4 next as one bounded recovery layer. Implement Tasks 5 and 6 as the monitor subsystem. Finish with Task 7 and the required verification commands. Do not begin provider-session validation until deterministic tests are green or the remaining failures are explicitly documented.

## Self-review

- Stream loss, CRLF matching, progress-aware guard, bounded recovery, monitor deduplication, monitor waiting, cancellation, session routing, UI diagnostics, and documentation synchronization each have an explicit task.
- No task resets the maximum step budget or promises semantic detection of every paraphrased model loop.
- Existing API compatibility is preserved for `done('stuck')`; monitor result additions are backward-compatible for callers reading `id`.
- All named files, functions, and test commands correspond to the current repository structure.
