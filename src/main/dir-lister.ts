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
