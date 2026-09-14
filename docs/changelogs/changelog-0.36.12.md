# Changelog - v0.36.12

## 🚀 New Features

### CodeMirror Syntax-Highlighted Editor
- **VS Code-like Code Editor**: Replaced static code viewer and plain textareas in `FileContentView` with `@uiw/react-codemirror` for live syntax highlighting while editing text and code files directly.
- **Multi-Language Support**: Automatic language extension resolution for JavaScript, TypeScript, JSON, HTML, CSS, Markdown, Python, and XML files.
- **Save & Shortcuts**: Added `Ctrl+S` / `Cmd+S` keyboard shortcuts and reactive `Save` toolbar button with `● Unsaved` dirty indicator and IPC disk saving handler (`file:save-content`).

### Git Viewer UI Redesign
- **Resizable Sidebars**: Added drag-to-resize handles for History, Changes, and Blame sidebars in the Git viewer.
- **Flat Header Styling**: Redesigned popup title bar styling to a clean, flat single-color background and relocated the branch switcher next to header actions.

## 🧹 Maintenance & Docs

- Updated `AGENTS.md` and added design specs & implementation plans.
- Bumped application version to `v0.36.12`.
