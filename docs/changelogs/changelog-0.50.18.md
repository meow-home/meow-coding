# Changelog — Meow Coding v0.50.17 → v0.50.18

## 🐛 Bug Fixes
- Agent: a turn no longer ends with the todo list left open. When the model writes its final answer while items are still `pending`/`in_progress`, it gets one more step (once per turn) to mark them completed or cancelled, keep working, or leave them open if it is waiting on you.
- Agent: long turns now get up to 4 reminders (was 2) to update a stale todo list.

## 🧹 Internal & Docs
- Add `todoEndOfTurnNote` / `openTodos` to `todo-nudge.ts` and the `blockedByOpenTodos` end-of-turn gate in the agent loop, with unit coverage.
- Sync `src/main/agent/AGENTS.md` and `docs/reference/` (agent runtime, tool catalog).
