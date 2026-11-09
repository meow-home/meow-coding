Status: approved scope, in implementation

# Files Panel Redesign — Design

## Goal

Rework the Files panel so it reads like a focused code viewer: editor on the left, file tree on the
right, a per-file bar under the tabs, typed file icons, git state in the tree, preview tabs with pinning,
and a gutter button that sends code to the chat.

## Scope

In scope: the four parts below, for the Files panel only.

Out of scope: the popup `FileViewer` window keeps its toolbar and gets no gutter button; other right-side
panels (`PanelHeader` stays generic, shared tab styles do not change); persisting open tabs or pins across
restarts; syntax themes; a light-theme editor.

## 1. Layout

- `.files-body` order becomes `.files-main` then `.files-side`, so the tree is on the right. The tree has
  a left border and the resizer sits on its left edge. Dragging left widens the tree. Clamps, the
  `meow.files.sideWidth` key and double-click reset are unchanged.
- The filter is a rounded input with the placeholder `Filter, or ? to search in files`.
- Files tabs (`.files-open-tab`) are rounded pills. Only this class changes, not `.panel-tab`.
- A per-file bar sits under the header, reusing `.viewer-toolbar`: the path relative to the project on the
  left, actions on the right. The actions are the Markdown toggle where it applies, **Fold/Unfold all**
  (code files only), **Toggle file tree** (with an active state) and the existing **Files menu**, moved
  here from the panel header. With no open file the bar still renders, with an empty path, so the toggle
  and menu stay reachable.
- Hiding the tree persists in `localStorage` as `meow.files.treeHidden`.
- `FileContentView` gains `toolbarActions?: ReactNode` and shows a relative path when `hideFileActions` is
  set. The popup window's behavior does not change.
- In the dark theme the editor and its gutter paint `var(--bg-chat)` instead of One Dark's own background.
  Scoped to `.files-tab-pane` under `:root:not([data-theme="light"])`.

## 2. File icons and git state

- `files/file-icon.tsx` maps a file name to a lucide icon and a color class: code, JSON, Markdown, image,
  styles, config, `.gitignore`, and a generic fallback. Used by tree rows, content-search hits and tabs.
- `files/git-decorations.ts` is pure: `buildGitDecorations(detail)` turns a `GitStatusDetail` into a map of
  relative path → `{ letter, kind }` and a set of ancestor directories holding changes.
  Letters: `M`, `A`, `D`, `R`, `T`, and `U` for untracked. A porcelain path ending in `/` (an untracked
  directory) marks that directory and everything under it. Surrounding porcelain quotes are stripped.
- No new IPC: `FilesTree` calls the existing `window.api.gitGetStatusDetail(projectPath)` on mount, on
  `reloadToken`, and in the existing debounced `onContextChanged` refresh. `null` (not a repository, or a
  git failure) shows no decorations and no error.
- A changed file colors its name and shows the letter at the row's right edge. A directory colors its name
  and shows a dot. Colors: modified/renamed/typechange `--yellow`, added/untracked `--green`, deleted
  `--red`.

Known limit: git octal-escapes non-ASCII paths, so such a file shows no decoration.

## 3. Preview tabs and pinning

Tab rules live in a pure module, `files/open-tabs.ts`:

| Action | Result |
|---|---|
| Single click in the tree or a search hit | Open as preview. An open file only activates. An existing preview tab is replaced, never a pinned or permanent one. |
| Double click in the tree | Open as permanent. Promotes a preview tab. |
| Double click a tab | Promotes it. |
| File becomes dirty | Promotes it, so a preview replacement can never discard edits. |
| Pin button on a tab | Toggles pinned. A pinned tab is permanent and sorts before unpinned tabs. |
| Close all tabs | Closes everything except pinned tabs. |

Preview tabs render the name in italics. The pin button shows on hover and on the active tab; a pinned
tab shows it permanently, filled. The X still closes a pinned tab. State is in memory only.

## 4. Gutter "send to chat"

- A CodeMirror gutter (`files/line-send-gutter.ts`) shows a `+` on the hovered line, Files panel only.
- Clicking it sends that line. If the click is on a line inside a non-empty selection, it sends the
  selected lines instead.
- It dispatches the existing `meow:composer-insert` event with this text:

  ````
  `relative/path.ts:12-14`
  ```ts
  <code>
  ```
  ````

  A single line uses `:12`. The fence is longer than any backtick run in the code.
- `FilesOverlay` gets `agentId: string | null` from `App`: the project's active session. With `null`, the
  gutter is not added. Draft sessions get the same id `ChatPanel` listens on.

## Testing

- Unit: `open-tabs`, `git-decorations`, `file-icon`, the send-text builder.
- jsdom: `files-overlay-splitter.test.tsx` updated for the inverted drag; tree toggle persistence.
- E2E: a new `files-panel.spec.ts` covering the tree on the right of the editor, preview replacement,
  promotion, pin, a git letter in a seeded repository, and the gutter inserting into the composer.
