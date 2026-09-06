# Changelog — Meow Coding v0.33.0 → v0.34.0

## 🚀 New Features

### Keep-alive workspaces — instant project switching
- Loaded projects stay mounted in the background (hidden via CSS), so switching back to a project renders its chat feed instantly — no reload flash, no standing feed.
- Agents in hidden projects keep streaming into their feed while you work elsewhere; the transcript is already up to date when you switch back.
- A lightweight `workspace:activate` IPC repoints the active project + git/file pollers without re-registering agents or re-running workspace preparation.

### Paged chat transcript — fast cold open on long sessions
- Cold-opening a long session now renders only the latest 50 items (a tail window) instead of the whole transcript, so the feed appears quickly.
- A "Load earlier" button at the top of the feed pages in older items on demand, keeping the viewport anchored.

### Keep-alive memory bound (LRU eviction)
- At most 5 projects stay mounted; the least-recently-used project is evicted when the limit is exceeded.
- A project whose agent is mid-turn is never evicted — eviction waits until the turn ends.

## 📱 Mobile Remote Control — Coming Soon
- Work continues on the WS relay, pairing code, and chat sync so a phone can drive a desktop session.
- Stay tuned — the mobile companion is still in the oven 🚧

## 🐛 Bug Fixes
- Chat: contained chat pane render errors so a pane crash no longer freezes the whole window black.
- Agent: broke degenerate thinking loops before they burn the output budget.
- Chat: restored the chat panel's flex height under the keep-alive wrapper — the input no longer scrolls out of view with a long feed or hugs the tab bar when the feed is empty.

## 🧹 Internal & Docs
- Added `SessionStore.transcriptWindow` (paged tail read) with unit tests; `listChatTranscript` now returns `{ items, hasMore }`.
- Added the `workspace:activate` channel to the IPC contract (main, preload, renderer, contract test in sync).
- Added the keep-alive design spec, implementation plan, and updated `src/shared/AGENTS.md` with the new contract.
- Bumped version to 0.34.0.
