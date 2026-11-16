# Changelog — Meow Coding v0.54.4 → v0.54.5

## 🚀 New Features

### Right-hand panels are remembered per session
- Tasks, Terminal, Browser and the Sub-agents panel now keep their open/closed state **per session** instead of per project folder: each session shows the panes you left open for it, and switching sessions — in the same folder or another one — brings that session's panes back instead of the previous session's.
- The session-scoped panes only render for the session that is actually showing, and a remembered session is ignored once it no longer exists. Files and Git stay per project folder.
- The expanded (`full`) state stays global and resets on a project switch, so one session's maximized panel never covers another one.

## 🐛 Bug Fixes
- UI: the sidebar session status dot now sits at the end of the row, right before the session menu, so session names and the sub-session glyph line up without the old indent offset.

## 🧹 Internal & Docs
- `App` splits the panel state into `panelsByPath` (`files`, `git`) and `sessionPanelsMap` (per agent id: `tasks`, `terminal`, `browser`, `subagentsHidden`); the panel openers (`updateSessionPanels`) replace the old per-panel setters.
- Added a unit test for a delegated sub-session turn returning its final text.
- Reference docs (`docs/reference/09-ui-guide.md`) and `src/renderer/AGENTS.md` updated for the per-session panel state.
