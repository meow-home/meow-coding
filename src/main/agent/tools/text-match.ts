export type TextMatch = { start: number; end: number; newline: 'lf' | 'crlf' }

type TextMatchError = { error: 'empty' | 'not-found' | 'ambiguous' | 'mixed-newlines'; count?: number }

function hasMixedNewlines(content: string): boolean {
  const hasCrLf = /\r\n/.test(content)
  const hasBareCr = /\r(?!\n)/.test(content)
  const hasBareLf = /(?<!\r)\n/.test(content)
  return hasBareCr || (hasCrLf && hasBareLf)
}

function normalizedWithOffsets(content: string): { text: string; boundaries: number[] } {
  let text = ''
  const boundaries: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r' && content[i + 1] === '\n') {
      text += '\n'
      boundaries.push(i + 2)
      i++
    } else {
      text += content[i]
      boundaries.push(i + 1)
    }
  }
  return { text, boundaries }
}

export function findUniqueText(content: string, search: string): TextMatch | TextMatchError {
  if (!search) return { error: 'empty' }
  const exact: number[] = []
  let at = content.indexOf(search)
  while (at >= 0) {
    exact.push(at)
    at = content.indexOf(search, at + search.length)
  }
  if (exact.length === 1) {
    return { start: exact[0], end: exact[0] + search.length, newline: content.includes('\r\n') ? 'crlf' : 'lf' }
  }
  if (exact.length > 1) return { error: 'ambiguous', count: exact.length }
  if (!content.includes('\r\n')) return { error: 'not-found' }
  if (hasMixedNewlines(content)) return { error: 'mixed-newlines' }

  const normalized = normalizedWithOffsets(content)
  const normalizedSearch = search.replace(/\r\n/g, '\n')
  const matches: number[] = []
  let normalizedAt = normalized.text.indexOf(normalizedSearch)
  while (normalizedAt >= 0) {
    matches.push(normalizedAt)
    normalizedAt = normalized.text.indexOf(normalizedSearch, normalizedAt + normalizedSearch.length)
  }
  if (matches.length === 0) return { error: 'not-found' }
  if (matches.length > 1) return { error: 'ambiguous', count: matches.length }
  const start = normalized.boundaries[matches[0]]
  const endIndex = matches[0] + normalizedSearch.length
  const end = normalized.boundaries[endIndex]
  return { start, end, newline: 'crlf' }
}

export function formatTextMatchError(error: TextMatchError['error'], count?: number): string {
  switch (error) {
    case 'empty': return 'edit: old_string must not be empty'
    case 'ambiguous': return `edit: old_string matched ${count ?? 2} times; make it unique`
    case 'mixed-newlines': return 'edit: old_string was not found exactly; file contains mixed newline styles, so read the target region and retry'
    default: return 'edit: old_string not found in file; read the target region and retry'
  }
}
