import { isLoopback } from '@shared/loopback'

export interface LoopbackLink {
  /** 0-based index of the first character. */
  start: number
  /** 0-based index after the last character. */
  end: number
  url: string
}

const CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi

/** Trailing sentence punctuation and a closing bracket do not belong to the URL. */
function trimTail(candidate: string): string {
  let end = candidate.length
  while (end > 0 && '.,;:!?\'")]}'.includes(candidate[end - 1])) end--
  return candidate.slice(0, end)
}

/**
 * Loopback http(s) URLs in one terminal row. A URL cut by a line wrap still parses
 * (`http://localhost:5173/some/lo`), so with `continuesOnNextRow` a link reaching
 * the end of the row is dropped rather than opening the wrong path. Columns are
 * string indices; wide characters shift xterm cells, so a row containing them may
 * be off by one per wide character.
 */
export function findLoopbackLinks(line: string, continuesOnNextRow = false): LoopbackLink[] {
  const links: LoopbackLink[] = []
  CANDIDATE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CANDIDATE.exec(line)) !== null) {
    const raw = match[0]
    const url = trimTail(raw)
    if (!url) continue
    if (continuesOnNextRow && match.index + raw.length === line.length) continue
    try {
      const parsed = new URL(url)
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopback(parsed.origin)) continue
    } catch {
      continue
    }
    links.push({ start: match.index, end: match.index + url.length, url })
  }
  return links
}
