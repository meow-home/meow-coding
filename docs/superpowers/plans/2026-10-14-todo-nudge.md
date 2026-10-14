# Todo Staleness Nudge Implementation Plan

**Goal:** Make the model keep the session todo list current. Today the whole `todowrite` policy
lives in the tool description, which models drift away from over a long turn: they create a list
at the start and then never mark items done.

**Architecture:** The harness already solves this class of problem with inline notes attached to
a tool result (`harness-note.ts`, `loop.ts#toolResultReminder` for the memory dir and git
freshness). The note arrives in the result the model is about to read — at the moment it decides
its next step — instead of in a static prompt it has long since stopped attending to. This plan
adds a third such reminder, driven by a small pure detector:

- `src/main/agent/todo-nudge.ts` — `todoNudgeDetector()` counts tool calls since the last
  `todowrite` and returns a note when the list has been stale for `TODO_NUDGE_AFTER_CALLS`.
- `loop.ts` — `LoopDeps.getTodos` (read-back sink, mirroring `setTodos`), the per-run detector,
  and the note attached in `finishCall`.
- `meow-agent-manager.ts` — wires `getTodos` to the run's fixed session, exactly like `setTodos`.

**Tech Stack:** Electron 41, TypeScript strict, Vitest, React 19 (untouched).

## Global Constraints

- Source code, notes, test names and docs are in **English**.
- Git commits: **do not** add a `Co-Authored-By` trailer.
- No new IPC channel, no renderer change, no new `ChatEvent`.
- Subagents never get `todowrite` and have no `getTodos` sink, so the nudge must be inert for them.
- The note must never turn a successful tool call into an errored one, and must never be persisted
  as a user message (it rides on the tool result, like every other harness note).
- Every code change updates the matching `AGENTS.md` entry and `docs/reference/*` page in the same
  commit. Only touch the entries that changed; keep each file's existing format.
- Single test file: `npx vitest run <path>`.

## Design

### `todo-nudge.ts`

```ts
export const TODO_NUDGE_AFTER_CALLS = 6
export const MAX_TODO_NUDGES = 2

export interface TodoNudgeDetector {
  observe(tool: string, todos: TodoItem[]): string | null
}
```

- `todowrite` resets the counter and returns `null` (the model just did the thing we want).
- Every other call increments it. Below the threshold → `null`.
- At the threshold, pick the first `in_progress` item, else the first `pending` item. A list whose
  items are all `completed`/`cancelled` (or empty) is not stale → `null`, counter keeps running.
- At most `MAX_TODO_NUDGES` notes per run; the counter resets after each note so the next one is
  another full window away.
- The note is built with `harnessNote()` and names the item (whitespace collapsed, truncated).

### `loop.ts`

- `LoopDeps.getTodos?: () => TodoItem[]` — absent for subagents, which is what makes the nudge
  inert there.
- `private todoNudge: TodoNudgeDetector = todoNudgeDetector()`, reset in `runSteps` beside
  `this.toolLoop`.
- In `finishCall`, after the tool-loop note: `attachNote(call, note)` when
  `this.deps.getTodos` is set and the detector returns one. `finishCall` is the right seam — it
  sees every call (allowed, denied, errored), which is what "tool calls since the last update"
  should count.

## Review Focus

1. **A denied or failed call still counts as a step.** The model took a step; the list is still
   stale. Covered by the detector test on a non-`todowrite` tool name and by the loop test.
2. **No sink → no nudge.** A subagent runner has no `getTodos`; the loop must not call the
   detector at all. Task 3.
3. **`todowrite` resets the window even when it changes nothing.** Otherwise a model that updates
   the list is punished with a note on the very next call.
4. **The note rides on the tool result, not the transcript.** Asserted in the loop test by reading
   the stored tool item, and by asserting no user message carries the text.

## Task 1: Detector module

- [x] `src/main/agent/todo-nudge.ts`: constants, `todoNudgeDetector()`, note builder.
- [x] `tests/unit/agent-todo-nudge.test.ts`: threshold, reset on `todowrite`, `in_progress` before
      `pending`, all-terminal list, empty list, cap, long content truncated.

## Task 2: Loop wiring

- [x] `LoopDeps.getTodos?` + doc comment.
- [x] `todoNudge` field + reset in `runSteps`.
- [x] `finishCall` attaches the note.
- [x] `tests/unit/agent-loop.test.ts`: nudge after 6 calls with a stale list; no nudge without
      `getTodos`; no nudge once the list is all completed.

## Task 3: Manager wiring

- [x] `meow-agent-manager.ts`: `getTodos: () => this.deps.store.todos(this.runSessionId(agent.id))`
      next to `setTodos`.

## Task 4: Docs

- [x] `src/main/agent/AGENTS.md`: `todo-nudge.ts` row; `loop.ts` row mentions the third reminder.
- [x] `docs/reference/03-agent-runtime.md`: `LoopDeps` table row for `getTodos`.
- [x] `docs/reference/04-tool-catalog.md`: `todowrite` section — the staleness nudge.

## Task 5: Verify

- [x] `npm run typecheck`
- [x] `npm test`
