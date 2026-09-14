# Design Spec: CodeMirror Syntax-Highlighted Editor for FileContentView

**Date:** 2026-09-14
**Status:** Approved

## Problem
Currently, `FileContentView` renders code using Shiki syntax highlighting in a static read-only `<div>`. Editing a file requires toggling to "Edit Source", which opens an unhighlighted, plain `<textarea>`. Users want a seamless, VS Code-like experience where code is syntax-highlighted while editing directly.

## Solution
Integrate `@uiw/react-codemirror` (CodeMirror 6 for React) as the default code editor inside `FileContentView`.

## Key Features
1. **Live Syntax Highlighting during Editing**: Text files and code files display syntax highlighting directly inside the active editor view.
2. **Language Extension Resolution**: Map file extension (`ts`, `js`, `json`, `html`, `css`, `md`, `py`, `rs`, etc.) to CodeMirror language extensions (`@codemirror/lang-javascript`, `@codemirror/lang-json`, etc.). Fallback to plain text for unknown extensions.
3. **Dark Theme Integration**: Styled to match Meow dark theme colors (background `#18181b`, text `#e4e4e7`, active line `#27272a`).
4. **Editor Features**:
   - Line numbers
   - Syntax highlighting while editing
   - Active line highlight
   - Tab indent (2 spaces)
   - Built-in search (`Ctrl+F`)
   - `Ctrl+S` / `Cmd+S` keyboard shortcut to save
5. **Markdown Handling**:
   - Retains the "Markdown Preview" / "Edit Source" toggle button for `.md` files.
   - When in Edit Source mode for `.md`, CodeMirror renders with Markdown syntax highlighting.

## Components & Dependencies
- Package dependencies:
  - `@uiw/react-codemirror`
  - `@codemirror/theme-one-dark` (or custom theme)
  - `@codemirror/lang-javascript`
  - `@codemirror/lang-json`
  - `@codemirror/lang-html`
  - `@codemirror/lang-css`
  - `@codemirror/lang-markdown`
  - `@codemirror/lang-python`
  - `@codemirror/lang-xml`
- `src/renderer/src/components/file-content/FileContentView.tsx`: Replaces raw `textarea` and static `viewer-code` div with `<CodeMirror>`.
- `src/renderer/src/styles.css`: CSS adjustments for CodeMirror height (`100%`) and styling.

## Verification
- `npm run typecheck`
- `npm test`
