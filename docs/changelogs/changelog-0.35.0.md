# Changelog — Meow Coding v0.34.0 → v0.35.0

## 🚀 New Features

### Infinite-scroll chat transcript
- Scrolling towards the top of the feed automatically pages in older transcript windows, replacing the manual "Load earlier" button.
- The viewport stays anchored while older items load (no jump), with a "Loading earlier messages…" indicator during each page fetch.
- Light mode: slash/mention text on the blue user bubble now uses a brighter gold (#ffd700) so it stays readable instead of blending into the background.

## 📱 Mobile Remote Control — Coming Soon
- Work continues on the WS relay, pairing code, and chat sync so a phone can drive a desktop session.
- Stay tuned — the mobile companion is still in the oven 🚧

## 🐛 Bug Fixes
- Dialogs: confirm prompts (delete agent tab, delete agent / close terminal) now dim the **entire app** instead of just the chat/pane area.
- Dialogs: removed the lingering entrance-animation transform that trapped `position: fixed` backdrops; `ConfirmDialog` now renders through a portal to `document.body`.

## 🧹 Internal & Docs
- Refactored `ConfirmDialog` to portal to `document.body`; added a design spec and implementation plan for full-app overlay dialogs, and updated AGENTS.md.
- Added the infinite-scroll transcript design/plan docs alongside the auto-load implementation.
- Bumped version to 0.35.0.
