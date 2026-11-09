# Files Panel Redesign Implementation Plan

Status: pending execution

**Goal:** Implement [Files Panel Redesign — Design](../specs/2026-11-09-files-panel-redesign-design.md). Read
the spec first; it holds the exact behavior and is not repeated here.

**Tech Stack:** React 19, TypeScript strict, CodeMirror 6 via `@uiw/react-codemirror`, Vitest, Playwright.

## Global Constraints

- Work only inside this worktree, on branch `feat/files-panel`. Do not switch branches, push or merge.
- Commit once per task with a Conventional Commit message. **No `Co-Authored-By` trailer.** Stage files by
  explicit path, never `git add -A`. `node_modules` here is a junction into the main checkout: never run
  `npm install`, `npm ci` or anything that modifies it.
- Source code, UI labels, test names and docs are in English. Comments only for non-obvious decisions.
- Menus and popups use `BaseDropdown` / `BaseSelect` / `BaseModal`. `PanelHeader` must stay generic.
- Keep every open file mounted (`.files-tab-pane` with `hidden`): unmounting drops unsaved edits. The only
  tab that may unmount is a clean preview tab being replaced.
- Update `AGENTS.md` for what changes (`src/renderer/AGENTS.md`, `src/renderer/src/components/AGENTS.md`,
  `tests/e2e/AGENTS.md`) and `docs/reference/09-ui-guide.md`, in the same commit, editing only the affected
  entries.

## Verification for every task

```bash
npm run typecheck
npm test
```

Both must pass before committing. E2E needs a build first:

```bash
npm run build
npx playwright test tests/e2e/files-panel.spec.ts
```

Known baseline: `tests/e2e/smoke.spec.ts` and `tests/e2e/sidebar-sessions.spec.ts` each have 3 failures
that predate this work. Do not fix them or treat them as yours.

## Task 1: Layout

Files: `components/files/FilesOverlay.tsx`, `components/file-content/FileContentView.tsx`,
`src/renderer/src/styles.css`, `tests/unit/files-overlay-splitter.test.tsx`, new `tests/e2e/files-panel.spec.ts`.

1. Implement spec section 1: tree on the right, inverted drag, the new filter placeholder, per-file bar
   with relative path, `toolbarActions`, Fold/Unfold all, Toggle file tree with `meow.files.treeHidden`,
   Files menu moved into the bar, and the empty-state bar. Tabs, filter and panel header keep the shared
   panel style: no pills and no rounded filter.
2. Use `foldAll` / `unfoldAll` from `@codemirror/language` and add `"@codemirror/language": "^6.12.4"` and
   `"@codemirror/view": "^6.43.11"` to `package.json` `dependencies` by hand. Both are already installed
   transitively. Add `@codemirror/state` too if you import it. Do not run npm install. If `package-lock.json`
   needs the root entry, edit only the `packages[""].dependencies` block by hand.
3. Update the splitter test: dragging left now widens, and the clamp assertions follow.
4. Add the e2e spec, modeled on `tests/e2e/sidebar-sessions.spec.ts` seeding (`workspaces.json`,
   `.sessions-model-reset`, temp `MEOW_USER_DATA`, temp project with a few files). Assert: the tree's left
   edge is right of the editor's right edge; opening a file shows its relative path in the bar; the tree
   toggle hides the tree, and the state survives closing and reopening the panel.

Commit: `feat(files): move the tree right and add a per-file bar`

## Task 2: File icons and git state

Files: new `components/files/file-icon.tsx`, new `components/files/git-decorations.ts`,
`components/files/FilesTree.tsx`, `components/files/FilesOverlay.tsx`, `styles.css`, new unit tests
`tests/unit/file-icon.test.ts` and `tests/unit/git-decorations.test.ts`, `tests/e2e/files-panel.spec.ts`.

1. Implement spec section 2. Paths from `gitGetStatusDetail` are relative with forward slashes, while tree
   entries are absolute: compare through a project-relative, forward-slash form. Handle Windows separators
   and do not import `node:path` in the renderer.
2. Keep refreshes cheap: fetch once per debounce, and ignore a late response after the project changes.
3. Unit tests: every status kind maps to its letter; ancestors are collected; an untracked `dir/` marks
   descendants; quoted paths are unquoted; renames use the new path; `null` detail gives empty results.
4. E2E: seed a real git repo with one committed file modified and one untracked. Assert the letters `M` and
   `U` and a dot on a changed directory.

Commit: `feat(files): add file type icons and git state to the tree`

## Task 3: Preview tabs and pinning

Files: new `components/files/open-tabs.ts`, `components/files/FilesOverlay.tsx`,
`components/files/FilesTree.tsx`, `styles.css`, new `tests/unit/open-tabs.test.ts`,
`tests/e2e/files-panel.spec.ts`.

1. Implement the rule table in spec section 3 as pure functions over a `{ tabs, activeTab }` state, and move
   the tab state of `FilesOverlay` onto them. Keep `requestClose`, the dirty tracking and the discard dialog
   behavior.
2. `FilesTree` gets `onOpenFilePermanent` for row double click. A double click fires a single click first:
   the sequence preview → promote must end as one permanent tab, never two tabs.
3. The pin button goes in the tab's `trail`, with `stopPropagation`. `PanelHeader` is not changed, except
   that it may forward an existing prop.
4. A dirty tab being promoted must not flip back when it is saved.
5. Unit tests cover each table row, including: a preview is not replaced while it is dirty; pinned tabs sort
   first; close all keeps pinned tabs; the active tab stays valid after each action.
6. E2E: click A then B leaves one tab (B, italic); double click keeps both when a third opens; pin moves a
   tab first and close all keeps it; typing in a preview promotes it.

Commit: `feat(files): add preview tabs and pinning`

## Task 4: Gutter send to chat

Files: new `components/files/line-send-gutter.ts`, `components/file-content/FileContentView.tsx`,
`components/files/FilesOverlay.tsx`, `src/renderer/src/App.tsx`, `styles.css`, new
`tests/unit/line-send-gutter.test.ts`, `tests/e2e/files-panel.spec.ts`.

1. Implement spec section 4. Split a pure `buildSendText({ relPath, lang, startLine, endLine, code })` from
   the CodeMirror gutter so it can be unit tested. Use `gutter` and `GutterMarker` from `@codemirror/view`,
   showing the marker through CSS on `.cm-gutterElement:hover`.
2. `FileContentView` gets an optional `extraExtensions` prop. The popup does not pass it. Memoize the
   extension array, keeping it stable across renders, or the editor reconfigures on every keystroke. The
   callback reads current values through a ref.
3. `App.tsx` passes the project's active session id from `activeSessionByPath`. Verify a draft session's id
   matches what its `ChatPanel` listens on before relying on it, and if the panel renders above a different
   project's session, the event must target the session of the panel's own project.
4. Unit tests: single line `:12`, range `:12-14`, a fence longer than a backtick run in the code, language
   from extension, unknown extension gives a plain fence.
5. E2E: open a file, hover a line, click `+`, and assert the composer text holds the path and code.

Commit: `feat(files): send lines to the chat from the editor gutter`
