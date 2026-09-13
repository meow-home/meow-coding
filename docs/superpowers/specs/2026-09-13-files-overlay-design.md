# Files Overlay (project explorer) Design Spec

Status: approved

## 1. Overview

The title bar's right-panel toggle is removed and the `RightPanel` (directory tree + artifacts) is parked
out of the UI. A new **Files** overlay takes its place: an in-app surface that covers the chat pane area,
opened from the **Files** entry of a pane's `⋮` action menu. It shows a filterable directory tree on the
left (including dotfiles and `node_modules`, matching the reference mockup) and open files in tabs on the
right, with a header offering search, a menu, and a maximize/minimize toggle.

The overlay is **not** an OS window: it mounts inside `.main`, so the title bar, status bar and left
sidebar stay visible and usable in both states.

## 2. Goals & Non-Goals

### Goals

- Remove the panel toggle button from `TitleBar` and stop rendering `RightPanel`, keeping its code and CSS
  parked (same convention as the parked PTY runtime).
- Add a **Files** item to the `⋮` menu in `PaneHeader` that opens the overlay for that pane's project.
- Render the overlay over the chat pane region: a rounded card in normal state, edge-to-edge inside `.main`
  when maximized — never covering the sidebar, title bar or status bar.
- Directory tree with type-ahead name filtering, `?`-prefixed content search, lazy directory loading,
  open-file highlight, and a right-click context menu.
- Right side: tab strip with per-tab close and one file rendered at a time, reusing the existing
  viewer content pipeline (highlight, markdown, Raw toggle, Copy, Open in VS Code).
- Keep chat file-path clicks on their current behavior (opening the `FileViewer` popup).

### Non-Goals

- Opening the Files overlay as a separate `BrowserWindow` (`src/main/files-viewer.ts` is not part of this work).
- Jumping to the matching line when clicking a content-search hit (explicitly deferred).
- Multi-file layouts other than tabs (no stacked/diff layout switcher).
- A draggable tree/content splitter — the tree column keeps a fixed width in this iteration.
- Restoring the artifacts UI; the artifact store, IPC and renderer components stay parked but intact.

## 3. Detailed Architecture & Design

### 3.1 Title bar toggle removal

- `src/renderer/src/components/TitleBar.tsx`: drop the `title-bar-panel-toggle` button, `PanelIcon`, the
  `PanelRight`/`PanelRightClose` imports and the `panelOpen` / `onTogglePanel` props.
- `src/renderer/src/App.tsx`: stop rendering `<RightPanel>` and stop passing the two props to `TitleBar`.
- **Parked, not deleted** — kept files: `components/RightPanel.tsx`, `components/RightPanelTree.tsx`,
  `components/RightPanelArtifacts.tsx`, and the `.right-panel*` CSS rules. `App.tsx` keeps the
  `rightOpen` / `rightTab` / `rightWidth` state and the `onArtifactsChanged` listener with a comment marking
  them as the parked `RightPanel` glue, so re-enabling is a small diff and the user's persisted panel
  width/tab survive the parking. `setRightOpen` therefore has no remaining reference; that is accepted
  because the project compiles with `noUnusedLocals` off and has no ESLint configuration.

### 3.2 Pane action menu

- `PaneHeader.tsx` gains an optional `onOpenFiles?: () => void` prop and renders a `FolderTree` menu item
  labelled **Files** above the existing `menu-sep`, for every pane kind.
- The handler is threaded `PaneHeader → Pane → SessionPanes → WorkspaceView → App`, where `App` opens the
  overlay for that pane's `workspace.projectPath`.

### 3.3 Overlay state and placement

- `App.tsx` owns `filesProject: string | null` and `filesFull: boolean`. Opening for a different project than
  the currently displayed one is not possible from the menu (the menu belongs to a visible pane); switching
  the active project while the overlay is open **closes** it.
- The overlay is rendered inside `.main` (portal not required; `.main` gains `position: relative`), as
  `.files-overlay`:
  - normal: rounded card, `width: min(1100px, calc(100% - 4rem))`, `height: calc(100% - 3rem)`, centred,
    drop shadow, leaving the chat pane visible around its edges;
  - `.full`: `position: absolute; inset: 0;` within `.main` — the sidebar, title bar and status bar remain
    visible (per requirement), only the chat pane region is covered.
- `Esc` closes the overlay; the header `✕` closes it; the `⤢`/`⤡` button toggles `filesFull`
  (`Maximize2` / `Minimize2`).

### 3.4 Header

Reuses `.title-bar` for the drag region (same as `PopupTitleBar`) with these controls, right-aligned:
search (focuses the filter input), `⋮` menu, maximize/minimize, close. Left side shows a `Files` label.

`⋮` menu items: **Refresh**, **Collapse all**, **Close all tabs**, **Copy path**, **Reveal in Folder**,
**Open in VS Code**. "Copy path" copies the absolute path of the file open in the active tab (disabled when
no tab is open).

### 3.5 Left column — tree and filtering

- The column is a fixed `320px` wide (`flex: 0 0 auto`) with its own scroll container.
- Filter input placeholder: `Filter files... (? for contents)`. `Esc` inside the input clears the filter;
  `Esc` anywhere else closes the overlay.
- Plain text filters the already-loaded tree by name (matching nodes keep their ancestors visible);
  a `?` prefix switches to content search and renders a hit list of `path:line: text`.
- Clicking a tree row opens that file in a tab; the row of the file open in the active tab is highlighted.
- Right-click opens `FileContextMenu` (existing: Open in VS Code / Reveal in Folder) extended with an
  optional **Copy path** entry, so the parked `RightPanel` consumers keep working unchanged.
- The tree lists everything: dotfiles and `node_modules` included, matching the mockup. That requires a
  non-ignoring directory listing (see 3.7).

### 3.6 Right column — open files

- Tab strip: file name + close button per tab; clicking a tab activates it; the active tab's content renders
  below.
- Tabs live in memory only — closing the overlay (or the app) discards them, matching the existing
  `FileViewer`/`GitViewer` popups.
- Empty state mirrors the mockup: folder icon, "Open files appear here", "Pick a file in the tree, or click
  a file path in the conversation." (the second line stays descriptive only — chat path clicks keep opening
  the `FileViewer` popup, see 2. Non-Goals).
- Content rendering is extracted from `components/FileViewer.tsx` into
  `components/file-content/FileContentView.tsx` (load via `api.getFileContent`, lazy highlighter preload,
  markdown rendering, Raw/Highlighted toggle, Copy, Open in VS Code) and used by both the popup and the
  overlay tab, so no viewer logic is duplicated.

### 3.7 IPC and main-process support

| Channel | Payload | Behavior |
|---|---|---|
| `FilesListDir` | `(projectPath, absPath)` | `listDir` with `ignore: false`, rejected unless `isPathInside(projectPath, absPath)` |
| `FilesSearch` | `(projectPath, query)` | Content search inside the project, returns hits |

- `src/main/dir-lister.ts` gains a `{ ignore?: boolean }` option (default `true`, so the parked
  `DirList` path and its tests are unchanged).
- `src/main/project-search.ts` (new, pure and unit-testable) holds the content-search implementation —
  `globSync` over the project, skipping `node_modules`/`.git`, a 1 MiB per-file cap, a 200-hit cap and
  `MAX_RESULTS`-style truncation of long lines. The agent's `grep` tool is refactored to call it so the
  search semantics have a single source of truth; `tests/unit/agent-tools.test.ts` guards the unchanged
  behavior.
- No change to `EventContextChanged` delivery or the window set: the overlay lives in the main window.

## 4. Verification & Testing

- New: `tests/unit/project-search.test.ts` (hits, caps, ignored dirs, invalid regex), plus cases covering
  `FilesListDir` path containment and the dotfile/`node_modules` visibility of `ignore: false`, extending
  `tests/unit/dir-lister.test.ts`.
- Updated: `tests/unit/ipc-contract.test.ts` (new channels + `AgentApi` entries).
- `npm run typecheck` and `npm test` must pass. e2e does not depend on the removed panel toggle, so no e2e
  changes are expected; if a spec touches the title bar, re-run `npm run build && npm run e2e`.
- Manual check: open the overlay from a pane menu, expand `node_modules`, filter by name, `?`-search, open
  several tabs, close tabs, toggle maximize (sidebar/title bar/status bar stay visible), press `Esc`.

## 5. Documentation Sync

- `docs/reference/09-ui-guide.md` — layout diagram without `RightPanel`, new overlay section.
- `docs/reference/05-ipc-contract.md` — the two new channels.
- `docs/reference/06-data-and-storage.md` — only if it describes the artifacts panel UI.
- `src/main/AGENTS.md`, `src/renderer/src/components/AGENTS.md` (if present) — key files and status.
- `README.md` — the explorer paragraph now describes the Files overlay.
