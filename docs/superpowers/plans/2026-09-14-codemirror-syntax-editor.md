# CodeMirror Syntax-Highlighted Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `@uiw/react-codemirror` into `FileContentView.tsx` to provide a VS Code-like syntax-highlighted code editor for viewing and editing files.

**Architecture:** Replace static HTML code containers and plain textareas in `FileContentView.tsx` with `<CodeMirror>` editor instances configured with dynamic language support and dark theme styling matching Meow UI.

**Tech Stack:** React 19, TypeScript, `@uiw/react-codemirror`, `@codemirror/theme-one-dark`, `@codemirror/lang-*`.

## Global Constraints

- Must work in React 19 and Electron renderer environment.
- Preserve existing file read/save IPC API (`getFileContent`, `saveFileContent`).
- Support keyboard shortcut `Ctrl+S`/`Cmd+S` for saving directly from the editor.
- Retain Markdown preview toggle for `.md` files.

---

### Task 1: Install CodeMirror dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@uiw/react-codemirror` and `@codemirror/lang-*` packages**

Run: `npm install @uiw/react-codemirror @codemirror/theme-one-dark @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-html @codemirror/lang-css @codemirror/lang-markdown @codemirror/lang-python`

- [ ] **Step 2: Verify `package.json` was updated**

Read `package.json` to verify dependencies.

- [ ] **Step 3: Commit package updates**

```bash
git add package.json package-lock.json
git commit -m "deps: add @uiw/react-codemirror and language extensions"
```

---

### Task 2: Integrate CodeMirror into `FileContentView.tsx`

**Files:**
- Modify: `src/renderer/src/components/file-content/FileContentView.tsx`

**Interfaces:**
- Dynamic extension selector helper `getLanguageExtension(ext: string)` returning CodeMirror `Extension[]`.

- [ ] **Step 1: Import CodeMirror and language extensions in `FileContentView.tsx`**

```tsx
import CodeMirror, { Extension } from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
```

- [ ] **Step 2: Add `getLanguageExtension` helper**

```tsx
function getLanguageExtension(ext: string): Extension[] {
  switch (ext.toLowerCase()) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'html':
    case 'htm':
      return [html()]
    case 'css':
      return [css()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'py':
      return [python()]
    default:
      return []
  }
}
```

- [ ] **Step 3: Update `FileContentView` render body to use `<CodeMirror>`**

Replace static code viewer and textareas with `<CodeMirror value={editedContent ?? ''} theme={oneDark} extensions={extensions} onChange={(value) => setEditedContent(value)} />`. Bind keymap for save (`Ctrl-s`, `Cmd-s`).

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/components/file-content/FileContentView.tsx
git commit -m "feat: replace raw textarea with CodeMirror syntax editor in FileContentView"
```

---

### Task 3: Adjust CSS layout for CodeMirror

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Add container styling for `.cm-editor` inside `.viewer-body`**

```css
.viewer-body .cm-editor {
  height: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
}
.viewer-body .cm-scroller {
  overflow: auto;
}
```

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`

- [ ] **Step 3: Commit CSS updates**

```bash
git add src/renderer/src/styles.css
git commit -m "style: configure CodeMirror full-height editor layout in viewer-body"
```

---

### Task 4: Documentation & AGENTS.md update

**Files:**
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update AGENTS.md with CodeMirror editor component info**

Update `src/renderer/src/components/AGENTS.md` to document CodeMirror integration in `FileContentView.tsx`.

- [ ] **Step 2: Commit AGENTS.md**

```bash
git add src/renderer/src/components/AGENTS.md
git commit -m "docs: update AGENTS.md for CodeMirror editor integration"
```
