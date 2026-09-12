# Changelog — Meow Coding v0.36.0 → v0.36.1

## 🚀 New Features

### Sessions in Sidebar & UI Refinements
- **Sidebar Sessions**: Projects now expand to list parallel sessions with per-session status, inline rename, deletion, and creation.
- **Single-Agent Model**: Simplified session management — each project operates on native Meow sessions without terminal/tab noise.
- **Composer & Chat Redesign**: Streamlined chat composer into a single-row design with inline send/stop buttons, attachment menu, and context readout icon button.
- **UI Aesthetics & Themes**: Unified dropdown metrics, theme-aware surfaces, matching background colors for sidebar header, right panel (Explorer & Artifacts), select pickers, and context popovers.

## 📱 Mobile Remote Control — Coming Soon
- Control sessions and stream live responses remotely via WebSocket relay and pairing code.
- Stay tuned — mobile remote control is around the corner! 🚧

## 🐛 Bug Fixes
- UI: Right-aligned session row action menus to button edges and prevented menu clipping on scroll.
- UI: Fixed model picker row flex alignment so the selection tick aligns correctly on the right.
- Chat: Held turn anchor until layout settles, preventing auto-paging jumps during session load.
- Main: Hardened session-model boot migration and guarded last-session removal at a single choke point.

## 🧹 Internal & Docs
- Refactored in-app terminal and CLI agent legacy components out of the codebase.
- Added comprehensive E2E Playwright test coverage for sidebar sessions, composer send/stop flows, and pane header trims.
- Bumped version to 0.36.1.
