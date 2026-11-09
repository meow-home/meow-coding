import type { GitFileChange, GitStatusDetail } from '@shared/types'

export type GitLetter = 'M' | 'A' | 'D' | 'R' | 'T' | 'U'
export type GitDecorationKind = 'added' | 'modified' | 'deleted'

export interface GitDecoration {
  letter: GitLetter
  kind: GitDecorationKind
  /** Porcelain listed an untracked directory (`dir/`): every path below it is untracked too. */
  directory?: boolean
}

export interface GitDecorations {
  /** Project-relative, forward-slash path → decoration. */
  files: Record<string, GitDecoration>
  /** Ancestor directories of changed entries; a directory row shows a dot. */
  dirs: Set<string>
}

export const EMPTY_GIT_DECORATIONS: GitDecorations = { files: {}, dirs: new Set() }

const STATUS: Record<GitFileChange['status'], { letter: GitLetter; kind: GitDecorationKind }> = {
  added: { letter: 'A', kind: 'added' },
  untracked: { letter: 'U', kind: 'added' },
  modified: { letter: 'M', kind: 'modified' },
  renamed: { letter: 'R', kind: 'modified' },
  typechange: { letter: 'T', kind: 'modified' },
  deleted: { letter: 'D', kind: 'deleted' }
}

// Porcelain C-quotes paths with special characters. Octal-escaped non-ASCII
// paths stay escaped (and therefore unmatched) on purpose: decoding them would
// need the repository's encoding, and a missing decoration is harmless.
function unquote(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  return raw.slice(1, -1).replace(/\\(["\\])/g, '$1')
}

function normalizePath(raw: string): { path: string; directory: boolean } {
  let path = raw.trim()
  // A rename renders as "old -> new"; the row for the new path is the one to mark.
  const arrow = path.lastIndexOf(' -> ')
  if (arrow >= 0) path = path.slice(arrow + 4)
  path = unquote(path)
  const directory = path.endsWith('/')
  if (directory) path = path.replace(/\/+$/, '')
  return { path, directory }
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

export function buildGitDecorations(detail: GitStatusDetail | null): GitDecorations {
  const files: Record<string, GitDecoration> = {}
  const dirs = new Set<string>()
  if (!detail) return { files, dirs }
  for (const change of detail.files) {
    const { path, directory } = normalizePath(change.path)
    if (!path) continue
    const status = STATUS[change.status] ?? { letter: 'M', kind: 'modified' }
    files[path] = directory ? { ...status, directory: true } : { ...status }
    for (const ancestor of ancestorsOf(path)) dirs.add(ancestor)
  }
  return { files, dirs }
}

/** The decoration for a file row, including paths inside an untracked directory. */
export function decorationFor(decorations: GitDecorations, relPath: string): GitDecoration | null {
  const exact = decorations.files[relPath]
  if (exact) return exact
  for (const ancestor of ancestorsOf(relPath)) {
    const dec = decorations.files[ancestor]
    if (dec?.directory) return dec
  }
  return null
}

/**
 * The decoration for a directory row. Ancestors are only known as a set, so a
 * directory that merely holds changes reads as "modified".
 */
export function directoryDecoration(decorations: GitDecorations, relPath: string): GitDecoration | null {
  return decorations.files[relPath] ?? (decorations.dirs.has(relPath) ? { letter: 'M', kind: 'modified' } : null)
}

/** Project-relative, forward-slash form of an absolute tree entry path. */
export function projectRelativePath(projectPath: string, absPath: string): string {
  const toPosix = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const root = toPosix(projectPath)
  const target = toPosix(absPath)
  if (target === root) return ''
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target
}
