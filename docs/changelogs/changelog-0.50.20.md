# Changelog — Meow Coding v0.50.19 → v0.50.20

## 🚀 New Features

### Chat composer
- The composer is now one rounded card: the auto-growing field on top, and a single bottom bar holding the add menu, the model picker, the reasoning-effort picker and the round send/stop button.
- The line under the card shows the project folder, a git branch chip that opens the Git view, the context ring and the mode picker.

### Queued messages
- Queued messages moved out of the transcript into their own card above the input, with send-now, edit and remove on every row.
- Send-now (or Alt+Enter for the first queued message) starts it immediately: the message is promoted to the head of the queue and the running turn is aborted, instead of waiting for the turn to end.

## 🐛 Bug Fixes
- Chat: the model picker's menu is no longer cut off at the sidebar in a narrow window — it is portaled above the app chrome and clamped to the viewport.

## 🧹 Internal & Docs
- Add `Channels.ChatQueueSendNow` (`chat:queue-send-now`) with `MeowAgentManager.sendQueuedNow`, reusing `stopAndDrain`.
- Rework the composer/queue e2e spec, including a portaled-menu regression case, and sync the chat AGENTS files with `docs/reference/` (UI guide, IPC contract, agent runtime).
