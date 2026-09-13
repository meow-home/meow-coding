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
