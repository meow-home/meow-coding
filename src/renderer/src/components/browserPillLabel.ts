import type { BrowserStatusInfo } from '@shared/browser-types'

export type BrowserPillTone = 'builtin' | 'paired' | 'waiting' | 'offline'

export interface BrowserPill {
  text: string
  tone: BrowserPillTone
}

/**
 * The status-bar pill. With the built-in backend the Chrome bridge state is
 * irrelevant, except that a pending extension approval still wins (the dialog
 * auto-opens for it and the agent may be waiting).
 */
export function browserPillLabel(
  backend: 'builtin' | 'chrome' | undefined,
  status: BrowserStatusInfo | null | undefined
): BrowserPill {
  if ((backend ?? 'builtin') === 'builtin') {
    if (status?.pendingExtension) return { text: 'browser: approval needed', tone: 'waiting' }
    return { text: 'browser: built-in', tone: 'builtin' }
  }
  if (status?.paired) return { text: 'browser: paired', tone: 'paired' }
  if (status?.pendingExtension) return { text: 'browser: approval needed', tone: 'waiting' }
  if (status?.status === 'listening' || status?.status === 'idle') return { text: 'browser: waiting', tone: 'waiting' }
  return { text: 'browser: off', tone: 'offline' }
}
