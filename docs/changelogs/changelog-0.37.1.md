# Changelog — Meow Coding v0.37.0 → v0.37.1

## 📱 Mobile Remote Control — Coming Soon
- Mobile relay control and pairing features are under active development.
- Stay tuned — mobile companion release coming soon! 🚧

## 🐛 Bug Fixes
- **UI Layout**: Fixed expanded (`full` / `⤢`) mode for Files, Processes, and Subagent overlay panels so they overlay the entire chat pane area as intended, instead of being confined to the docked right-side panel column.

## 🧹 Internal & Docs
- **UI Architecture**: Render expanded overlay panels as direct children of `.main` so their `position: absolute` insets resolve against the pane area rather than `.right-panels-container`.
- **Testing**: Added Playwright E2E test `tests/e2e/right-panels-full.spec.ts` verifying expanded panels cover the pane area and clear docked container space.
- Updated module `AGENTS.md` files and system reference documentation.
- Bumped application version to `v0.37.1`.
