# Design Spec: Files Overlay & Viewer In-App File Editing

## Summary
Add in-app file editing capability to the Files overlay (`FileContentView`) and `FileViewer` popup window, allowing users to view, edit text files directly, and save changes using a Save button or `Ctrl+S` / `Cmd+S` keyboard shortcut.

## Motivation
Currently, viewing files in the Files overlay or FileViewer only allows reading syntax-highlighted code, copying text, or opening the file in an external editor like VS Code. Users often want to make quick file edits directly within the app without switching context to external editors.

## Proposed Design

### 1. IPC Contract & Main Process
- **IPC Channel**: Add `Channels.FileSaveContent = 'file:save-content'` in `src/shared/ipc.ts`.
- **Preload API**: Add `saveFileContent(path: string, content: string): Promise<{ ok: boolean; error?: string }>` to `AgentApi` in `src/preload/index.ts`.
- **Main Handler**: Handle `Channels.FileSaveContent` in `src/main/index.ts` using `fs.promises.writeFile(path, content, 'utf-8')`.

### 2. UI Component (`FileContentView.tsx`)
- Manage state for `content` (original file content) and `editedContent` (current buffer).
- Track `isDirty = editedContent !== content` and `isSaving`.
- Display a code editor textarea styled with app monospace font (`--font-mono`), line height, background, and color matching the app theme.
- Add a **Save** button to `.viewer-actions` toolbar:
  - Enabled when `isDirty` is true or during saving.
  - Displays saving spinner / checkmark / unsaved dot indicator (`●`).
  - Triggers `window.api.saveFileContent(filePath, editedContent)`.
- Support `Ctrl+S` / `Cmd+S` global shortcut inside the file viewer pane.
- Update syntax highlight buffer on save.

### 3. Edge Cases & Constraints
- Binary / Image files (`isImage = true`): Editing disabled.
- File write errors: Surface inline error message banner if write fails (e.g. permission denied).

## Verification
- Unit test for IPC handler in main process test suite.
- Type check: `npm run typecheck`.
- Tests: `npm test`.
