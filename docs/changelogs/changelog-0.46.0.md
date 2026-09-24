# Changelog — Meow Coding v0.45.0 → v0.46.0

## 🚀 New Features

### Unlimited step budget by default
- Sessions and subagents no longer stop at a fixed step count (was 100 / 30); runaway loops are still caught by the response guard and the tool-loop detector (`stuck`).
- A positive **Max steps per turn** in Settings → Context stays available as an opt-in cap; clearing the field now really means unlimited.
- A one-time startup migration turns the old default caps saved in `meow.json` into unlimited; custom values are kept.

### External delegation: clearer task outcomes
- The CLI prints the task and session ids as soon as a task is submitted, so an interrupted wait still leaves them.
- New `meow-delegate wait <taskId>` resumes waiting on an existing task without queueing the work again.
- Tasks report why a turn ended early: `completed (max steps reached)` exits `5` (send "continue"), and `completed (stuck)` / `(length)` / `(refusal)` exit `6` (review and send feedback).
- The Claude skill now requires background runs, explains exits `5` and `6`, and recovers interrupted waits with `wait`. Click **Install Claude skill** again to pick it up.

## 🐛 Bug Fixes
- Agent: a turn that hit the step cap and answered with text only was reported as `complete`; it now reports `max-steps`.
- Delegation: a turn cut short with no assistant text (e.g. `stuck`) was reported as `cancelled`; it now completes with its end reason.

## 🧹 Internal & Docs
- `AgentTurnResult`, delegation records and `TaskDto` carry `endReason` (`max-steps` / `stuck` / `length` / `refusal`).
- Updated agent-runtime, storage and integrations reference pages and the affected `AGENTS.md` files.
