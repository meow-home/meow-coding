# Changelog — Meow Coding v0.50.1 → v0.50.2

## 🐛 Bug Fixes
- Chat: a message sent right after a turn finished could vanish — the composer cleared itself and nothing was sent. Editing a queued message and then having it leave the queue without being sent (removed, or drained into its own turn) left the composer stuck in edit mode for a message that no longer existed, so the next Enter was routed to an edit that could not apply.
- Chat: the composer now leaves edit mode when its queued message is removed or drained, and drops the text that edit had loaded into the field — anything you typed after it is kept.

## 🧹 Internal & Docs
- `ChatPanel.tsx` clears `editTarget` on `queue-updated` when its message is no longer in the queue; `ChatInput.tsx` clears the field when edit mode ends without saving.
- Added two e2e regression tests in `tests/e2e/composer.spec.ts` (remove-while-editing and drain-while-editing); both fail on the previous code.
- Updated `docs/reference/09-ui-guide.md` and the affected `AGENTS.md` files.
