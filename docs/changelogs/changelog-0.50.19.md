# Changelog — Meow Coding v0.50.18 → v0.50.19

## 🚀 New Features

### Files panel
- Resize the file tree: drag the splitter between the tree and the open-file tabs (the tree keeps at least 160px and the editor at least 160px). The width is remembered across restarts, applies to both the docked and the expanded panel, and a double-click on the splitter resets it to the default.

## 🐛 Bug Fixes
- Terminal: the session terminal is now always dark, in the light theme too, and the black strip below the last row is gone.
- Terminal: the terminal font is slightly smaller (12px, was 13px).

## 🧹 Internal & Docs
- Add `--terminal-bg` / `--terminal-fg` tokens (not overridden by the light theme) and paint the xterm viewport with them; drop the terminal's theme observer.
- Add unit coverage for the Files tree splitter.
- Sync `src/renderer/src/components/AGENTS.md` and `docs/reference/09-ui-guide.md`.
