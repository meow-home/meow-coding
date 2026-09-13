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
