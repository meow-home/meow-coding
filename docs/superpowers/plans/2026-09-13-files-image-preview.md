# Files Panel Image Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Files panel display raster images in a tab (fitted to the frame) instead of failing with
"Binary file cannot be previewed directly", with an "Open with OS app" escape hatch when an image is too large.

**Architecture:** The renderer cannot read the filesystem, so a new `files:image` channel returns a `data:` URL
built in the main process (`readImageDataUrl`). The shared `FileContentView` picks its branch from the file
extension, using a new pure `src/shared/image.ts` module so main and renderer agree on what an image is. A second
channel, `files:open-system`, opens a file with the OS application and is rejected unless the path is inside a
registered workspace.

**Tech Stack:** TypeScript (strict), React 19, Electron 41, Vitest, plain CSS in `src/renderer/src/styles.css`.

Spec: `docs/superpowers/specs/2026-09-13-files-image-preview-design.md`.

## HOW TO EXECUTE (read this once, then follow the steps literally)

- Every step is mechanical. **Do not redesign, do not rename, do not "improve" anything.** Copy the code
  exactly as given.
- Steps are marked `WRITE` (create/replace a whole file), `PATCH` (replace the exact quoted old text with the
  exact quoted new text) or `RUN` (a command whose expected output is stated).
- If a `RUN` command does not produce the expected result, stop and report; do not improvise a fix.
- Do not reorder the tasks. Task 2 uses code from Task 1; Task 3 uses code from Tasks 1-2; Task 4 and Task 5
  use the IPC methods added in Task 3.
- After each task's final `RUN`, commit with the exact command given, then move to the next task.
- Never add a `Co-Authored-By` trailer to a commit.

## Global Constraints

- Source code, comments and UI labels are **English**.
- IPC channel strings are never hardcoded — only `Channels` from `src/shared/ipc.ts`.
- `src/shared` must not import Node or Electron modules. The renderer must not import `node:path`.
- Only the main process touches the filesystem.
- Do not add comments beyond the ones shown in the code below.
- Do not touch `readFileContent`, `FileContentResult`, `MAX_VIEWER_BYTES`, `isTextPath`, `BINARY_EXTENSIONS`,
  `dir-lister.ts`, the Files tree, or the `FileOpen` (`file:open`) handler. The chat-message path must keep
  opening images with the OS application exactly as it does today.
- The working tree must be clean before starting, and each commit must stage only the files its own step
  lists — never `git add -A`.
- Baseline before starting: `npm run typecheck` clean, working tree clean, and
  `npm test` = **108 files / 1198 tests passing**. After the plan: **109 files / 1213 tests passing**.

---

### Task 1: Shared image module

**Files:**
- Create: `src/shared/image.ts`
- Test: `tests/unit/image.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IMAGE_EXTENSIONS: string[]`, `imageMimeType(ext: string): string | null`.

- [ ] **Step 1: WRITE `tests/unit/image.test.ts` with exactly this content**

```ts
import { describe, expect, it } from 'vitest'
import { IMAGE_EXTENSIONS, imageMimeType } from '../../src/shared/image'

describe('imageMimeType', () => {
  it('maps raster extensions to data-URL MIME types', () => {
    expect(imageMimeType('png')).toBe('image/png')
    expect(imageMimeType('gif')).toBe('image/gif')
    expect(imageMimeType('webp')).toBe('image/webp')
    expect(imageMimeType('bmp')).toBe('image/bmp')
    expect(imageMimeType('avif')).toBe('image/avif')
  })
  it('maps jpg and jpeg to image/jpeg', () => {
    expect(imageMimeType('jpg')).toBe('image/jpeg')
    expect(imageMimeType('jpeg')).toBe('image/jpeg')
  })
  it('maps ico to image/x-icon', () => {
    expect(imageMimeType('ico')).toBe('image/x-icon')
  })
  it('is case-insensitive', () => {
    expect(imageMimeType('PNG')).toBe('image/png')
  })
  it('returns null for non-image extensions', () => {
    for (const e of ['svg', 'ts', 'tsx', 'pdf', 'md', 'txt', '']) {
      expect(imageMimeType(e)).toBeNull()
    }
  })
})

describe('IMAGE_EXTENSIONS', () => {
  it('lists exactly the raster formats the viewer supports', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])
  })
  it('excludes svg, which stays a text file', () => {
    expect(IMAGE_EXTENSIONS).not.toContain('svg')
  })
})
```

- [ ] **Step 2: RUN the test and verify it fails**

Run: `npx vitest run tests/unit/image.test.ts`
Expected: FAIL — Vite cannot resolve the import: `Failed to resolve import "../../src/shared/image"`.

- [ ] **Step 3: WRITE `src/shared/image.ts` with exactly this content**

```ts
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']

const MIME_OVERRIDES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon'
}

/** data-URL MIME for an image extension, or null when it is not an image. */
export function imageMimeType(ext: string): string | null {
  const e = ext.toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(e)) return null
  return MIME_OVERRIDES[e] ?? `image/${e}`
}
```

- [ ] **Step 4: RUN the test and verify it passes**

Run: `npx vitest run tests/unit/image.test.ts`
Expected: PASS — **1 file, 7 tests passing**.

- [ ] **Step 5: Commit**

```bash
git add src/shared/image.ts tests/unit/image.test.ts
git commit -m "feat(files): add the shared image extension and MIME helpers"
```

---

### Task 2: Main-process image reader

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/file-viewer.ts`
- Test: `tests/unit/file-viewer.test.ts` (APPEND to the end; the existing import block is also patched)

**Interfaces:**
- Consumes: `imageMimeType` from `src/shared/image.ts` (Task 1).
- Produces: `interface ImageContentResult { path: string; ext: string; mime: string; dataUrl: string; sizeBytes: number }`,
  `MAX_IMAGE_BYTES: number`, `isImagePath(filePath: string): boolean`,
  `readImageDataUrl(absPath: string): Promise<ImageContentResult>`.

- [ ] **Step 1: Write the failing tests — PATCH the import block of `tests/unit/file-viewer.test.ts`**

Old text:

```ts
import {
  extOf, isTextPath, looksLikeBinaryContent, TEXT_EXTENSIONS
} from '../../src/main/file-viewer'
```

New text:

```ts
import {
  extOf, isImagePath, isTextPath, looksLikeBinaryContent, MAX_IMAGE_BYTES, readImageDataUrl, TEXT_EXTENSIONS
} from '../../src/main/file-viewer'
```

- [ ] **Step 2: Also PATCH the first line of `tests/unit/file-viewer.test.ts`**

Old text:

```ts
import { describe, expect, it, vi } from 'vitest'
```

New text:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
```

- [ ] **Step 3: APPEND these tests to the end of `tests/unit/file-viewer.test.ts`**

```ts
describe('isImagePath', () => {
  it('returns true for the raster formats the viewer shows', () => {
    for (const p of ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.ico', 'h.avif', 'I.PNG']) {
      expect(isImagePath(p)).toBe(true)
    }
  })
  it('returns false for text, binary and extension-less paths', () => {
    for (const p of ['a.svg', 'a.ts', 'a.pdf', 'a.md', 'Dockerfile', 'a.']) {
      expect(isImagePath(p)).toBe(false)
    }
  })
  it('takes precedence over the text/binary split', () => {
    expect(isTextPath('logo.png')).toBe(false)
    expect(isImagePath('logo.png')).toBe(true)
  })
})

describe('readImageDataUrl', () => {
  it('returns a data URL that decodes back to the original bytes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const file = path.join(dir, 'pixel.png')
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
      writeFileSync(file, bytes)
      const r = await readImageDataUrl(file)
      expect(r.path).toBe(file)
      expect(r.ext).toBe('png')
      expect(r.mime).toBe('image/png')
      expect(r.sizeBytes).toBe(bytes.length)
      expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      const b64 = r.dataUrl.slice('data:image/png;base64,'.length)
      expect(Buffer.compare(Buffer.from(b64, 'base64'), bytes)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('uses image/jpeg for jpg and image/x-icon for ico', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const jpg = path.join(dir, 'photo.jpg')
      const ico = path.join(dir, 'favicon.ico')
      writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff]))
      writeFileSync(ico, Buffer.from([0x00, 0x00, 0x01]))
      expect((await readImageDataUrl(jpg)).mime).toBe('image/jpeg')
      expect((await readImageDataUrl(ico)).mime).toBe('image/x-icon')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects a missing file', async () => {
    await expect(readImageDataUrl(path.join(tmpdir(), 'meow-missing-image-xyz.png')))
      .rejects.toThrow('File not found:')
  })
  it('rejects a file above the 10MB cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const big = path.join(dir, 'big.png')
      writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1))
      await expect(readImageDataUrl(big)).rejects.toThrow('Image is too large:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects a path that is not an image', async () => {
    await expect(readImageDataUrl(path.join(tmpdir(), 'notes.txt'))).rejects.toThrow('Not an image file')
  })
})
```

- [ ] **Step 4: RUN the tests and verify they fail**

Run: `npx vitest run tests/unit/file-viewer.test.ts`
Expected: FAIL — the new tests report `isImagePath is not a function` (vitest rewrites a missing named export
to `undefined`, so only the 8 new tests fail; the 11 pre-existing tests still pass).

- [ ] **Step 5: PATCH `src/shared/types.ts` — add the result type after `FileContentResult`**

Old text:

```ts
export interface FileContentResult {
  path: string
  ext: string
  content: string
}
```

New text:

```ts
export interface FileContentResult {
  path: string
  ext: string
  content: string
}

export interface ImageContentResult {
  path: string
  ext: string
  mime: string
  dataUrl: string
  sizeBytes: number
}
```

- [ ] **Step 6: PATCH the type import of `src/main/file-viewer.ts`**

Old text:

```ts
import type { FileContentResult, FileViewerPayload } from '../shared/types'
```

New text:

```ts
import { imageMimeType } from '../shared/image'
import type { FileContentResult, FileViewerPayload, ImageContentResult } from '../shared/types'
```

- [ ] **Step 7: PATCH `src/main/file-viewer.ts` — add the size cap next to `MAX_VIEWER_BYTES`**

Old text:

```ts
export const MAX_VIEWER_BYTES = 5 * 1024 * 1024
```

New text:

```ts
export const MAX_VIEWER_BYTES = 5 * 1024 * 1024

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
```

- [ ] **Step 8: PATCH `src/main/file-viewer.ts` — add `isImagePath` after `isTextPath`**

Old text:

```ts
export function isTextPath(filePath: string): boolean | null {
  const ext = extOf(filePath)
  if (ext === '') return true // Dockerfile, Makefile, LICENSE...
  if (TEXT_EXTENSIONS.includes(ext)) return true
  if (BINARY_EXTENSIONS.includes(ext)) return false
  return null
}
```

New text:

```ts
export function isTextPath(filePath: string): boolean | null {
  const ext = extOf(filePath)
  if (ext === '') return true // Dockerfile, Makefile, LICENSE...
  if (TEXT_EXTENSIONS.includes(ext)) return true
  if (BINARY_EXTENSIONS.includes(ext)) return false
  return null
}

export function isImagePath(filePath: string): boolean {
  return imageMimeType(extOf(filePath)) !== null
}
```

- [ ] **Step 9: PATCH `src/main/file-viewer.ts` — add `readImageDataUrl` after `readFileContent`**

Old text:

```ts
  return { path: absPath, ext: extOf(absPath), content }
}

/** Open non-text files with the OS default app. */
```

New text:

```ts
  return { path: absPath, ext: extOf(absPath), content }
}

export async function readImageDataUrl(absPath: string): Promise<ImageContentResult> {
  const ext = extOf(absPath)
  const mime = imageMimeType(ext)
  if (!mime) throw new Error('Not an image file')
  let st
  try {
    st = await stat(absPath)
  } catch {
    throw new Error(`File not found: ${absPath}`)
  }
  if (st.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large to preview directly (max 10MB)')
  }
  const buf = await readFile(absPath)
  return {
    path: absPath,
    ext,
    mime,
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    sizeBytes: st.size
  }
}

/** Open non-text files with the OS default app. */
```

- [ ] **Step 10: RUN the tests and verify they pass**

Run: `npx vitest run tests/unit/file-viewer.test.ts`
Expected: PASS — **1 file, 19 tests passing** (11 pre-existing + 8 new).

- [ ] **Step 11: RUN the typecheck**

Run: `npm run typecheck`
Expected: exit code 0, no output after the last `tsc` line.

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/main/file-viewer.ts tests/unit/file-viewer.test.ts
git commit -m "feat(files): read images as data URLs in the main process"
```

---

### Task 3: IPC plumbing for images and the OS-app escape hatch

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `readImageDataUrl` (Task 2), `ImageContentResult` (Task 2), `isPathInside` and `openWithSystemApp` (already exist in the repo).
- Produces: `Channels.FilesImage` (`'files:image'`), `Channels.FilesOpenSystem` (`'files:open-system'`),
  `AgentApi.getFileImage(path: string): Promise<ImageContentResult>`,
  `AgentApi.openFileWithSystem(path: string): Promise<void>`.

**How this task proves itself:** Vitest does not typecheck, and no `tsconfig` includes `tests/`, so the contract
test is a **runtime** check (`typeof api[key] === 'function'`). The **static** check is `npm run typecheck`:
`src/preload/index.ts` declares `const api: AgentApi`, and `tsconfig.node.json` includes `src/preload`, so
typecheck fails the moment `AgentApi` grows a method that preload does not implement. Follow the step order
below exactly — reversing it produces a green test with no implementation.

- [ ] **Step 1: PATCH `tests/unit/ipc-contract.test.ts` — add the two methods to the required list**

Old text:

```ts
      'filesListDir', 'filesSearch',
```

New text:

```ts
      'filesListDir', 'filesSearch',
      'getFileImage', 'openFileWithSystem',
```

- [ ] **Step 2: RUN the contract test and verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — the loop reports `expected 'undefined' to be 'function'` for the key `getFileImage`.

- [ ] **Step 3: PATCH `src/shared/ipc.ts` — the type import line**

Old text:

```ts
  ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload,
```

New text:

```ts
  ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload, ImageContentResult,
```

- [ ] **Step 4: PATCH `src/shared/ipc.ts` — add the two channels**

Old text:

```ts
  FilesListDir: 'files:list-dir',
  FilesSearch: 'files:search',
```

New text:

```ts
  FilesListDir: 'files:list-dir',
  FilesSearch: 'files:search',
  FilesImage: 'files:image',
  FilesOpenSystem: 'files:open-system',
```

- [ ] **Step 5: PATCH `src/shared/ipc.ts` — add the two `AgentApi` methods**

Old text:

```ts
  filesListDir(projectPath: string, absPath: string): Promise<DirEntry[]>
  filesSearch(projectPath: string, query: string): Promise<ProjectSearchHit[]>
```

New text:

```ts
  filesListDir(projectPath: string, absPath: string): Promise<DirEntry[]>
  filesSearch(projectPath: string, query: string): Promise<ProjectSearchHit[]>
  getFileImage(path: string): Promise<ImageContentResult>
  openFileWithSystem(path: string): Promise<void>
```

- [ ] **Step 6: RUN the typecheck and verify it fails**

Run: `npm run typecheck`
Expected: FAIL in the node project — `Property 'getFileImage' is missing in type ... but required in type 'AgentApi'`
(and the same for `openFileWithSystem`) on `const api: AgentApi` in `src/preload/index.ts`.

- [ ] **Step 7: PATCH the `file-viewer` import of `src/main/index.ts`**

Old text:

```ts
import { isTextPath, openFileViewer, openWithSystemApp, readFileContent } from './file-viewer'
```

New text:

```ts
import { isTextPath, openFileViewer, openWithSystemApp, readFileContent, readImageDataUrl } from './file-viewer'
```

- [ ] **Step 8: PATCH `MainApp` in `src/main/index.ts` — add `openFileWithSystem` after `filesSearch`**

Old text:

```ts
  // The overlay searches as the user types, so an incomplete pattern ("foo(")
  // must yield no hits rather than an error the UI has to render.
  async filesSearch(projectPath: string, query: string): Promise<ProjectSearchHit[]> {
    if (!query.trim() || !this.workspaces.get(projectPath)) return []
    try {
      return await searchProject(projectPath, query)
    } catch {
      return []
    }
  }
```

New text:

```ts
  // The overlay searches as the user types, so an incomplete pattern ("foo(")
  // must yield no hits rather than an error the UI has to render.
  async filesSearch(projectPath: string, query: string): Promise<ProjectSearchHit[]> {
    if (!query.trim() || !this.workspaces.get(projectPath)) return []
    try {
      return await searchProject(projectPath, query)
    } catch {
      return []
    }
  }

  // Spawning the OS default app is only allowed for files inside a registered
  // project — the renderer must not be able to launch arbitrary paths.
  openFileWithSystem(absPath: string): Promise<void> {
    const allowed = this.workspaces.list().some(w => isPathInside(w.projectPath, absPath))
    if (!allowed) throw new Error('Not a project path')
    return openWithSystemApp(absPath)
  }
```

- [ ] **Step 9: PATCH `registerIpcHandlers` in `src/main/index.ts` — add the two handlers**

Old text:

```ts
  ipcMain.handle(Channels.FilesSearch, (_e, projectPath: string, query: string) =>
    mainApp.filesSearch(projectPath, query))
```

New text:

```ts
  ipcMain.handle(Channels.FilesSearch, (_e, projectPath: string, query: string) =>
    mainApp.filesSearch(projectPath, query))
  ipcMain.handle(Channels.FilesImage, (_e, absPath: string) => readImageDataUrl(absPath))
  ipcMain.handle(Channels.FilesOpenSystem, (_e, absPath: string) => mainApp.openFileWithSystem(absPath))
```

- [ ] **Step 10: PATCH `src/preload/index.ts` — add the two invokers**

Old text:

```ts
  filesSearch: (projectPath: string, query: string) =>
    ipcRenderer.invoke(Channels.FilesSearch, projectPath, query),
```

New text:

```ts
  filesSearch: (projectPath: string, query: string) =>
    ipcRenderer.invoke(Channels.FilesSearch, projectPath, query),
  getFileImage: (path: string) =>
    ipcRenderer.invoke(Channels.FilesImage, path),
  openFileWithSystem: (path: string) =>
    ipcRenderer.invoke(Channels.FilesOpenSystem, path),
```

- [ ] **Step 11: RUN the typecheck and verify it passes**

Run: `npm run typecheck`
Expected: exit code 0 — all four projects (node, web, extension, server) clean.

- [ ] **Step 12: PATCH `tests/unit/ipc-contract.test.ts` — add the two stubs to the `AgentApi` object literal**

Old text:

```ts
      filesListDir: async () => [],
      filesSearch: async () => [],
```

New text:

```ts
      filesListDir: async () => [],
      filesSearch: async () => [],
      getFileImage: async () => ({ path: '', ext: '', mime: '', dataUrl: '', sizeBytes: 0 }),
      openFileWithSystem: async () => {},
```

- [ ] **Step 13: RUN the contract test and verify it passes**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS — **1 file, 6 tests passing** (the same 6 as before; this task adds no test).

- [ ] **Step 14: RUN the full test suite**

Run: `npm test`
Expected: PASS — **109 files, 1213 tests passing**, 0 failures.

- [ ] **Step 15: Commit**

```bash
git add src/shared/ipc.ts src/main/index.ts src/preload/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(files): add the image and open-with-OS IPC channels"
```


### Task 4: Render images in the shared file content view

**Files:**
- Modify (WRITE — whole file): `src/renderer/src/components/file-content/FileContentView.tsx`

**Interfaces:**
- Consumes: `imageMimeType` (Task 1), `window.api.getFileImage` and `window.api.openFileWithSystem` (Task 3).
- Produces: an image branch inside `FileContentView`; no new exports.

**Note on testing:** the repository has no jsdom/React Testing Library, so this component has no unit test.
The branch decision itself is the already-tested `imageMimeType`, and this task's verification is the
typecheck plus the full pre-existing suite (proving the shared text path did not regress).

- [ ] **Step 1: WRITE `src/renderer/src/components/file-content/FileContentView.tsx` with exactly this content**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { imageMimeType } from '@shared/image'
import MarkdownText from '../chat/MarkdownText'
import { isHighlightable, preloadLanguage, highlightCode } from '../chat/highlight'
import { baseName } from '../files/file-path'

interface Props {
  path: string
  root: string
}

// Toolbar + body of the file viewer, shared by the popup FileViewer window and
// the Files overlay tab. The host supplies the flex container.
export default function FileContentView({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isImage = imageMimeType(ext) !== null
  const isMarkdown = !isImage && (ext === 'md' || ext === 'markdown')
  const code = !isImage && isHighlightable(ext)

  useEffect(() => {
    if (isImage) {
      let alive = true
      // Images are returned as data URLs by main; the renderer never reads the
      // file itself.
      window.api.getFileImage(filePath)
        .then(r => { if (alive) setImage(r.dataUrl) })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
      return () => { alive = false }
    }
    let alive = true
    // Warm the highlighter + grammar while the content is read over IPC, so
    // the first highlight is near-instant and plain text never flashes.
    const prep = code ? preloadLanguage(ext) : Promise.resolve()
    window.api.getFileContent(filePath)
      .then(async r => {
        let html: string | null = null
        if (code) {
          try {
            await prep
            html = await highlightCode(r.content, ext)
          } catch {
            html = null // highlight failure → fall back to plain text
          }
        }
        if (!alive) return
        setContent(r.content)
        setRaw(false)
        setHighlighted(html)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath, ext, code, isImage])

  const copy = useCallback(async () => {
    if (content) await navigator.clipboard.writeText(content)
  }, [content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <>
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Markdown' : 'Raw'}
            </button>
          )}
          {code && !isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Highlighted' : 'Raw'}
            </button>
          )}
          <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          {!isImage && (
            <button className="btn small" onClick={() => void copy()} disabled={!content}>Copy</button>
          )}
        </div>
      </div>
      {/* Full-bleed for highlighted code (VS Code look), fitted for images, padded for everything else. */}
      <div className={`viewer-body${isImage ? ' viewer-body--image' : code && !raw && highlighted ? ' viewer-body--flush' : ''}`}>
        {isImage ? (
          error ? (
            <div className="viewer-image-error">
              <span>{error}</span>
              <button className="btn small" onClick={() => void window.api.openFileWithSystem(filePath)}>
                Open with OS app
              </button>
            </div>
          ) : image === null ? (
            <div className="viewer-loading">Loading…</div>
          ) : (
            <img className="viewer-image" src={image} alt={baseName(filePath)} />
          )
        ) : error ? (
          <div className="viewer-error">{error}</div>
        ) : content === null ? (
          <div className="viewer-loading">Loading…</div>
        ) : isMarkdown && !raw ? (
          <div className="viewer-md"><MarkdownText text={content} onOpenFile={openLinkedFile} /></div>
        ) : code && !raw && highlighted ? (
          <div className="viewer-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="viewer-pre">{content}</pre>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: RUN the typecheck**

Run: `npm run typecheck`
Expected: exit code 0. (The renderer resolves `@shared/image` through the `@shared/*` path alias already
configured in `tsconfig.web.json` and `electron.vite.config.ts`.)

- [ ] **Step 3: RUN the full test suite and verify the shared text path did not regress**

Run: `npm test`
Expected: PASS — **109 files, 1213 tests passing**, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/file-content/FileContentView.tsx
git commit -m "feat(files): show images in the shared file content view"
```

---

### Task 5: Image styles

**Files:**
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: the class names emitted by Task 4 (`viewer-body--image`, `viewer-image`, `viewer-image-error`).
- Produces: CSS only.

- [ ] **Step 1: PATCH `src/renderer/src/styles.css` — add the image styles after `.viewer-loading`**

Old text:

```css
.viewer-error { color: var(--red); padding: 0.666667rem 0; }
.viewer-loading { opacity: 0.6; }
```

New text:

```css
.viewer-error { color: var(--red); padding: 0.666667rem 0; }
.viewer-loading { opacity: 0.6; }
/* Image tab: the picture is fitted to the body (no scrolling), centered, over a
   checkerboard so transparent PNGs read clearly in both themes. */
.viewer-body--image {
  display: flex; align-items: center; justify-content: center;
  background-color: var(--bg-chat);
  background-image:
    linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%),
    linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%);
  background-size: 1rem 1rem;
  background-position: 0 0, 0.5rem 0.5rem;
}
.viewer-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 0; }
.viewer-image-error {
  display: flex; flex-direction: column; align-items: center; gap: 0.666667rem;
  color: var(--red); text-align: center;
}
```

- [ ] **Step 2: RUN the full test suite**

Run: `npm test`
Expected: PASS — **109 files, 1213 tests passing**, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "style(files): fit, center and back the image tab"
```

---

### Task 6: Documentation sync and final verification

**Files:**
- Modify: `docs/reference/05-ipc-contract.md`
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `README.md`
- Modify: `src/shared/AGENTS.md`
- Modify: `src/main/AGENTS.md`
- Modify: `src/renderer/src/components/AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5. This task adds no code.

- [ ] **Step 1: PATCH the channel table of `docs/reference/05-ipc-contract.md`**

Old text:

```md
| `FilesSearch` | `files:search` | `filesSearch(projectPath, query): ProjectSearchHit[]` — content search for the Files overlay; returns `[]` for an empty query, an unknown project or an invalid pattern |
```

New text:

```md
| `FilesSearch` | `files:search` | `filesSearch(projectPath, query): ProjectSearchHit[]` — content search for the Files overlay; returns `[]` for an empty query, an unknown project or an invalid pattern |
| `FilesImage` | `files:image` | `getFileImage(path): ImageContentResult` — image bytes as a `data:` URL for the Files panel tab; rejects a non-image path, a missing file or one above the 10MB cap |
| `FilesOpenSystem` | `files:open-system` | `openFileWithSystem(path)` — opens a file with the OS default app; **rejects paths outside a registered project** |
```

- [ ] **Step 2: PATCH the Files panel paragraph of `docs/reference/09-ui-guide.md` — add the image sentence**

Old text:

```md
tree by name; a `?` prefix searches file contents instead and lists `path:line` hits. Docked, the panel is
```

New text:

```md
tree by name; a `?` prefix searches file contents instead and lists `path:line` hits. Raster images (`png`,
`jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif`) open as the picture itself, fitted to the tab over a
checkerboard; above 10MB the tab shows the error and an **Open with OS app** button instead. `svg` stays a
highlighted text file. Docked, the panel is
```

- [ ] **Step 3: PATCH the component table of `docs/reference/09-ui-guide.md`**

Old text:

```md
| `file-content/FileContentView.tsx` | Toolbar (Raw/Highlighted toggle, Open in VS Code, Copy) + body of a file (Shiki-highlighted code, rendered markdown, or plain `<pre>`), shared by the popup window and the Files overlay tab |
```

New text:

```md
| `file-content/FileContentView.tsx` | Toolbar (Raw/Highlighted toggle, Open in VS Code, Copy) + body of a file (Shiki-highlighted code, rendered markdown, plain `<pre>`, or a fitted image over a checkerboard), shared by the popup window and the Files overlay tab |
```

- [ ] **Step 4: PATCH `README.md` — the Files panel bullet**

Old text:

```md
- **Open-file tabs** — clicking a file in the tree or a search hit opens a tab beside the tree with
  its content: Shiki-highlighted code, rendered markdown, or plain text, plus Raw/Highlighted, Copy
  and Open in VS Code. `⤢` expands the panel over the whole pane area and restore docks it again —
```

New text:

```md
- **Open-file tabs** — clicking a file in the tree or a search hit opens a tab beside the tree with
  its content: Shiki-highlighted code, rendered markdown, plain text, or a raster image fitted to the
  tab (above 10MB the tab offers **Open with OS app** instead), plus Raw/Highlighted, Copy
  and Open in VS Code. `⤢` expands the panel over the whole pane area and restore docks it again —
```

- [ ] **Step 5: PATCH `src/shared/AGENTS.md`**

Old text:

```md
- `text.ts` — pure text helpers (append stream delta, ...).
```

New text:

```md
- `text.ts` — pure text helpers (append stream delta, ...).
- `image.ts` — pure image helpers (`IMAGE_EXTENSIONS`, `imageMimeType`) shared by main (`readImageDataUrl`)
  and the renderer (`FileContentView`), so both agree on which extensions are images and which MIME type a
  `data:` URL uses.
```

- [ ] **Step 6: PATCH `src/main/AGENTS.md`**

Old text:

```md
- `file-watcher.ts` — recursively watches the project, filters text files, batches changes (debounce 500ms).
```

New text:

```md
- `file-watcher.ts` — recursively watches the project, filters text files, batches changes (debounce 500ms).
- `file-viewer.ts` — text/binary classification (`isTextPath`, extensions), `readFileContent` (5MB cap) and
  `readImageDataUrl` (raster image → `data:` URL, 10MB cap) behind `files:image`; `openWithSystemApp` backs
  `files:open-system`, which rejects a path outside a registered project.
```

- [ ] **Step 7: PATCH `src/renderer/src/components/AGENTS.md`**

Old text:

```md
| `file-content/FileContentView.tsx` | Toolbar + body of a file (Shiki-highlighted code, rendered markdown or plain `<pre>`, Raw toggle, Copy, Open in VS Code), shared by the popup `FileViewer` window and the overlay tab. |
```

New text:

```md
| `file-content/FileContentView.tsx` | Toolbar + body of a file (Shiki-highlighted code, rendered markdown, plain `<pre>`, or a raster image fitted over a checkerboard with an "Open with OS app" fallback, Raw toggle, Copy, Open in VS Code), shared by the popup `FileViewer` window and the overlay tab. |
```

- [ ] **Step 8: RUN the typecheck and the full test suite**

Run: `npm run typecheck && npm test`
Expected: exit code 0, then **109 files, 1213 tests passing**, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add docs/reference/05-ipc-contract.md docs/reference/09-ui-guide.md README.md src/shared/AGENTS.md src/main/AGENTS.md src/renderer/src/components/AGENTS.md
git commit -m "docs: describe image preview in the Files panel"
```

---

## Manual verification (human only — an agent cannot drive the Electron GUI)

The executor must stop here and report. Ask the user to run `npm run dev` and check:

1. Open a session, `⋮` → **Files**, click a `.png` under `media/` or `resources/` — the picture appears fitted
   to the tab, centered, on a checkerboard, with only **Open in VS Code** in the toolbar.
2. Open a text file in another tab — it still highlights/markdown-renders exactly as before, with Copy.
3. Switch between the image tab and the text tab repeatedly — no blank image, no lost content.
4. Click a `.pdf` in the tree — the OS application opens it (unchanged).
5. If any file above 10MB exists, click it — the tab shows the error text and an **Open with OS app** button
   that opens the file.
6. Paste/click an image path in a chat message → still opens with the OS application (unchanged).

## Self-Review Notes

- **Spec coverage:** shared helper (Task 1) · main reader with the 10MB cap and `Not an image file` guard
  (Task 2) · both IPC channels across all four layers (Task 3) · the shared content view's image branch with a
  reduced toolbar (Task 4) · fitted/centered/checkerboard styling plus the error block (Task 5) · every doc the
  sync rule requires (Task 6) · the unit, contract and manual verification the spec asks for.
- **Deliberate asymmetry:** `files:image` does not validate the path against workspaces (it mirrors the
  existing `files:open-system` sibling `file-viewer:get-content`), while `files:open-system` does, because
  spawning the OS default app on an arbitrary path is a real escalation. This matches the spec and the
  existing `FileViewerGetContent` precedent.
- **Type consistency:** `ImageContentResult` is defined once (Task 2) and referenced by `readImageDataUrl`
  (Task 2), `AgentApi.getFileImage` (Task 3) and the stub in the contract test (Task 3). `imageMimeType` is
  defined in Task 1 and consumed in Tasks 2 and 4. Class names emitted in Task 4
  (`viewer-body--image`, `viewer-image`, `viewer-image-error`) are exactly the ones styled in Task 5.
- **Known limitation (accepted in the spec):** a file literally named `.png` (a dotfile) renders an error with
  the OS-app button, because main's `extOf` returns an empty extension for dotfiles while the renderer's
  `split('.')` heuristic sees `png`. It never shows a broken `<img>`.
