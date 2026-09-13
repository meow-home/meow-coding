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
