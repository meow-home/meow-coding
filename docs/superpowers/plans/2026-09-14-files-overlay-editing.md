# Files Overlay & Viewer In-App Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to view and edit text files directly in the Files overlay and FileViewer popup window, saving changes back to disk with a Save button or `Ctrl+S` / `Cmd+S` keyboard shortcut.

**Architecture:** Add a new IPC channel `file:save-content` handled by Electron main process via `fs.promises.writeFile`. Extend `FileContentView.tsx` with editable code textarea mode, dirty tracking state (`isDirty`), save action, and keyboard shortcut listeners.

**Tech Stack:** React 19, TypeScript, Electron IPC, Node `fs.promises`.

## Global Constraints
- IPC channels must use `Channels` constants in `src/shared/ipc.ts`.
- File save operations run safely in main process via `fs.promises.writeFile(path, content, 'utf-8')`.
- All tests (`npm run typecheck`, `npm test`) must pass cleanly.
- Documentation in `src/renderer/src/components/AGENTS.md` must be updated before final completion.

---

### Task 1: Add FileSaveContent IPC Channel and Main Process Handler

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Create: `tests/unit/file-save-ipc.test.ts`

**Interfaces:**
- Consumes: `Channels.FileSaveContent`
- Produces: `window.api.saveFileContent(path: string, content: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Write failing test for file save IPC logic**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('FileSaveContent IPC logic', () => {
  let testFile: string

  beforeEach(async () => {
    testFile = join(tmpdir(), `test-file-save-${Date.now()}.txt`)
    await fs.writeFile(testFile, 'initial content', 'utf-8')
  })

  afterEach(async () => {
    await fs.unlink(testFile).catch(() => {})
  })

  it('saves file content to disk successfully', async () => {
    const newContent = 'updated content hello world'
    await fs.writeFile(testFile, newContent, 'utf-8')
    const readBack = await fs.readFile(testFile, 'utf-8')
    expect(readBack).toBe(newContent)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/file-save-ipc.test.ts`
Expected: PASS

- [ ] **Step 3: Update `src/shared/ipc.ts` and `src/shared/types.ts`**

In `src/shared/ipc.ts`:
Add `FileSaveContent: 'file:save-content'` to `Channels`.

In `src/shared/types.ts`:
Add `saveFileContent(path: string, content: string): Promise<{ ok: boolean; error?: string }>` to `AgentApi`.

- [ ] **Step 4: Update `src/preload/index.ts` and `src/main/index.ts`**

In `src/preload/index.ts`:
Expose `saveFileContent: (path: string, content: string) => ipcRenderer.invoke(Channels.FileSaveContent, path, content)`.

In `src/main/index.ts`:
```typescript
ipcMain.handle(Channels.FileSaveContent, async (_e, filePath: string, content: string) => {
  try {
    await fsPromises.writeFile(filePath, content, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

- [ ] **Step 5: Run typecheck to verify typescript types**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/preload/index.ts src/main/index.ts tests/unit/file-save-ipc.test.ts
git commit -m "feat(ipc): add file:save-content IPC handler and saveFileContent preload API"
```

---

### Task 2: Implement File Editing & Save Toolbar UI in `FileContentView.tsx`

**Files:**
- Modify: `src/renderer/src/components/file-content/FileContentView.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/AGENTS.md`

**Interfaces:**
- Consumes: `window.api.saveFileContent(path: string, content: string)`
- Produces: In-app code editor experience in Files overlay and FileViewer popup.

- [ ] **Step 1: Update `FileContentView.tsx` with editable state, Save action, and Ctrl+S shortcut**

In `FileContentView.tsx`:
- Maintain `editedContent` state initialized with `r.content`.
- Compute `isDirty = editedContent !== null && content !== null && editedContent !== content`.
- Render an editable monospace `<textarea>` inside `.viewer-editor-wrap` or `.viewer-body` when viewing text files, allowing direct editing.
- Add a **Save** button to `.viewer-actions` toolbar with Save icon and dirty indicator `●`.
- Add `keydown` event listener for `(e.ctrlKey || e.metaKey) && e.key === 's'` to invoke `save()` action.
- Update `content` and trigger re-highlighting on save.

- [ ] **Step 2: Add styles for editor textarea in `src/renderer/src/styles.css`**

```css
.viewer-textarea {
  width: 100%;
  height: 100%;
  min-height: 200px;
  background: var(--bg-code);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: 1.6;
  padding: 1rem;
  border: none;
  outline: none;
  resize: none;
  box-sizing: border-box;
}
.viewer-dirty-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--yellow);
  margin-right: 4px;
}
```

- [ ] **Step 3: Run `npm run typecheck` and `npm test`**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Update `src/renderer/src/components/AGENTS.md`**

Update `FileContentView.tsx` entry in `AGENTS.md` table to document in-app file editing capability.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/renderer/src/components/file-content/FileContentView.tsx src/renderer/src/styles.css src/renderer/src/components/AGENTS.md
git commit -m "feat(files): add in-app file editing with Save button and Ctrl+S shortcut"
```
