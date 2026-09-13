# Files Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the title bar's right-panel toggle and add a **Files** entry to a pane's `⋮` menu that opens
an in-app explorer overlay (directory tree + open-file tabs) over the chat pane.

**Architecture:** The overlay is a React component mounted inside `.main` (never an OS window), driven by
`filesOpenFor` / `filesFull` state in `App.tsx`. Directory listing and content search run in the main process
behind two new IPC channels (`files:list-dir`, `files:search`); the tree lists everything (dotfiles and
`node_modules` included) through a non-ignoring `listDir` variant. The parked `RightPanel` (tree + artifacts)
keeps its files and CSS but is no longer rendered.

**Tech Stack:** TypeScript (strict), React 19, Electron 41, Vitest, lucide-react, plain CSS in
`src/renderer/src/styles.css`.

Spec: `docs/superpowers/specs/2026-09-13-files-overlay-design.md`.

## HOW TO EXECUTE (read this once, then follow the steps literally)

- Every step is mechanical. **Do not redesign, do not rename, do not "improve" anything.** Copy the code
  exactly as given.
- Steps are marked `WRITE` (create/replace a whole file), `PATCH` (replace the exact quoted old text with the
  exact quoted new text) or `RUN` (a command whose expected output is stated).
- If a `RUN` command does not produce the expected result, stop and report; do not improvise a fix.
- After each task's final `RUN`, commit with the exact command given, then move to the next task.
- Never add a `Co-Authored-By` trailer to a commit.

## Global Constraints

- Source code, comments and UI labels are **English**.
- IPC channel strings are never hardcoded in renderer/preload — only `Channels` from `src/shared/ipc.ts`.
- `src/shared` must not import Node or Electron modules. The renderer must not import `node:path`.
- Only the main process touches the filesystem.
- Do not add comments beyond the ones shown in the code below.
- Baseline before starting: `npm run typecheck` clean and `npm test` = 105 files / 1177 tests passing.

---

### Task 1: Project-scoped, non-ignoring directory listing

**Files:**
- `src/main/dir-lister.ts` (WRITE)
- `tests/unit/dir-lister.test.ts` (APPEND to the end of the file)

- [ ] **Step 1: WRITE `src/main/dir-lister.ts` with exactly this content**

```ts
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry } from '../shared/types'

export const IGNORED_DIRS = ['node_modules', '.git', 'out', 'dist', '.next', '.nuxt', 'coverage']

export function shouldIgnore(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.includes(name)
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

export function isPathInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export interface ListDirOptions {
  ignore?: boolean
}

export async function listDir(absPath: string, options: ListDirOptions = {}): Promise<DirEntry[]> {
  const { ignore = true } = options
  const dirents = await readdir(absPath, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const d of dirents) {
    if (ignore && shouldIgnore(d.name)) continue
    // Symlink to a directory: treat as file to avoid cycles on expansion.
    const isDirectory = d.isDirectory() && !d.isSymbolicLink()
    entries.push({ name: d.name, path: path.join(absPath, d.name), isDirectory })
  }
  return sortEntries(entries)
}

// Project-scoped listing for the Files overlay: the tree shows dotfiles and
// node_modules (unlike the agent-facing DirList), and the path is confined to
// the project so a stale renderer path cannot read outside it.
export async function listProjectDir(projectPath: string, absPath: string): Promise<DirEntry[]> {
  if (!isPathInside(projectPath, absPath)) throw new Error('Not a project path')
  return listDir(absPath, { ignore: false })
}
```

- [ ] **Step 2: PATCH the import line at the top of `tests/unit/dir-lister.test.ts`**

old:

```ts
import { listDir, shouldIgnore, sortEntries } from '../../src/main/dir-lister'
```

new:

```ts
import { listDir, listProjectDir, shouldIgnore, sortEntries } from '../../src/main/dir-lister'
```

- [ ] **Step 3: APPEND this block to the end of `tests/unit/dir-lister.test.ts`**

```ts
describe('listDir ignore option', () => {
  it('skips dotfiles and ignored dirs by default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-ignore-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.gitignore'), 'x')
    writeFileSync(path.join(root, 'index.ts'), 'x')

    expect((await listDir(root)).map(e => e.name)).toEqual(['index.ts'])
  })

  it('lists dotfiles and node_modules when ignore is false', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-all-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.gitignore'), 'x')
    writeFileSync(path.join(root, 'index.ts'), 'x')

    expect((await listDir(root, { ignore: false })).map(e => e.name))
      .toEqual(['node_modules', '.gitignore', 'index.ts'])
  })
})

describe('listProjectDir', () => {
  it('rejects a path outside the project', async () => {
    await expect(listProjectDir('/proj', path.join('/other', 'x'))).rejects.toThrow('Not a project path')
  })

  it('accepts the project root itself and ignores nothing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-proj-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.env'), 'x')

    expect((await listProjectDir(root, root)).map(e => e.name)).toEqual(['node_modules', '.env'])
  })
})
```

- [ ] **Step 4: RUN**

```bash
npx vitest run tests/unit/dir-lister.test.ts
```

Expected: `6 passed` (2 existing describe blocks plus the 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/dir-lister.ts tests/unit/dir-lister.test.ts
git commit -m "feat(files): add non-ignoring project-scoped directory listing"
```

---

### Task 2: Shared project content search

**Files:**
- `src/shared/types.ts` (PATCH)
- `src/main/project-search.ts` (WRITE)
- `src/main/agent/tools/grep.ts` (WRITE)
- `tests/unit/project-search.test.ts` (WRITE)

- [ ] **Step 1: PATCH `src/shared/types.ts`**

old:

```ts
export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}
```

new:

```ts
export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface ProjectSearchHit {
  /** Path relative to the searched root, POSIX separators. */
  path: string
  /** 1-based line number. */
  line: number
  /** Trimmed line content, capped at SEARCH_MAX_LINE_CHARS. */
  text: string
}
```

- [ ] **Step 2: WRITE `src/main/project-search.ts` with exactly this content**

```ts
import { readFile, stat } from 'node:fs/promises'
import { globSync } from 'glob'
import path from 'node:path'
import type { ProjectSearchHit } from '../shared/types'

export const SEARCH_MAX_RESULTS = 200
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024
export const SEARCH_MAX_CANDIDATES = 500
export const SEARCH_MAX_LINE_CHARS = 160
export const SEARCH_IGNORE = ['**/node_modules/**', '**/.git/**']

// Yield to the event loop every N files: the search runs in the main process,
// so a large project must not block IPC and window events while it scans.
const YIELD_EVERY = 25

export interface ProjectSearchOptions {
  include?: string[]
  maxResults?: number
  maxFileBytes?: number
  maxCandidates?: number
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

export async function searchProject(
  root: string,
  pattern: string,
  options: ProjectSearchOptions = {}
): Promise<ProjectSearchHit[]> {
  const {
    include,
    maxResults = SEARCH_MAX_RESULTS,
    maxFileBytes = SEARCH_MAX_FILE_BYTES,
    maxCandidates = SEARCH_MAX_CANDIDATES
  } = options
  // Throws on an invalid pattern; callers decide whether that is an error (the
  // grep tool) or simply no results (the overlay, where the user is typing).
  const regex = new RegExp(pattern)
  const includePatterns = include && include.length > 0 ? include : ['**/*']
  const candidates = globSync(includePatterns, {
    cwd: root,
    nodir: true,
    posix: true,
    ignore: SEARCH_IGNORE,
    dot: false
  })
  const hits: ProjectSearchHit[] = []
  let scanned = 0
  for (const rel of candidates.slice(0, maxCandidates)) {
    if (scanned++ % YIELD_EVERY === 0) await yieldToEventLoop()
    const full = path.isAbsolute(rel) ? rel : path.join(root, rel)
    let text: string
    try {
      const st = await stat(full)
      if (!st.isFile() || st.size > maxFileBytes) continue
      text = await readFile(full, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        hits.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, SEARCH_MAX_LINE_CHARS) })
      }
    }
    if (hits.length >= maxResults) break
  }
  return hits
}
```

- [ ] **Step 3: WRITE `tests/unit/project-search.test.ts` with exactly this content**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { searchProject, SEARCH_MAX_RESULTS } from '../../src/main/project-search'

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'meow-search-'))
  mkdirSync(path.join(root, 'src'))
  writeFileSync(path.join(root, 'src', 'a.ts'), 'const foo = 1\nconst bar = 2\n')
  writeFileSync(path.join(root, 'README.md'), 'foo appears here too\n')
  mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'foo in a dependency\n')
  return root
}

describe('searchProject', () => {
  it('returns relative path, 1-based line and trimmed text', async () => {
    const hits = await searchProject(makeProject(), 'foo')
    expect(hits).toContainEqual({ path: 'src/a.ts', line: 1, text: 'const foo = 1' })
  })

  it('skips node_modules', async () => {
    const hits = await searchProject(makeProject(), 'foo')
    expect(hits.map(h => h.path)).not.toContain('node_modules/dep/index.js')
  })

  it('restricts candidates with include globs', async () => {
    const hits = await searchProject(makeProject(), 'foo', { include: ['**/*.md'] })
    expect(hits.map(h => h.path)).toEqual(['README.md'])
  })

  it('caps the number of hits', async () => {
    const hits = await searchProject(makeProject(), 'foo', { maxResults: 1 })
    expect(hits).toHaveLength(1)
  })

  it('rejects an invalid pattern', async () => {
    await expect(searchProject(makeProject(), 'foo(')).rejects.toThrow()
  })

  it('exposes the agent-facing result cap', () => {
    expect(SEARCH_MAX_RESULTS).toBe(200)
  })
})
```

- [ ] **Step 4: RUN**

```bash
npx vitest run tests/unit/project-search.test.ts
```

Expected: `6 passed`.

- [ ] **Step 5: WRITE `src/main/agent/tools/grep.ts` with exactly this content**

```ts
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { searchProject } from '../../project-search'

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a regular expression and return matching file:line entries.',
  schema: z.object({
    pattern: z.string().describe('Regular expression to search for.'),
    path: z.string().optional().describe('Directory to search (default: project root).'),
    include: z.array(z.string()).optional().describe('Glob patterns for files to include, e.g. ["*.ts"].')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { pattern, path: searchPath, include } = input as unknown as {
      pattern: string
      path?: string
      include?: string[]
    }
    const dir = resolveCwd(ctx.cwd, searchPath ?? '.')
    let hits
    try {
      hits = await searchProject(dir, pattern, { include })
    } catch {
      return { error: `grep: invalid regex: ${pattern}` }
    }
    if (hits.length === 0) return { output: '(no matches)' }
    return { output: hits.map(h => `${h.path}:${h.line}: ${h.text}`).join('\n') }
  }
}
```

- [ ] **Step 6: RUN**

```bash
npx vitest run tests/unit/agent-tools.test.ts tests/unit/project-search.test.ts && npm run typecheck
```

Expected: all tests pass and typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/project-search.ts src/main/agent/tools/grep.ts tests/unit/project-search.test.ts
git commit -m "refactor(agent): share project content search between grep and the files overlay"
```

---

### Task 3: Renderer path + filter helpers

**Files:**
- `src/renderer/src/components/files/file-path.ts` (WRITE)
- `src/renderer/src/components/files/tree-filter.ts` (WRITE)
- `tests/unit/file-path.test.ts` (WRITE)
- `tests/unit/tree-filter.test.ts` (WRITE)

- [ ] **Step 1: WRITE `src/renderer/src/components/files/file-path.ts` with exactly this content**

```ts
// Renderer-side path helpers: the overlay mixes POSIX-relative paths from the
// search IPC with absolute OS paths from the tree, and must not import
// node:path (renderer bundle).
export function baseName(absPath: string): string {
  return absPath.split(/[\\/]/).filter(Boolean).pop() ?? absPath
}

export function joinProjectPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  return `${base}${sep}${rel.split('/').join(sep)}`
}
```

- [ ] **Step 2: WRITE `tests/unit/file-path.test.ts` with exactly this content**

```ts
import { describe, expect, it } from 'vitest'
import { baseName, joinProjectPath } from '../../src/renderer/src/components/files/file-path'

describe('baseName', () => {
  it('returns the last segment of a posix path', () => {
    expect(baseName('/p/src/index.ts')).toBe('index.ts')
  })

  it('returns the last segment of a windows path', () => {
    expect(baseName('C:\\p\\src\\index.ts')).toBe('index.ts')
  })
})

describe('joinProjectPath', () => {
  it('joins with a slash on posix roots', () => {
    expect(joinProjectPath('/p', 'src/a.ts')).toBe('/p/src/a.ts')
  })

  it('joins with a backslash on windows roots and drops a trailing separator', () => {
    expect(joinProjectPath('C:\\p\\', 'src/a.ts')).toBe('C:\\p\\src\\a.ts')
  })
})
```

- [ ] **Step 3: WRITE `src/renderer/src/components/files/tree-filter.ts` with exactly this content**

```ts
import type { DirEntry } from '@shared/types'

export interface TreeFilterNode {
  entry: DirEntry
  children: TreeFilterNode[]
}

// Keeps entries whose name matches the query plus the ancestor chain of every
// match. Only directories the overlay has already loaded are searched, so
// filtering never triggers directory reads of its own.
export function filterTree(
  entries: DirEntry[],
  loadedChildren: Record<string, DirEntry[]>,
  query: string
): TreeFilterNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const walk = (list: DirEntry[]): TreeFilterNode[] => {
    const out: TreeFilterNode[] = []
    for (const entry of list) {
      const children = walk(loadedChildren[entry.path] ?? [])
      if (entry.name.toLowerCase().includes(needle) || children.length > 0) out.push({ entry, children })
    }
    return out
  }
  return walk(entries)
}
```

- [ ] **Step 4: WRITE `tests/unit/tree-filter.test.ts` with exactly this content**

```ts
import { describe, expect, it } from 'vitest'
import { filterTree } from '../../src/renderer/src/components/files/tree-filter'
import type { DirEntry } from '../../src/shared/types'

const dir = (name: string, p: string): DirEntry => ({ name, path: p, isDirectory: true })
const file = (name: string, p: string): DirEntry => ({ name, path: p, isDirectory: false })

const entries = [dir('src', '/p/src'), file('README.md', '/p/README.md')]
const loaded = { '/p/src': [file('index.ts', '/p/src/index.ts'), file('app.tsx', '/p/src/app.tsx')] }

describe('filterTree', () => {
  it('returns nothing for an empty query', () => {
    expect(filterTree(entries, loaded, '   ')).toEqual([])
  })

  it('keeps matches case-insensitively', () => {
    const result = filterTree(entries, loaded, 'readme')
    expect(result.map(n => n.entry.name)).toEqual(['README.md'])
  })

  it('keeps the ancestor chain of a nested match', () => {
    const result = filterTree(entries, loaded, 'index')
    expect(result.map(n => n.entry.name)).toEqual(['src'])
    expect(result[0].children.map(n => n.entry.name)).toEqual(['index.ts'])
  })

  it('never reads directories that were not loaded', () => {
    expect(filterTree(entries, {}, 'index')).toEqual([])
  })
})
```

- [ ] **Step 5: RUN**

```bash
npx vitest run tests/unit/file-path.test.ts tests/unit/tree-filter.test.ts
```

Expected: `6 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/files/file-path.ts src/renderer/src/components/files/tree-filter.ts tests/unit/file-path.test.ts tests/unit/tree-filter.test.ts
git commit -m "feat(files): add renderer path and tree filter helpers"
```

---

### Task 4: IPC plumbing for the overlay

**Files:**
- `src/shared/ipc.ts` (PATCH ×3)
- `src/preload/index.ts` (PATCH)
- `src/main/index.ts` (PATCH ×4)
- `tests/unit/ipc-contract.test.ts` (PATCH ×3)

- [ ] **Step 1: PATCH `src/shared/ipc.ts` — type import**

old:

```ts
  ImageAttachment, LogLevel, McpServerStatus, MeowSettings, ModelRef, NewAgentInput, PendingPromptInfo, PromptResponse,
```

new:

```ts
  ImageAttachment, LogLevel, McpServerStatus, MeowSettings, ModelRef, NewAgentInput, PendingPromptInfo, ProjectSearchHit, PromptResponse,
```

- [ ] **Step 2: PATCH `src/shared/ipc.ts` — channels**

old:

```ts
  DirList: 'dir:list',
```

new:

```ts
  DirList: 'dir:list',
  FilesListDir: 'files:list-dir',
  FilesSearch: 'files:search',
```

- [ ] **Step 3: PATCH `src/shared/ipc.ts` — AgentApi**

old:

```ts
  listDir(absPath: string): Promise<DirEntry[]>
```

new:

```ts
  listDir(absPath: string): Promise<DirEntry[]>
  filesListDir(projectPath: string, absPath: string): Promise<DirEntry[]>
  filesSearch(projectPath: string, query: string): Promise<ProjectSearchHit[]>
```

- [ ] **Step 4: PATCH `src/preload/index.ts`**

old:

```ts
  listDir: (absPath: string) =>
    ipcRenderer.invoke(Channels.DirList, absPath),
```

new:

```ts
  listDir: (absPath: string) =>
    ipcRenderer.invoke(Channels.DirList, absPath),
  filesListDir: (projectPath: string, absPath: string) =>
    ipcRenderer.invoke(Channels.FilesListDir, projectPath, absPath),
  filesSearch: (projectPath: string, query: string) =>
    ipcRenderer.invoke(Channels.FilesSearch, projectPath, query),
```

- [ ] **Step 5: PATCH `src/main/index.ts` — imports**

old:

```ts
import { isPathInside, listDir, shouldIgnore } from './dir-lister'
```

new:

```ts
import { isPathInside, listDir, listProjectDir, shouldIgnore } from './dir-lister'
import { searchProject } from './project-search'
```

- [ ] **Step 6: PATCH `src/main/index.ts` — types import**

old:

```ts
import type { AgentState, Command, FileViewerPayload, ImageAttachment, LogLevel, MeowSettings, ModelRef, NewAgentInput, PromptResponse, TranscriptWindowOpts, Workspace, WorkspaceRuntime } from '../shared/types'
```

new:

```ts
import type { AgentState, Command, FileViewerPayload, ImageAttachment, LogLevel, MeowSettings, ModelRef, NewAgentInput, ProjectSearchHit, PromptResponse, TranscriptWindowOpts, Workspace, WorkspaceRuntime } from '../shared/types'
```

- [ ] **Step 7: PATCH `src/main/index.ts` — MainApp methods**

old:

```ts
  dirList(absPath: string): Promise<DirEntry[]> {
    const root = this.activeProject
    if (!root || !isPathInside(root, absPath)) throw new Error('Not a project path')
    return listDir(absPath)
  }
```

new:

```ts
  dirList(absPath: string): Promise<DirEntry[]> {
    const root = this.activeProject
    if (!root || !isPathInside(root, absPath)) throw new Error('Not a project path')
    return listDir(absPath)
  }

  filesListDir(projectPath: string, absPath: string): Promise<DirEntry[]> {
    if (!this.workspaces.get(projectPath)) throw new Error('Unknown project')
    return listProjectDir(projectPath, absPath)
  }

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

- [ ] **Step 8: PATCH `src/main/index.ts` — IPC handlers**

old:

```ts
  ipcMain.handle(Channels.DirList, (_e, absPath: string) => mainApp.dirList(absPath))
```

new:

```ts
  ipcMain.handle(Channels.DirList, (_e, absPath: string) => mainApp.dirList(absPath))
  ipcMain.handle(Channels.FilesListDir, (_e, projectPath: string, absPath: string) =>
    mainApp.filesListDir(projectPath, absPath))
  ipcMain.handle(Channels.FilesSearch, (_e, projectPath: string, query: string) =>
    mainApp.filesSearch(projectPath, query))
```

- [ ] **Step 9: PATCH `tests/unit/ipc-contract.test.ts` — required list**

old:

```ts
      'suggestFiles', 'setAgentBackground', 'onAgentBackground',
```

new:

```ts
      'suggestFiles', 'setAgentBackground', 'onAgentBackground',
      'filesListDir', 'filesSearch',
```

- [ ] **Step 10: PATCH `tests/unit/ipc-contract.test.ts` — api stubs**

old:

```ts
      suggestFiles: async () => [],
```

new:

```ts
      suggestFiles: async () => [],
      filesListDir: async () => [],
      filesSearch: async () => [],
```

- [ ] **Step 11: PATCH `tests/unit/ipc-contract.test.ts` — channel assertions**

old:

```ts
    expect(Channels.FilesSuggest).toBe('files:suggest')
```

new:

```ts
    expect(Channels.FilesSuggest).toBe('files:suggest')
    expect(Channels.FilesListDir).toBe('files:list-dir')
    expect(Channels.FilesSearch).toBe('files:search')
```

- [ ] **Step 12: RUN**

```bash
npx vitest run tests/unit/ipc-contract.test.ts && npm run typecheck && npm test
```

Expected: all pass (1177 + 16 new tests).

- [ ] **Step 13: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(files): add files overlay IPC channels"
```

---

### Task 5: Shared file content view

**Files:**
- `src/renderer/src/components/file-content/FileContentView.tsx` (WRITE)
- `src/renderer/src/components/FileViewer.tsx` (WRITE)

- [ ] **Step 1: WRITE `src/renderer/src/components/file-content/FileContentView.tsx` with exactly this content**

```tsx
import { useCallback, useEffect, useState } from 'react'
import MarkdownText from '../chat/MarkdownText'
import { isHighlightable, preloadLanguage, highlightCode } from '../chat/highlight'

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

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const code = isHighlightable(ext)

  useEffect(() => {
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
  }, [filePath, ext, code])

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
          <button className="btn small" onClick={() => void copy()} disabled={!content}>Copy</button>
        </div>
      </div>
      {/* Full-bleed for highlighted code (VS Code look), padded for everything else. */}
      <div className={`viewer-body${code && !raw && highlighted ? ' viewer-body--flush' : ''}`}>
        {error ? (
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

- [ ] **Step 2: WRITE `src/renderer/src/components/FileViewer.tsx` with exactly this content**

```tsx
import { useEffect } from 'react'
import PopupTitleBar from './PopupTitleBar'
import FileContentView from './file-content/FileContentView'

interface Props {
  path: string
  root: string
}

export default function FileViewer({ path, root }: Props) {
  // Close via Escape; the native title bar provides minimize/maximize/close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="viewer">
      <PopupTitleBar title={path} />
      <FileContentView path={path} root={root} />
    </div>
  )
}
```

- [ ] **Step 3: RUN**

```bash
npm run typecheck && npm test
```

Expected: all pass. Manual check with `npm run dev`: clicking a file path in the chat feed opens the popup with
the same toolbar, highlighted code / markdown body, Raw toggle, Copy and Open in VS Code, and `Esc` closes it.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/file-content/FileContentView.tsx src/renderer/src/components/FileViewer.tsx
git commit -m "refactor(viewer): extract the shared file content view"
```

---

### Task 6: Remove the title bar toggle and park the right panel

**Files:**
- `src/renderer/src/components/TitleBar.tsx` (WRITE)
- `src/renderer/src/App.tsx` (PATCH ×4)
- `src/renderer/src/styles.css` (PATCH)

- [ ] **Step 1: WRITE `src/renderer/src/components/TitleBar.tsx` with exactly this content**

```tsx
import { useEffect, useState } from 'react'
import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react'
import logoMark from '../assets/logo-mark.png'

function MinimizeIcon() {
  return <Minus size={10} aria-hidden="true" />
}

function MaximizeIcon() {
  return <Square size={10} aria-hidden="true" />
}

function RestoreIcon() {
  return <Copy size={10} aria-hidden="true" />
}

function CloseIcon() {
  return <X size={10} aria-hidden="true" />
}

interface Props {
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onMouseEnterBrand?: () => void
  onMouseLeaveBrand?: () => void
}

export default function TitleBar({
  sidebarCollapsed, onToggleSidebar,
  onMouseEnterBrand, onMouseLeaveBrand
}: Props) {
  const platform = window.api.platform
  const showCustomControls = platform === 'linux'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!showCustomControls) return
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximizedChange(e => setMaximized(e.maximized))
  }, [showCustomControls])

  return (
    <div
      className={`title-bar title-bar-${platform}`}
      onDoubleClick={() => { if (showCustomControls) void window.api.toggleMaximizeWindow() }}
    >
      <div
        className={`title-bar-brand ${sidebarCollapsed ? 'collapsed' : ''}`}
        onMouseEnter={onMouseEnterBrand}
        onMouseLeave={onMouseLeaveBrand}
      >
        <img src={logoMark} className="title-bar-logo" alt="" />
        {onToggleSidebar && (
          <button
            className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="title-bar-right">
        {showCustomControls && (
          <div className="title-bar-controls" onDoubleClick={e => e.stopPropagation()}>
            <button className="title-bar-btn" aria-label="Minimize" onClick={() => void window.api.minimizeWindow()}>
              <MinimizeIcon />
            </button>
            <button
              className="title-bar-btn"
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={() => void window.api.toggleMaximizeWindow()}
            >
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button className="title-bar-btn title-bar-btn-close" aria-label="Close" onClick={() => void window.api.closeWindow()}>
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: PATCH `src/renderer/src/App.tsx` — import swap**

old:

```ts
import RightPanel from './components/RightPanel'
```

new:

```ts
import FilesOverlay from './components/files/FilesOverlay'
```

- [ ] **Step 3: PATCH `src/renderer/src/App.tsx` — parked state comment**

old:

```ts
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('meow.rightpanel.open') !== '0')
```

new:

```ts
  // PARKED: the RightPanel (directory tree + artifacts) is no longer rendered —
  // the Files overlay replaces it. These values, the artifacts state below and
  // the `onArtifactsChanged` subscription stay so re-enabling it is a small diff.
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('meow.rightpanel.open') !== '0')
```

- [ ] **Step 4: PATCH `src/renderer/src/App.tsx` — drop the two TitleBar props**

old:

```tsx
      <TitleBar
        panelOpen={rightOpen}
        onTogglePanel={() => setRightOpen(v => !v)}
        sidebarCollapsed={sidebarCollapsed}
```

new:

```tsx
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
```

- [ ] **Step 5: PATCH `src/renderer/src/App.tsx` — stop rendering RightPanel**

old:

```tsx
        {rightOpen && (
          <RightPanel
            root={activePath ?? null}
            tab={rightTab}
            width={rightWidth}
            artifacts={artifacts[activePath ?? ''] ?? []}
            onTabChange={setRightTab}
            onWidthChange={setRightWidth}
            onClearArtifacts={() => {
              if (activePath) void window.api.clearArtifacts(activePath)
            }}
          />
        )}
      </div>
```

new:

```tsx
      </div>
```

- [ ] **Step 6: PATCH `src/renderer/src/styles.css` — delete the dead rule**

old:

```css
/* Title bar panel toggle */
.title-bar-right { display: flex; align-items: center; height: 100%; -webkit-app-region: no-drag; }
.title-bar-panel-toggle { width: 3.166667rem; }
```

new:

```css
.title-bar-right { display: flex; align-items: center; height: 100%; -webkit-app-region: no-drag; }
```

Leave every `.right-panel*` rule untouched.

- [ ] **Step 7: RUN**

```bash
npm run typecheck && npm test
```

Expected: all pass. `App.tsx` will still hold unused `rightOpen` / `setRightOpen` / `rightTab` / `rightWidth` /
`artifacts` — that is intended; the TypeScript config does not enable `noUnusedLocals`.

Manual check with `npm run dev`: the title bar shows only the sidebar toggle (left) and the OS caption buttons
(right); dragging an empty title bar area still moves the window; nothing renders to the right of the chat pane.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ui): drop the title bar panel toggle and park the right panel"
```

---

### Task 7: Files overlay — tree, tabs, viewer and its entry point

**Files:**
- `src/renderer/src/components/files/FilesTree.tsx` (WRITE)
- `src/renderer/src/components/files/FilesOverlay.tsx` (WRITE)
- `src/renderer/src/components/FileContextMenu.tsx` (WRITE)
- `src/renderer/src/components/PaneHeader.tsx` (WRITE)
- `src/renderer/src/components/Pane.tsx` (PATCH ×2)
- `src/renderer/src/components/SessionPanes.tsx` (PATCH ×2)
- `src/renderer/src/App.tsx` (PATCH ×6)
- `src/renderer/src/styles.css` (APPEND to the end of the file)

- [ ] **Step 1: WRITE `src/renderer/src/components/FileContextMenu.tsx` with exactly this content**

```tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Code, Copy } from 'lucide-react'

export interface FileMenuState {
  x: number
  y: number
  absPath: string
}

interface Props {
  menu: FileMenuState | null
  onClose: () => void
  showCopyPath?: boolean
}

export default function FileContextMenu({ menu, onClose, showCopyPath = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null
  const x = Math.min(menu.x, window.innerWidth - 230)
  const y = Math.min(menu.y, window.innerHeight - 80)
  return createPortal(
    <div ref={ref} className="right-panel-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
      {showCopyPath && (
        <button className="menu-item" onClick={() => { void navigator.clipboard.writeText(menu.absPath); onClose() }}>
          <Copy size={16} aria-hidden="true" />
          Copy path
        </button>
      )}
      <button className="menu-item" onClick={() => { void window.api.openFileInEditor(menu.absPath); onClose() }}>
        <Code size={16} aria-hidden="true" />
        Open in VS Code
      </button>
      <button className="menu-item" onClick={() => { void window.api.showFileInFolder(menu.absPath); onClose() }}>
        <ArrowUpRight size={16} aria-hidden="true" />
        Reveal in Folder
      </button>
    </div>,
    document.body
  )
}
```

- [ ] **Step 2: WRITE `src/renderer/src/components/files/FilesTree.tsx` with exactly this content**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, File, Folder } from 'lucide-react'
import type { DirEntry, ProjectSearchHit } from '@shared/types'
import FileContextMenu, { type FileMenuState } from '../FileContextMenu'
import { filterTree, type TreeFilterNode } from './tree-filter'
import { joinProjectPath } from './file-path'

interface Props {
  projectPath: string
  query: string
  activePath: string | null
  onOpenFile: (absPath: string) => void
  reloadToken: number
  collapseToken: number
}

interface NodeData {
  loaded: boolean
  loading: boolean
  error: string | null
  expanded: boolean
  children: DirEntry[]
}

const emptyNode = (): NodeData => ({ loaded: false, loading: false, error: null, expanded: false, children: [] })

export default function FilesTree({ projectPath, query, activePath, onOpenFile, reloadToken, collapseToken }: Props) {
  const [root, setRoot] = useState<NodeData>({ ...emptyNode(), expanded: true })
  const [nodes, setNodes] = useState<Record<string, NodeData>>({})
  const [hits, setHits] = useState<ProjectSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState<FileMenuState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (absPath: string) => {
    setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loading: true, error: null } }))
    try {
      const children = await window.api.filesListDir(projectPath, absPath)
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loaded: true, loading: false, children } }))
    } catch (err) {
      setNodes(prev => ({
        ...prev,
        [absPath]: {
          ...(prev[absPath] ?? emptyNode()), loading: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }))
    }
  }, [projectPath])

  const refreshRoot = useCallback(async () => {
    try {
      const children = await window.api.filesListDir(projectPath, projectPath)
      setRoot(prev => ({ ...prev, loaded: true, loading: false, error: null, children }))
    } catch (err) {
      setRoot(prev => ({
        ...prev, loaded: true, loading: false,
        error: err instanceof Error ? err.message : String(err)
      }))
    }
  }, [projectPath])

  useEffect(() => {
    setNodes({})
    setHits([])
    setRoot({ ...emptyNode(), expanded: true })
    void refreshRoot()
  }, [refreshRoot])

  useEffect(() => {
    if (reloadToken === 0) return
    void refreshRoot()
    for (const [absPath, node] of Object.entries(nodes)) {
      if (node.loaded) void load(absPath)
    }
  }, [reloadToken])

  useEffect(() => {
    if (collapseToken === 0) return
    setNodes(prev => {
      const next: Record<string, NodeData> = {}
      for (const [key, value] of Object.entries(prev)) next[key] = { ...value, expanded: false }
      return next
    })
  }, [collapseToken])

  // Auto-refresh expanded directories after file changes (debounced), matching
  // the parked right-panel tree.
  useEffect(() => {
    const off = window.api.onContextChanged(({ projectPath: changed }) => {
      if (changed !== projectPath) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void refreshRoot()
        for (const [absPath, node] of Object.entries(nodes)) {
          if (node.expanded && node.loaded) void load(absPath)
        }
      }, 500)
    })
    return () => {
      off()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [projectPath, nodes, refreshRoot, load])

  const contentQuery = query.trim().startsWith('?') ? query.trim().slice(1).trim() : ''
  const nameQuery = contentQuery ? '' : query

  useEffect(() => {
    if (!contentQuery) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    let alive = true
    const timer = setTimeout(() => {
      window.api.filesSearch(projectPath, contentQuery)
        .then(result => { if (alive) setHits(result) })
        .catch(() => { if (alive) setHits([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [contentQuery, projectPath])

  const filtered = useMemo(() => {
    if (!nameQuery.trim()) return []
    const loadedChildren: Record<string, DirEntry[]> = {}
    for (const [absPath, node] of Object.entries(nodes)) {
      if (node.loaded) loadedChildren[absPath] = node.children
    }
    return filterTree(root.children, loadedChildren, nameQuery)
  }, [root.children, nodes, nameQuery])

  const toggle = useCallback((entry: DirEntry) => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path)
      return
    }
    const node = nodes[entry.path]
    // Lazy-load on first expand; read from render-state closure to stay pure.
    if (!node || (!node.expanded && !node.loaded && !node.loading)) void load(entry.path)
    setNodes(prev => {
      const current = prev[entry.path] ?? emptyNode()
      return { ...prev, [entry.path]: { ...current, expanded: !current.expanded } }
    })
  }, [nodes, load, onOpenFile])

  const row = (entry: DirEntry, depth: number, expandable: boolean) => (
    <div
      key={entry.path}
      className={`tree-row files-tree-row${entry.path === activePath ? ' active' : ''}`}
      style={{ paddingLeft: `${0.666667 + depth * 0.75}rem` }}
      title={entry.path}
      onClick={() => toggle(entry)}
      onContextMenu={e => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, absPath: entry.path })
      }}
    >
      <span className="tree-chevron">
        {expandable && (
          <ChevronRight
            size={10}
            aria-hidden="true"
            style={{
              transform: nodes[entry.path]?.expanded ? 'rotate(90deg)' : undefined,
              transition: 'transform 120ms ease'
            }}
          />
        )}
      </span>
      {entry.isDirectory
        ? <Folder size={13} fill="currentColor" aria-hidden="true" className="tree-icon folder" />
        : <File size={13} aria-hidden="true" className="tree-icon file" />}
      <span className="tree-name">{entry.name}</span>
    </div>
  )

  const rows = (entries: DirEntry[], depth: number): React.ReactNode[] =>
    entries.map(entry => {
      const node = nodes[entry.path]
      if (!entry.isDirectory || !node?.expanded) return row(entry, depth, entry.isDirectory)
      return (
        <div key={entry.path}>
          {row(entry, depth, true)}
          {node.error ? (
            <div className="tree-row tree-dim tree-error" style={{ paddingLeft: `${1.416667 + depth * 0.75}rem` }}>
              {node.error}
            </div>
          ) : node.children.length === 0 ? (
            <div className="tree-row tree-dim" style={{ paddingLeft: `${1.416667 + depth * 0.75}rem` }}>
              {node.loading ? 'Loading…' : 'Empty'}
            </div>
          ) : (
            rows(node.children, depth + 1)
          )}
        </div>
      )
    })

  const filteredRows = (list: TreeFilterNode[]): React.ReactNode[] =>
    list.map(node => (
      <div key={node.entry.path}>
        {row(node.entry, 0, node.children.length > 0)}
        {node.children.map(child => row(child.entry, 1, false))}
      </div>
    ))

  return (
    <div className="tree files-tree">
      {contentQuery ? (
        searching ? (
          <div className="tree-row tree-dim">Searching…</div>
        ) : hits.length === 0 ? (
          <div className="tree-row tree-dim">No matches</div>
        ) : (
          hits.map(hit => (
            <div
              key={`${hit.path}:${hit.line}`}
              className={`tree-row files-tree-row${joinProjectPath(projectPath, hit.path) === activePath ? ' active' : ''}`}
              title={`${hit.path}:${hit.line}`}
              onClick={() => onOpenFile(joinProjectPath(projectPath, hit.path))}
            >
              <span className="tree-chevron" />
              <File size={13} aria-hidden="true" className="tree-icon file" />
              <span className="tree-name">{hit.path.split('/').pop()}</span>
              <span className="files-hit-line">{hit.line}</span>
              <span className="files-hit-text">{hit.text}</span>
            </div>
          ))
        )
      ) : nameQuery.trim() ? (
        filtered.length === 0 ? (
          <div className="tree-row tree-dim">No matches</div>
        ) : (
          filteredRows(filtered)
        )
      ) : root.error ? (
        <div className="tree-row tree-dim tree-error">{root.error}</div>
      ) : !root.loaded ? (
        <div className="tree-row tree-dim">Loading…</div>
      ) : (
        rows(root.children, 0)
      )}
      <FileContextMenu menu={menu} onClose={() => setMenu(null)} showCopyPath />
    </div>
  )
}
```

- [ ] **Step 3: WRITE `src/renderer/src/components/files/FilesOverlay.tsx` with exactly this content**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, CircleX, Code, Copy, EllipsisVertical, Files, Folder,
  ListCollapse, Maximize2, Minimize2, RefreshCw, Search, X
} from 'lucide-react'
import FilesTree from './FilesTree'
import FileContentView from '../file-content/FileContentView'
import { baseName } from './file-path'

interface Props {
  projectPath: string
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}

interface OpenFile {
  path: string
  name: string
}

export default function FilesOverlay({ projectPath, full, onToggleFull, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const openFile = useCallback((absPath: string) => {
    setTabs(prev => (prev.some(t => t.path === absPath) ? prev : [...prev, { path: absPath, name: baseName(absPath) }]))
    setActiveTab(absPath)
  }, [])

  const closeTab = useCallback((absPath: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.path !== absPath)
      setActiveTab(current => (current === absPath ? (next[next.length - 1]?.path ?? null) : current))
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.activeElement === filterRef.current && query) {
        setQuery('')
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [query, onClose])

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <section className={`files-overlay${full ? ' full' : ''}`} role="dialog" aria-label="Files">
      <div className="files-head title-bar">
        <div className="files-head-title">
          <Files size={14} aria-hidden="true" />
          <span>Files</span>
        </div>
        <div className="files-head-actions">
          <button
            className="icon-btn"
            title="Focus filter"
            aria-label="Focus filter"
            onClick={() => filterRef.current?.focus()}
          >
            <Search size={14} aria-hidden="true" />
          </button>
          <div className="pane-menu" ref={menuRef}>
            <button
              className="icon-btn"
              title="Files menu"
              aria-label="Files menu"
              onClick={() => setMenuOpen(v => !v)}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="sidebar-menu-dropdown pane-menu-dropdown files-menu-dropdown">
                <button className="menu-item" onClick={() => { setMenuOpen(false); setReloadToken(v => v + 1) }}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Refresh
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setCollapseToken(v => v + 1) }}>
                  <ListCollapse size={16} aria-hidden="true" />
                  Collapse all
                </button>
                <button
                  className="menu-item"
                  disabled={tabs.length === 0}
                  onClick={() => { setMenuOpen(false); setTabs([]); setActiveTab(null) }}
                >
                  <CircleX size={16} aria-hidden="true" />
                  Close all tabs
                </button>
                <div className="menu-sep" aria-hidden="true" />
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void navigator.clipboard.writeText(activeTab) }}
                >
                  <Copy size={16} aria-hidden="true" />
                  Copy path
                </button>
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void window.api.showFileInFolder(activeTab) }}
                >
                  <ArrowUpRight size={16} aria-hidden="true" />
                  Reveal in Folder
                </button>
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void window.api.openFileInEditor(activeTab) }}
                >
                  <Code size={16} aria-hidden="true" />
                  Open in VS Code
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title={full ? 'Restore size' : 'Expand'}
            aria-label={full ? 'Restore size' : 'Expand'}
            onClick={onToggleFull}
          >
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Files" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="files-body">
        <div className="files-side">
          <div className="files-filter">
            <Search size={13} aria-hidden="true" />
            <input
              ref={filterRef}
              className="files-filter-input"
              placeholder="Filter files... (? for contents)"
              value={query}
              spellCheck={false}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <FilesTree
            projectPath={projectPath}
            query={query}
            activePath={activeTab}
            onOpenFile={openFile}
            reloadToken={reloadToken}
            collapseToken={collapseToken}
          />
        </div>
        <div className="files-main">
          {tabs.length > 0 && (
            <div className="files-tabs" role="tablist" aria-label="Open files">
              {tabs.map(tab => (
                <div key={tab.path} className={`files-tab${tab.path === activeTab ? ' active' : ''}`}>
                  <button
                    className="files-tab-name"
                    role="tab"
                    aria-selected={tab.path === activeTab}
                    title={tab.path}
                    onClick={() => setActiveTab(tab.path)}
                  >
                    {tab.name}
                  </button>
                  <button className="files-tab-close" aria-label={`Close ${tab.name}`} onClick={() => closeTab(tab.path)}>
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="files-content">
            {activeTab ? (
              <FileContentView key={activeTab} path={activeTab} root={projectPath} />
            ) : (
              <div className="files-empty">
                <Folder size={30} aria-hidden="true" />
                <div className="files-empty-title">Open files appear here</div>
                <div className="files-empty-hint">
                  Pick a file in the tree, or click a file path in the conversation.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: WRITE `src/renderer/src/components/PaneHeader.tsx` with exactly this content**

```tsx
import { useEffect, useRef, useState } from 'react'
import { FileText, FolderTree, Layers, MoreVertical, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import type { AgentState } from '@shared/types'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  name: string
  state: AgentState
  background?: boolean
  native?: boolean
  active?: boolean
  onStop: () => void
  onRestart: () => void
  onInject: (text: string) => void
  onOpenLog: () => void
  onToggleBackground?: () => void
  onOpenFiles?: () => void
  onRemove: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

export default function PaneHeader({
  name, state, background = false, native = false, active = false,
  onStop, onRestart, onInject, onOpenLog, onToggleBackground, onOpenFiles, onRemove
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [injecting, setInjecting] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const close = () => setMenuOpen(false)

  const submitInject = () => {
    const text = prompt.trim()
    if (text) onInject(text)
    setPrompt('')
    setInjecting(false)
  }

  return (
    <div className={`pane-header ${active ? 'active' : ''} alert-${state.alert}`}>
      <span
        className={`status-dot status-${state.status}`}
        role="img"
        aria-label={state.exitCode !== null
          ? `${STATUS_LABEL[state.status]} (${state.exitCode})`
          : STATUS_LABEL[state.status]}
      />
      <span className="pane-title">{name}</span>
      <span className="pane-actions">
        {injecting && (
          <input
            className="input inject-input"
            autoFocus
            placeholder="prompt..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitInject()
              if (e.key === 'Escape') setInjecting(false)
            }}
          />
        )}
        <div className="pane-menu" ref={rootRef}>
          <button
            className="icon-btn"
            title="Pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown pane-menu-dropdown">
              {/* Only the parked PTY path has inject/log/stop/restart actions; a
                  native session's own menu is the sidebar's session row. */}
              {!native && (
                <>
                  <button className="menu-item" onClick={() => { close(); setInjecting(v => !v) }}>
                    <Play size={16} aria-hidden="true" />
                    Inject
                  </button>
                  <button className="menu-item" onClick={() => { close(); onOpenLog() }}>
                    <FileText size={16} aria-hidden="true" />
                    Log
                  </button>
                  <button className="menu-item" onClick={() => { close(); onStop() }}>
                    <Square size={16} aria-hidden="true" />
                    Stop
                  </button>
                  <button className="menu-item" onClick={() => { close(); onRestart() }}>
                    <RotateCw size={16} aria-hidden="true" />
                    Restart
                  </button>
                </>
              )}
              {onToggleBackground && (
                <button className="menu-item" onClick={() => { close(); onToggleBackground() }}>
                  <Layers size={16} aria-hidden="true" />
                  {background ? 'Open pane' : 'Run in background'}
                </button>
              )}
              {onOpenFiles && (
                <button className="menu-item" onClick={() => { close(); onOpenFiles() }}>
                  <FolderTree size={16} aria-hidden="true" />
                  Files
                </button>
              )}
              <div className="menu-sep" aria-hidden="true" />
              <button className="menu-item danger" onClick={() => { close(); setConfirmRemove(true) }}>
                <Trash2 size={16} aria-hidden="true" />
                Delete session
              </button>
            </div>
          )}
        </div>
      </span>
      {confirmRemove && (
        <ConfirmDialog
          title="Delete session"
          message={`Delete session "${name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { setConfirmRemove(false); onRemove() }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: PATCH `src/renderer/src/components/Pane.tsx` — props**

old:

```tsx
  onRemove: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
}

export default function Pane({ pane, background, active, onFocus, onRemove, onSendDraftMessage }: Props) {
```

new:

```tsx
  onRemove: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onOpenFiles?: () => void
}

export default function Pane({ pane, background, active, onFocus, onRemove, onSendDraftMessage, onOpenFiles }: Props) {
```

- [ ] **Step 6: PATCH `src/renderer/src/components/Pane.tsx` — pass it down**

old:

```tsx
        onToggleBackground={handleToggleBackground}
        onRemove={onRemove}
      />
```

new:

```tsx
        onToggleBackground={handleToggleBackground}
        onOpenFiles={onOpenFiles}
        onRemove={onRemove}
      />
```

- [ ] **Step 7: PATCH `src/renderer/src/components/SessionPanes.tsx` — props**

old:

```tsx
  onRemove: (id: string) => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
}
```

new:

```tsx
  onRemove: (id: string) => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onOpenFiles?: (id: string) => void
}
```

- [ ] **Step 8: PATCH `src/renderer/src/components/SessionPanes.tsx` — signature and pass-down**

old:

```tsx
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove, onSendDraftMessage }: Props) {
```

new:

```tsx
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove, onSendDraftMessage, onOpenFiles }: Props) {
```

old:

```tsx
            onRemove={() => onRemove(pane.agent.id)}
            onSendDraftMessage={onSendDraftMessage}
```

new:

```tsx
            onRemove={() => onRemove(pane.agent.id)}
            onSendDraftMessage={onSendDraftMessage}
            onOpenFiles={onOpenFiles ? () => onOpenFiles(pane.agent.id) : undefined}
```

- [ ] **Step 9: PATCH `src/renderer/src/App.tsx` — WorkspaceView signature**

old:

```tsx
function WorkspaceView({
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane, onSendDraftMessage
}: {
```

new:

```tsx
function WorkspaceView({
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane, onSendDraftMessage, onOpenFiles
}: {
```

- [ ] **Step 10: PATCH `src/renderer/src/App.tsx` — WorkspaceView prop types**

old:

```tsx
  onRemovePane: (path: string, id: string) => void
  onSendDraftMessage: (path: string, text: string, images?: ImageAttachment[]) => void
}) {
```

new:

```tsx
  onRemovePane: (path: string, id: string) => void
  onSendDraftMessage: (path: string, text: string, images?: ImageAttachment[]) => void
  onOpenFiles: (id: string) => void
}) {
```

- [ ] **Step 11: PATCH `src/renderer/src/App.tsx` — SessionPanes call inside WorkspaceView**

old:

```tsx
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
        onSendDraftMessage={textAndImages => onSendDraftMessage(runtime.workspace.projectPath, textAndImages.text, textAndImages.images)}
      />
```

new:

```tsx
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
        onSendDraftMessage={textAndImages => onSendDraftMessage(runtime.workspace.projectPath, textAndImages.text, textAndImages.images)}
        onOpenFiles={onOpenFiles}
      />
```

- [ ] **Step 12: PATCH `src/renderer/src/App.tsx` — overlay state**

old:

```tsx
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactEntry[]>>({})
```

new:

```tsx
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactEntry[]>>({})
  // Files overlay: the project it is open for (null = closed) and whether it is
  // expanded over the whole pane area.
  const [filesOpenFor, setFilesOpenFor] = useState<string | null>(null)
  const [filesFull, setFilesFull] = useState(false)
```

- [ ] **Step 13: PATCH `src/renderer/src/App.tsx` — close the overlay when the project changes**

old:

```tsx
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.width', String(rightWidth))
  }, [rightWidth])
```

new:

```tsx
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.width', String(rightWidth))
  }, [rightWidth])
  useEffect(() => {
    setFilesOpenFor(prev => (prev && prev !== activePath ? null : prev))
  }, [activePath])
```

- [ ] **Step 14: PATCH `src/renderer/src/App.tsx` — render the overlay inside `main`**

old:

```tsx
            ))}
        </main>
```

new:

```tsx
            ))}
          {filesOpenFor && (
            <FilesOverlay
              projectPath={filesOpenFor}
              full={filesFull}
              onToggleFull={() => setFilesFull(v => !v)}
              onClose={() => setFilesOpenFor(null)}
            />
          )}
        </main>
```

- [ ] **Step 15: PATCH `src/renderer/src/App.tsx` — pass the opener to the active WorkspaceView**

old:

```tsx
                onRemovePane={handleRemovePane}
                onSendDraftMessage={onSendDraftMessage}
              />
```

new:

```tsx
                onRemovePane={handleRemovePane}
                onSendDraftMessage={onSendDraftMessage}
                onOpenFiles={projectPath => { setFilesFull(false); setFilesOpenFor(projectPath) }}
              />
```

- [ ] **Step 16: PATCH `src/renderer/src/App.tsx` — pass the opener to the hidden WorkspaceViews**

old:

```tsx
                  onRemovePane={handleRemovePane}
                  onSendDraftMessage={onSendDraftMessage}
                />
```

new:

```tsx
                  onRemovePane={handleRemovePane}
                  onSendDraftMessage={onSendDraftMessage}
                  onOpenFiles={projectPath => { setFilesFull(false); setFilesOpenFor(projectPath) }}
                />
```

- [ ] **Step 17: APPEND this CSS to the end of `src/renderer/src/styles.css`**

```css
/* Files overlay (in-app project explorer) */
.main { position: relative; }
.files-overlay {
  position: absolute; z-index: 40; top: 1.333333rem; left: 1.666667rem; right: 1.666667rem; bottom: 1.333333rem;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg-chat); border: 0.083333rem solid var(--hairline);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-3);
  animation: meow-rise 180ms ease-out both;
}
/* Expanded: fills the pane area only — title bar, sidebar and status bar stay visible. */
.files-overlay.full { top: 0; left: 0; right: 0; bottom: 0; border: none; border-radius: 0; box-shadow: none; }
.files-head { padding: 0 0.5rem; gap: 0.5rem; border-bottom: 0.083333rem solid var(--hairline); }
.files-head-title {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-family: var(--font-display); font-size: var(--fs-sm); font-weight: var(--fw-semibold);
  color: var(--text-strong); letter-spacing: 0.02em; text-transform: uppercase;
}
.files-head-actions { display: flex; align-items: center; gap: 0.166667rem; -webkit-app-region: no-drag; }
.files-body { flex: 1; min-height: 0; display: flex; }
.files-side {
  flex: 0 0 20rem; min-width: 0; display: flex; flex-direction: column;
  border-right: 0.083333rem solid var(--hairline); background: var(--bg-sidebar);
}
.files-filter {
  display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto;
  margin: 0.666667rem 0.666667rem 0.333333rem; padding: 0 0.5rem;
  background: var(--bg-input); border: 0.083333rem solid var(--hairline); border-radius: var(--radius);
  color: var(--text-faint);
}
.files-filter-input {
  flex: 1; min-width: 0; height: 1.833333rem; border: none; background: transparent;
  color: var(--text); font: inherit; outline: none;
}
.files-tree { padding-top: 0; }
.files-tree-row.active { background: var(--bg-active); color: var(--text-strong); }
.files-hit-line { flex: 0 0 auto; color: var(--accent); font-family: var(--font-mono); font-size: var(--fs-xs); }
.files-hit-text {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-faint); font-family: var(--font-mono); font-size: var(--fs-xs);
}
.files-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.files-tabs {
  flex: 0 0 2.5rem; display: flex; align-items: stretch; overflow-x: auto;
  border-bottom: 0.083333rem solid var(--hairline); background: var(--bg-panel);
}
.files-tab { display: inline-flex; align-items: center; gap: 0.166667rem; padding: 0 0.5rem; border-right: 0.083333rem solid var(--hairline); }
.files-tab.active { background: var(--bg-chat); }
.files-tab-name {
  border: none; background: transparent; color: var(--text-dim); cursor: pointer;
  font: inherit; font-size: var(--fs-base); max-width: 14rem; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.files-tab.active .files-tab-name { color: var(--text-strong); }
.files-tab-close {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--text-faint); cursor: pointer;
  border-radius: var(--radius-xs); padding: 0.166667rem;
}
.files-tab-close:hover { background: var(--bg-hover); color: var(--text-strong); }
.files-content { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.files-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.5rem; color: var(--text-faint); text-align: center; padding: 2rem;
}
.files-empty-title { color: var(--text-dim); font-size: var(--fs-md); }
.files-empty-hint { font-size: var(--fs-base); max-width: 22rem; }
.files-menu-dropdown { min-width: 15rem; }
.files-menu-dropdown .menu-item:disabled { color: var(--text-faint); cursor: default; }
.files-menu-dropdown .menu-item:disabled:hover { background: transparent; }
```

- [ ] **Step 18: RUN**

```bash
npm run typecheck && npm test
```

Expected: all pass.

- [ ] **Step 19: Manual verification with `npm run dev`**

Open a session, then `⋮` → **Files**. Verify each line:

1. The overlay covers the chat pane with the chat visible at its edges; title bar, sidebar and status bar are
   untouched and usable.
2. The tree lists dotfiles and `node_modules`; expanding/collapsing directories works; empty folders show
   `Empty`.
3. Clicking a file opens a tab in the right column with its content (highlight/markdown).
4. Opening a second file adds a tab; clicking a tab switches; the tab's `✕` closes it and the previous tab
   becomes active.
5. Typing `readme` in the filter leaves matching rows plus their parent folders; clearing restores the tree.
6. Typing `?TitleBar` shows `path:line` rows after ~300 ms; clicking one opens that file in a tab; typing
   `?foo(` shows `No matches` without an error.
7. `⤢` fills the pane area (sidebar/title bar/status bar still visible); `⤡` restores the card.
8. `⋮` → Refresh re-reads the tree; Collapse all folds every directory; Close all tabs returns to the empty
   state; Copy path / Reveal in Folder / Open in VS Code act on the active tab (disabled with no tab).
9. `Esc` closes the overlay; the header `✕` closes it; switching project in the sidebar closes it.
10. Right-clicking a tree row shows Copy path first, then Open in VS Code, then Reveal in Folder.

- [ ] **Step 20: Commit**

```bash
git add src/renderer/src/components/files src/renderer/src/components/FileContextMenu.tsx src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/Pane.tsx src/renderer/src/components/SessionPanes.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(files): add the Files overlay with tree, tabs, viewer and pane menu entry"
```

---

### Task 8: Documentation sync and full verification

**Files:**
- `docs/reference/09-ui-guide.md` (PATCH)
- `docs/reference/05-ipc-contract.md` (PATCH)
- `README.md` (PATCH)
- `src/main/AGENTS.md` (PATCH)

- [ ] **Step 1: RUN this to see the exact text to edit**

```bash
grep -n "RightPanel\|right panel\|artifacts\|Explorer" docs/reference/09-ui-guide.md README.md | head -40
```

- [ ] **Step 2: PATCH `docs/reference/09-ui-guide.md`**

Replace the `RightPanel` box in the 9.2 layout diagram with the plain session area, remove `RightPanel` from the
overlays list, and add this subsection right after the layout diagram (keep the existing heading style of the
file):

```markdown
### Files overlay

A pane's `⋮` menu offers **Files**, which opens an in-app explorer over the chat pane area (never an OS window,
so the title bar, sidebar and status bar stay visible). It holds a filterable, lazily loaded directory tree on
the left — dotfiles and `node_modules` are listed — and open files in tabs on the right, next to a header with
focus-filter, `⋮` (Refresh, Collapse all, Close all tabs, Copy path, Reveal in Folder, Open in VS Code),
maximize/restore and close. Typing in the filter narrows the tree by name; a `?` prefix searches file contents
instead and lists `path:line` hits. `⤢` expands the overlay over the whole pane area, `Esc` and `✕` close it,
and switching to another project closes it.

The previous `RightPanel` (directory tree + artifacts) is parked in the source — its components, CSS, state and
the artifact store/IPC remain, but nothing renders it.
```

- [ ] **Step 3: PATCH `docs/reference/05-ipc-contract.md`**

Add the two channels to the file's channel table, matching that table's existing columns:

```markdown
| `files:list-dir` | `filesListDir(projectPath, absPath)` | `DirEntry[]` | Directory listing for the Files overlay; lists dotfiles and `node_modules`, rejected unless `absPath` is inside `projectPath` |
| `files:search` | `filesSearch(projectPath, query)` | `ProjectSearchHit[]` | Content search for the Files overlay; returns `[]` for an empty query, an unknown project or an invalid pattern |
```

- [ ] **Step 4: PATCH `README.md`**

Rewrite the explorer paragraph (line ~36) and the right-panel section (line ~111) so they describe the Files
overlay instead of the right panel: opened from a pane's `⋮` → Files, covers the chat pane area, tree with
dotfiles and `node_modules`, name filter and `?` content search, open-file tabs, `⤢` maximize, and the note that
the old right panel is parked (not rendered) in the source.

- [ ] **Step 5: PATCH `src/main/AGENTS.md`**

In the key-files list, add one bullet in the existing format:

```markdown
- `project-search.ts` — project-wide content search (`searchProject`), shared by the agent's `grep` tool and
  the renderer Files overlay (`files:search`); `dir-lister.ts` additionally exposes `listProjectDir` for the
  overlay's non-ignoring, project-scoped tree.
```

- [ ] **Step 6: RUN the full verification**

```bash
npm run typecheck && npm test
```

Expected: all pass.

- [ ] **Step 7: RUN the e2e check only if a spec references the removed toggle**

```bash
grep -rn "title-bar-panel-toggle\|right-panel" tests/e2e || echo "no e2e dependency"
```

If `no e2e dependency` is printed, skip the e2e run. Otherwise run:

```bash
env -u ELECTRON_RENDERER_URL npm run build && env -u ELECTRON_RENDERER_URL npm run e2e
```

- [ ] **Step 8: Commit**

```bash
git add docs README.md src/main/AGENTS.md
git commit -m "docs: describe the Files overlay"
```

---

## Self-Review Notes

- Spec §3.1 → Task 6; §3.2 → Task 7 Steps 4–16; §3.3 → Task 7 Steps 12–16; §3.4 → Task 7 Steps 3/17;
  §3.5 → Task 7 Steps 2/17 + Task 3; §3.6 → Task 5 + Task 7 Step 3; §3.7 → Tasks 1, 2, 4; §4 → Tasks 1, 2, 3,
  4 tests + Task 7 Step 19; §5 → Task 8.
- Spec Non-Goals respected: no `BrowserWindow`, no line jumping on search hits, no layout switcher, no draggable
  splitter (fixed `20rem` side column), chat path clicks keep opening the `FileViewer` popup.
- Every file appears exactly once per task with its complete final content (`WRITE`) or as an exact
  old-text/new-text pair (`PATCH`); no step requires reading a file to decide what to write.
