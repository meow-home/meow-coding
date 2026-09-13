# Files Panel Image Preview — Design Spec

Date: 2026-09-13
Status: Pending spec review (user approved the design sections)

## Overview

Let the Files panel (and the popup file viewer it shares a component with) display images instead of
failing with "Binary file cannot be previewed directly". Clicking a raster image in the tree opens a
tab that shows the picture fitted to the tab, with the existing toolbar reduced to the actions that
still make sense for an image.

## Problem Statement

`FileContentView` (shared by the Files panel tab and the popup `FileViewer` window) always calls
`window.api.getFileContent(path)` → `readFileContent()` in `src/main/file-viewer.ts`. That function
decodes the buffer as UTF-8 and throws on a NUL byte, so every image ends in the error branch:

> Binary file cannot be previewed directly — it will be opened with the OS application

The tree, however, *lists* images (the Files panel deliberately lists everything), so today clicking
`logo.png` in the tree produces an error message rather than the picture. Images are also in
`BINARY_EXTENSIONS`, which is what routes `FileOpen` (a path from a chat message) to
`openWithSystemApp` — that behaviour is correct and must not change.

Constraints discovered while exploring:

- **The renderer cannot read files.** `contextIsolation: true`, no `node:*` in `src/renderer`, so the
  bytes must cross IPC.
- **CSP is `img-src 'self' data:`** (`src/renderer/index.html`), so a `data:` URL needs no CSP change.
- **Precedent exists**: `ImageAttachment.dataUrl` already ships base64 images over IPC, and
  `.chat-lightbox` / `.chat-image-thumb` already provide image styling.
- **FileContentView is shared**, so the text path must keep working byte-for-byte.

## Decisions (from the brainstorming session)

| Question | Decision |
|---|---|
| Interaction level | **Fit to frame only.** No click-to-zoom, no lightbox, no zoom/pan, no thumbnails in the tree |
| Formats | **Raster only**: `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif`. `svg` stays a text/code file (highlighted) |
| Size cap | **10MB**, above which the tab shows an error plus a "Open with OS app" button |
| Transport | **Approach A**: a dedicated IPC channel returning a `data:` URL (base64) |
| OS-app escape hatch | **3A**: add a validated `files:open-system` channel rather than reusing the folder-reveal action |

Rejected alternatives: a `meow-file://` custom protocol (streams from disk and handles huge images,
but needs a CSP change, a new privileged scheme registered before `app.whenReady`, path validation
from scratch, and dev/prod differences — too many moving parts for "show a picture"), and widening
`FileContentResult` into a `text | image` union (would change a contract that also backs the
unknown-extension text/binary probe and its tests).

## Proposed Changes

### 1. `src/shared/image.ts` (new, pure — no Node/Electron imports)

Both processes need to know what an image is, but the renderer cannot import from `src/main/`
(that module imports `electron`, and only `@shared` is aliased into the renderer bundle). So the
knowledge lives in a shared module, following the existing `src/shared/text.ts` /
`src/shared/log-helpers.ts` pattern:

```ts
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']

/** data-URL MIME for an image extension, or null when it is not an image. */
export function imageMimeType(ext: string): string | null
```

`jpg`/`jpeg` → `image/jpeg`, `ico` → `image/x-icon`, otherwise `image/<ext>`; unknown extension →
`null`. This is the single source of truth — no second list anywhere, including tests.

### 2. `src/main/file-viewer.ts`

Add alongside the existing `TEXT_EXTENSIONS` / `BINARY_EXTENSIONS` (importing the shared module):

```ts
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function isImagePath(filePath: string): boolean
export async function readImageDataUrl(absPath: string): Promise<ImageContentResult>
```

`isImagePath` = `imageMimeType(extOf(filePath)) !== null`, so it agrees with the renderer's check by
construction.

`readImageDataUrl` mirrors `readFileContent`:

1. `!isImagePath(absPath)` throws `Not an image file` — main validates, it does not trust the
   renderer's extension heuristic.
2. `stat` — failure throws `` `File not found: ${absPath}` `` (same wording as the text path).
3. `st.size > MAX_IMAGE_BYTES` throws `Image is too large to preview (max 10MB)`.
4. `readFile` → `data:${mime};base64,${buf.toString('base64')}`.
5. Returns `{ path, ext, mime, dataUrl, sizeBytes }`.

`readFileContent`, `FileContentResult`, `openWithSystemApp` and `MAX_VIEWER_BYTES` are untouched.

### 3. `src/shared/types.ts`

Add next to `FileContentResult`:

```ts
export interface ImageContentResult {
  path: string
  ext: string
  mime: string
  dataUrl: string
  sizeBytes: number
}
```

### 4. IPC contract (all four layers, no hardcoded channel strings)

| Channel | Name | API |
|---|---|---|
| `Channels.FilesImage` | `files:image` | `getFileImage(path: string): Promise<ImageContentResult>` |
| `Channels.FilesOpenSystem` | `files:open-system` | `openFileWithSystem(path: string): Promise<void>` |

- `src/shared/ipc.ts` — both members in `Channels`, both methods on `AgentApi`.
- `src/main/index.ts` — `MainApp.filesImage(absPath)` delegates to `readImageDataUrl`; the
  `files:open-system` handler validates before spawning:
  `openWithSystemApp` is only reachable for a path inside one of the registered workspaces
  (`isPathInside`, reusing `src/main/dir-lister.ts`, exactly like `filesListDir`), otherwise it
  throws `Not a project path`. This keeps the new channel from becoming "spawn any file on disk".
- `src/preload/index.ts` — `getFileImage`, `openFileWithSystem` invokers.

### 5. `src/renderer/src/components/file-content/FileContentView.tsx`

- `const mime = imageMimeType(ext)` (from `@shared/image`) — the component already derives `ext`
  from `filePath`, so it knows the file is an image without an extra round trip. The existing
  derive-by-split heuristic differs from main's `extOf` only for extension-less and dot files
  (`Makefile` → `makefile`, `.png` → `png`), where main now answers `Not an image file` rather than
  returning bytes for a non-image — an error message, never a broken image.
- Image branch: `window.api.getFileImage(filePath)` → `setImage(dataUrl)`.
- Its toolbar shows **only Open in VS Code**: Raw/Highlighted and Copy are meaningless for an image,
  and "Reveal in Folder" is *not* part of `FileContentView`'s toolbar today (it belongs to the
  overlay's `⋮` menu and the tree's context menu), so none is added here.
- Body: `<img className="viewer-image" src={dataUrl} alt={baseName(filePath)} />`, reusing
  `baseName` from `components/files/file-path.ts` (the renderer must not import `node:path`).
- The text `useEffect` — including `preloadLanguage` / `highlightCode` — must not run for images.

### 6. `src/renderer/src/styles.css`

- `.viewer-image` — fitted: `max-width: 100%`, `max-height: 100%`, `object-fit: contain`, centered
  in the existing `.viewer-body`, over a subtle checkerboard so transparent PNGs read clearly.
- `.viewer-image-error` — the error block (message + the OS-app action), styled like the existing
  `.viewer-error` but with room for a button.

### Decision table: what a path opens as

| Case | Result | Notes |
|---|---|---|
| `ext ∈ IMAGE_EXTENSIONS` | Image tab (10MB cap) | **Image-first**: `.png` takes this branch even though it is also in `BINARY_EXTENSIONS` |
| `ext ∈ TEXT_EXTENSIONS` | Text tab (5MB cap) | Includes `svg` — unchanged |
| Other `ext ∈ BINARY_EXTENSIONS` | OS application | `FileOpen` path unchanged |
| No extension | Text | Unchanged |
| Unknown extension | Probe `readFileContent`; text, else OS app | Unchanged |

Image files are **not** filtered or re-iconed in the tree, and `dir-lister.ts` is not touched.

### Out of scope (YAGNI)

Zoom/pan, click-to-enlarge lightbox, image thumbnails in the tree, SVG rendered as a picture, rotate,
lazy loading for very large images, and making images linked in chat messages open in-app (chat keeps
opening them with the OS application).

## Verification & Testing

### Unit tests — `tests/unit/image.test.ts` (new, shared helper)

- `imageMimeType` returns `image/png`, `image/jpeg` (for both `jpg` and `jpeg`), `image/x-icon` for
  `ico`, and `null` for `svg`, `ts`, `pdf`, `''`.

### Unit tests — `tests/unit/file-viewer.test.ts`

- `isImagePath` is `true` for all eight extensions (including uppercase `A.PNG`) and `false` for
  `svg`, `ts`, `pdf`, `md`, `Dockerfile`, `a.`.
- `isImagePath` is asserted **image-first**: a `.png` takes the image branch even though
  `isTextPath('.png')` is `false` — the ordering is part of the contract.
- `readImageDataUrl` on a real temporary PNG: `dataUrl` matches `/^data:image\/png;base64,/`, `mime`
  is `image/png`, `sizeBytes` equals the byte length, and the base64 decodes back to the original
  bytes (proves no corruption).
- Missing file rejects with `File not found:`; a file above 10MB (created with `Buffer.alloc`)
  rejects with `Image is too large:`; a `.txt` path rejects with `Not an image file`.

### IPC contract test — `tests/unit/ipc-contract.test.ts`

Add `getFileImage` and `openFileWithSystem` to the `required` key list and the stub `AgentApi`
object. This test is the safety net for the exact failure seen on 2026-09-13
(`window.api.filesListDir is not a function`).

### Not covered

No Playwright e2e: the repository has no e2e for the Files panel, and this would need a binary
fixture plus GUI interaction.

### Commands before completion (per AGENTS.md)

1. `npm run typecheck` → exit 0.
2. `npm test` → all files pass, no failures (the shared `FileContentView` text path must stay green).
3. Manual check by the user (the agent cannot drive the Electron GUI): open the Files panel, click a
   `.png` under `media/` or `resources/`, confirm the image fits the tab, confirm the toolbar shows
   only Open in VS Code, open several files and confirm the image and text tabs coexist, click a
   `.pdf` and confirm the OS application still opens it, and confirm an image path in a chat message
   still opens with the OS application.

### Documentation to update in the same commit

`docs/reference/05-ipc-contract.md` (two new channels), `docs/reference/09-ui-guide.md` (the Files
panel can show images), `README.md` (Files panel bullet), `src/shared/AGENTS.md` (new
`image.ts` module), `src/main/AGENTS.md` (new `file-viewer` exports) and
`src/renderer/src/components/AGENTS.md` (the shared content view renders images).

## Risks

- `FileContentView` is shared with the popup viewer window; the image branch must not disturb the
  text branch. Mitigation: the full unit suite runs, and the text `useEffect` is gated on `!isImage`.
- A parallel session is editing `styles.css` and `App.tsx` in the same working tree; separate hunks
  before staging (established practice in this repository).
- 10MB of image becomes ~13.3MB of base64 across IPC; acceptable at this cap, and the cap is the
  reason the transport was chosen over streaming.
