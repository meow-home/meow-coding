# Changelog — Meow Coding v0.36.15 → v0.36.16

## 🚀 New Features

### Subagent Docked Overlay Pane
- **Side-by-Side Docked Overlay**: Converted the sub-agent detail popup from a centered modal (`BaseModal`) into a docked side-by-side overlay pane (`SubagentOverlay`), matching the UX and behavior of `FilesOverlay` and `ProcessesOverlay`.
- **Resizable Width & Persistence**: Added a left resizer handle allowing dragging between 320px and 900px, persisting preferred width in `localStorage` (`meow.subagent.width`).
- **Maximize & Keyboard Controls**: Supports full mode toggle (expanding over chat while preserving window chrome) and `Escape` key shortcut to close the pane.

## 🧹 Internal & Docs
- Added design spec (`docs/superpowers/specs/2026-09-15-subagent-overlay-design.md`) and implementation plan (`docs/superpowers/plans/2026-09-15-subagent-overlay.md`).
- Added unit tests for subagent overlay CSS rules in `tests/unit/subagent-overlay-styles.test.ts`.
- Bumped application version to `v0.36.16`.
