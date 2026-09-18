# Changelog — Meow Coding v0.38.0 → v0.39.0

## 🚀 New Features

### Delegated Tasks Are Now Visible in the Target Session
- **See what was delegated**: When a session hands work to another session with `delegate_session`, the target session's chat now shows the delegated task as a user bubble at the moment the turn starts. Previously the prompt was already in the transcript but never appeared in the pane until it was remounted, so the target looked idle while it was actually working.
- **Distinguishable from your own input**: The bubble carries a `delegation` badge and a `From session: <name>` label, and is tinted with the accent color, so a delegated task is never confused with something you typed.
- **Survives reload**: The source label is stored with the message, so re-opening the session — or restarting the app — reproduces the same labelled bubble from the transcript.
- **No duplicates**: The bubble is emitted only when the store actually writes the message, so restart recovery redelivering the same delegation never produces a second bubble.

## 📱 Mobile Remote Control — Coming Soon
- Relay server and pairing workflow under development. Stay tuned — mobile companion release coming soon! 🚧

## 🐛 Bug Fixes
- **Delegation**: A delegated turn no longer suppresses its own `user-message` event in the target session, so the task is visible in the pane the moment the turn begins instead of only after the pane remounts. The result wake on the source session is unchanged.

## 🧹 Internal & Docs
- Added `docs/superpowers/specs/2026-09-18-delegation-incoming-bubble-design.md` and the matching implementation plan; the renderer reuses the existing `user-message` event and the already-persisted `ChatMessage.delegation` field, so no IPC channel or `src/shared/` contract change was needed.
- Updated `src/main/AGENTS.md`, `src/renderer/src/components/chat/AGENTS.md` and `docs/reference/09-ui-guide.md` to describe the delegated bubble, its label and its reload behavior.
- Corrected the auto-naming note: a delegated task still does not drive the `onUserMessage` sidebar auto-name hook, but the store's first-message session-title derivation is unaffected.
- Bumped application version to `v0.39.0`.
