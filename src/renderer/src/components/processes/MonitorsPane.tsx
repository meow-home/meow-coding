import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Terminal, Users } from 'lucide-react'
import type { MonitorInfo } from '@shared/types'

interface Props {
  monitors: MonitorInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const KIND_ICON = { shell: Terminal, poll: RefreshCw, delegation: Users } as const
const KIND_LABEL = { shell: 'background shell', poll: 'polled command', delegation: 'delegation' } as const

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** List + detail of the session's async watches, shown in the Processes panel's Monitors tab. */
export default function MonitorsPane({ monitors, selectedId, onSelect }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const selected = useMemo(
    () => monitors.find(m => m.id === selectedId) ?? monitors[0] ?? null,
    [monitors, selectedId]
  )

  if (monitors.length === 0) {
    return (
      <div className="files-empty">
        <Terminal size={30} aria-hidden="true" />
        <div className="files-empty-title">No background tasks</div>
        <div className="files-empty-hint">Background shells, polls and delegations show up here while they run.</div>
      </div>
    )
  }

  return (
    <div className="monitors-pane">
      <div className="monitors-list">
        {monitors.map(m => {
          const Icon = KIND_ICON[m.kind]
          const live = m.status === 'watching'
          return (
            <button
              key={m.id}
              className={`monitors-item${selected?.id === m.id ? ' active' : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <span className="monitors-item-top">
                <Icon size={12} aria-hidden="true" />
                <span className="monitors-item-name">{m.label}</span>
                <span className={`monitors-item-state ${live ? 'run' : m.reason === 'timeout' ? 'warn' : 'ok'}`}>
                  {live ? 'waiting' : (m.reason ?? 'done')}
                </span>
              </span>
              <span className="monitors-item-sub">
                {m.kind} {m.kind === 'poll' ? 'command' : m.targetId}
              </span>
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="monitors-detail">
          <div className="monitors-detail-head">
            <span className="monitors-detail-title">{selected.label}</span>
            <span className={`monitors-item-state ${selected.status === 'watching' ? 'run' : selected.reason === 'timeout' ? 'warn' : 'ok'}`}>
              {selected.status === 'watching' ? 'waiting' : (selected.reason ?? 'done')}
            </span>
          </div>
          <dl className="monitors-kv">
            <dt>Kind</dt><dd>monitor · {KIND_LABEL[selected.kind]}</dd>
            <dt>Target</dt><dd>{selected.targetId}</dd>
            <dt>Until</dt><dd>{selected.until || '—'}</dd>
            <dt>Started</dt><dd>{clock(selected.startedAt)} · {elapsed(selected.startedAt, now)} ago</dd>
            <dt>Session</dt><dd>{selected.sessionId.slice(0, 8)}</dd>
            {selected.status === 'resolved' && (
              <>
                <dt>Finished</dt>
                <dd>{selected.resolvedAt ? `${clock(selected.resolvedAt)} · ${elapsed(selected.resolvedAt, now)} ago` : '—'}</dd>
                <dt>Result</dt><dd className="monitors-result">{selected.detail || '—'}</dd>
              </>
            )}
          </dl>
          <div className="monitors-actions">
            <button
              className="btn small"
              onClick={() => void window.api.monitorsCancel(selected.id)}
            >
              {selected.status === 'watching' ? 'Stop watching' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
