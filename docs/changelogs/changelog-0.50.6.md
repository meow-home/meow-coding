# Changelog — Meow Coding v0.50.5 → v0.50.6

## 🚀 New Features

### Todo list stays current
- The agent now gets nudged when it stops updating the session todo list. If 6 tool calls pass with no `todowrite` while an item is still `in_progress`, the next tool result carries a `[meow]` reminder naming that item and asking to mark it done and start the next one.
- The reminder is capped at 2 per turn and never fires for a list that is empty or entirely completed/cancelled, so it cannot turn into noise.

## 🧹 Internal & Docs
- Added `src/main/agent/todo-nudge.ts` (`todoNudgeDetector`); `SessionRunner` reads the list back through the new `LoopDeps.getTodos` and attaches the note in `finishCall`, so a denied or failed call still counts as a step. Subagents have no `getTodos` and are never nudged.
- Added tests in `tests/unit/agent-todo-nudge.test.ts` and `tests/unit/agent-loop.test.ts`.
- Updated `src/main/agent/AGENTS.md`, `docs/reference/03-agent-runtime.md` and `docs/reference/04-tool-catalog.md`.
