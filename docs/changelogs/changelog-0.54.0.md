# Changelog — Meow Coding v0.53.0 → v0.54.0

## 🚀 New Features

### Run commands straight from the chat
- A fenced block tagged as a shell (`bash`, `powershell`, `cmd`, …) in an assistant message now renders as a command box with **Run in terminal** and **Copy command** on its right.
- Run opens this session's terminal panel and types the whole block there — the tab you have selected when it is alive, otherwise a new one — while Copy puts it on the clipboard and flashes a check.
- `console`/`terminal` blocks stay plain code, since they mix a prompt with its output; question prompts, sub-agent output and the file viewer are unchanged.

### Git panel
- The Git viewer popup is gone. Git is a read-only right-hand panel like Files: a **Changes** tab with flat `Staged` / `Changes` lists and an inline diff per file, and a **History** tab with a filter, a flat commit list, and inline commit detail plus per-file diffs.
- The branch chip and the status bar pill show the push state: `↑N` unpushed, `↓N` behind, and a cloud-off icon when the branch has no upstream (the tooltip names it).
- History marks every commit the upstream does not have with a yellow circled up-arrow.
- The panel keeps itself live: a commit made by the agent or in a terminal, or a new untracked file, shows up on its own without pressing Refresh, and an unchanged poll never collapses an open diff or commit.
- The chat footer's branch button now opens this panel instead of a blank window.

### Tasks panel
- Background sessions, background shells, polled commands and delegations share one right-hand **Tasks** panel: grouped `Active` / `Finished`, one line per row, expanding in place to its facts, content (last messages, live output, result) and actions (Open session, Stop, Kill process, Dismiss).
- It replaces the Processes tab strip, the Monitors pane and the bottom background strip.

### Background tasks card
- The chat feed shows a **Background tasks** card while anything is being watched: one row per task with its kind, target, elapsed time (or the reason it resolved), plus stop and dismiss actions.
- Clicking a row opens the Tasks panel on that task.
- Watches refresh on push from the backend instead of the UI polling.

### Built-in browser
- File paths and `file:` URLs open in the built-in browser, with a loading indicator while the page loads.

## 🐛 Bug Fixes
- Chat: every opened tool-cluster row now uses one type size, so tool and thought rows no longer alternate between larger and smaller lines (and no longer differ in height).
- Git: working-tree and staged deletions are reported as deleted instead of modified.

## 🧹 Internal & Docs
- New `monitors:changed` push plus `monitorsCancel` IPC; the background tasks card and the Tasks panel read the same store.
- `backgroundProcsList` rows carry `cwd` and `startedAt` so the Tasks panel can show elapsed time.
- Removed `GitViewer`, the blame/branch/compare surface and its main-process window, `ProcessesOverlay`, `MonitorsPane` and the background strip.
- New specs: `tests/e2e/git-panel.spec.ts`, `tests/e2e/chat-command-box.spec.ts`; unit coverage for command-box detection, the terminal run hand-off and the unpushed-commit flags.
- Reference docs (§9 UI guide, §10 build/test, tool catalog, data and storage) and the module `AGENTS.md` files updated alongside.
