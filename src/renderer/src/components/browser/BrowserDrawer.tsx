import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserTabInfo } from '@shared/browser-types'
import { logsChanged, LogPoller } from './drawer-logs'

type Kind = 'console' | 'network'

interface Props {
  agentId: string
  tab: BrowserTabInfo | null
}

interface ConsoleEntry { level: string; text: string }
interface NetworkEntry { method: string; url: string; status: number | 'failed' }

const MAX_ENTRIES = 200
const SEND_CAP = 100

function isConsoleError(entry: ConsoleEntry): boolean {
  return entry.level === 'error'
}

export default function BrowserDrawer({ agentId, tab }: Props) {
  const [kind, setKind] = useState<Kind>('console')
  const [rows, setRows] = useState<Array<ConsoleEntry | NetworkEntry>>([])
  const [errorCount, setErrorCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const tabId = tab?.id ?? null

  const fetchLogs = useCallback(async () => {
    if (tabId == null) return
    const next = (await window.api.browserTabLogs(tabId, kind, MAX_ENTRIES)) as Array<ConsoleEntry | NetworkEntry>
    if (kind === 'console') setErrorCount(next.filter(entry => isConsoleError(entry as ConsoleEntry)).length)
    setRows(prev => (logsChanged(prev, next) ? next : prev))
  }, [tabId, kind])

  // One timer while open; restarts (and refetches immediately) on tab or kind change.
  useEffect(() => {
    if (tabId == null) return
    setRows([])
    pinnedRef.current = true
    const poller = new LogPoller({ fetch: fetchLogs, isHidden: () => document.hidden })
    poller.start()
    return () => poller.stop()
  }, [tabId, kind, fetchLogs])

  useEffect(() => {
    const list = listRef.current
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight
  }, [rows])

  const sendToChat = (): void => {
    if (!tab || rows.length === 0) return
    const lines = kind === 'console'
      ? (rows as ConsoleEntry[]).map(entry => `[${entry.level}] ${entry.text}`)
      : (rows as NetworkEntry[]).map(entry => `${entry.method} ${entry.status} ${entry.url}`)
    const text = ['```text', tab.url, ...lines.slice(-SEND_CAP), '```'].join('\n')
    window.dispatchEvent(new CustomEvent('meow:composer-insert', { detail: { agentId, text } }))
  }

  const label = kind === 'console' ? 'No console messages' : 'No requests'

  return (
    <section className="browser-drawer" aria-label="Console and network">
      <div className="browser-drawer-head">
        <div className="browser-drawer-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={kind === 'console'}
            className={`browser-drawer-tab${kind === 'console' ? ' active' : ''}`}
            onClick={() => setKind('console')}
          >
            Console
            {errorCount > 0 && <span className="browser-drawer-count">{errorCount}</span>}
          </button>
          <button
            role="tab"
            aria-selected={kind === 'network'}
            className={`browser-drawer-tab${kind === 'network' ? ' active' : ''}`}
            onClick={() => setKind('network')}
          >
            Network
          </button>
        </div>
        <button className="btn small" onClick={sendToChat} disabled={rows.length === 0}>
          Send to chat
        </button>
      </div>
      <div
        className="browser-drawer-list"
        ref={listRef}
        onScroll={() => {
          const list = listRef.current
          if (!list) return
          pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40
        }}
      >
        {rows.length === 0 && <div className="browser-drawer-empty">{label}</div>}
        {kind === 'console'
          ? (rows as ConsoleEntry[]).map((entry, i) => (
            <div key={i} className={`browser-drawer-row level-${entry.level}`}>
              <span className="browser-drawer-level">{entry.level}</span>
              <span className="browser-drawer-text">{entry.text}</span>
            </div>
          ))
          : (rows as NetworkEntry[]).map((entry, i) => (
            <div
              key={i}
              className={`browser-drawer-row${entry.status === 'failed' || entry.status >= 400 ? ' level-error' : ''}`}
            >
              <span className="browser-drawer-method">{entry.method}</span>
              <span className="browser-drawer-status">{entry.status}</span>
              <span className="browser-drawer-text">{entry.url}</span>
            </div>
          ))}
      </div>
    </section>
  )
}
