# Changelog — Meow Coding v0.50.15 → v0.50.17

## 🚀 New Features

### Session terminals
- Each session gets its own terminals: open the Terminal panel from the pane header button or `Ctrl+\`` (`Cmd+\`` on macOS) and run shells in the session's folder — Git Bash on Windows (PowerShell fallback), `$SHELL` elsewhere, overridable with `terminal.shell` / `terminal.args` in `meow.json`.
- The Terminal panel uses the Files panel look and joins the right-hand panel grid next to Files, Processes and Subagent panels; it can also expand over the whole pane area.
- Up to 8 terminal tabs per session, with status dot and exit code, double-click rename, Restart on an exited tab, and a tab context menu (Rename, Restart, Close, Close others).
- Terminals keep running while you switch sessions, and their scrollback is saved: after an app restart the tabs come back exited with their output, ready to Restart.
- Right-click a terminal to Copy, Paste, Clear, or send the selection or the last 100 lines to the chat composer as a fenced block (not sent automatically).

## 🐛 Bug Fixes
- Terminal: context menus now use the shared menu surface instead of rendering without a background.
- Terminal: the last row (the shell prompt) is no longer clipped at the bottom of the terminal.

## 🧹 Internal & Docs
- Add `TerminalManager` with its own `PtyManager`, a scrollback ring buffer with batched output, `TerminalStore` persistence under `userData/terminals/`, and the `terminal:*` IPC channels; terminal process trees are killed on tab close, session delete and app quit.
- Add `BaseDropdown` `anchorPoint` support for cursor-anchored context menus.
- Add unit, integration and e2e coverage for session terminals.
- Fix the terminal integration tests on Linux CI: shell-output checks now strip control sequences (bash bracketed paste) before matching a line. v0.50.16 was tagged but never published because of this, so v0.50.17 ships its changes.
- Add the IDE-replacement gap analysis, the Phase A spec and the session terminals plan; sync `AGENTS.md` and `docs/reference/`.
