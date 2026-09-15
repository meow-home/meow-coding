# Changelog — Meow Coding v0.36.16 → v0.36.17

## 🚀 New Features

### Project Drag and Drop Reordering
- **Manual Project Reordering**: Added support for dragging and dropping project items in the sidebar to custom reorder them in both expanded (`project-list`) and collapsed (`project-rail`) views.
- **Persistent Position**: Saved project order to `userData/workspaces.json` via new `workspace:reorder` IPC channel and backend `WorkspaceStore.reorder` method.
- **Default Bottom Positioning**: Newly added projects continue to default to the bottom of the workspace list.

## 🐛 Bug Fixes
- **Chat**: Fixed an issue where downward auto-scrolling could get stuck in chat sessions.

## 🧹 Internal & Docs
- Added design spec (`docs/superpowers/specs/2026-09-15-project-drag-and-drop-reorder-design.md`) and implementation plan (`docs/superpowers/plans/2026-09-15-project-drag-and-drop-reorder.md`).
- Added unit test for `WorkspaceStore.reorder` and updated IPC contract tests.
- Bumped application version to `v0.36.17`.
