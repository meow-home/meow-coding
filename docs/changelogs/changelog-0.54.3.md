# Changelog — Meow Coding v0.54.2 → v0.54.3

## 🚀 New Features

### Right-hand panels are remembered per project folder
- Files, Git, Tasks, Terminal, Browser and the Sub-agents panel now keep their open/closed state **per project**, instead of one global state that leaked from one folder to the next. Switching to a session in another folder shows *that* folder's panes, and coming back restores the ones you left open.
- The session-scoped panes remember the session they were opened for, and a remembered session is dropped once it no longer exists (deleted or removed with its project). The expanded (`full`) state stays global and resets on a project switch, so one folder's maximized panel never covers another folder's.
- Sub-agent tabs belong to the project whose session spawned them: only the active project's tabs render, and closing them affects that project only.
- The sidebar project menu's **Git** item now activates the project before showing the panel, since a panel only renders for the active project.

## 🐛 Bug Fixes
- Files: leaving a project no longer closes its Files panel behind your back — the panel stays pinned to that project while unsaved edits wait on the discard prompt, and answering "keep" returns you to it.

## 🧹 Internal & Docs
- `App` keeps the panel state in `panelsByPath` (`{ files, git, tasks, terminal, browser, subagentsHidden }`); the old per-panel `set*OpenFor` state and the "browser panel is off-project" occlusion reason are gone.
- `tests/e2e/panels-per-project.spec.ts` covers Files and Git across two folders (independent state, round trip, closing one folder leaving the other open); the stale URL-validation and project-switch occlusion expectations in `browser-panel.spec.ts` were fixed.
- Reference docs (`docs/reference/09-ui-guide.md`) and `AGENTS.md` files updated for the per-project panel state.
