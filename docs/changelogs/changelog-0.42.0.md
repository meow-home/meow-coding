# Changelog — Meow Coding v0.41.0 → v0.42.0

## 🚀 New Features

### Tool-call cluster groups in the chat feed
- Consecutive tool calls now render inside a single collapsible "Ran N commands" cluster instead of being scattered with the default feed gap, so a long run of steps reads as one tight group.
- Every tool call is wrapped in a cluster — even a single one gets the same "Ran 1 command" chrome.
- Steps inside a cluster stay collapsed by default, even while running (the cluster header already shows progress); a `pending → done` transition re-keys each step so it closes even if the user clicked it open during the run.
- On reload, the cluster grouping survives the empty assistant messages the agent persists between tool batches — otherwise-consecutive tools no longer get split into 1-tool clusters.

## 🐛 Bug Fixes
- **Chat**: tool-call clusters are preserved after a chat feed reload — empty assistant messages between tool batches no longer break the group.

## 🧹 Internal & Docs
- Added a design spec for external delegation from Claude to Meow (`docs/superpowers/specs/2026-09-24-external-delegation-design.md`).
- Updated the chat-component and UI-guide reference pages with the new cluster rules.
