import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ChevronDown, RefreshCw, Terminal, Users, X } from 'lucide-react'
import type { MonitorInfo } from '@shared/types'

interface Props {
  agentId: string
  /** Opens the Monitors pane; a row passes its own monitor id. */
  onOpenPane: (monitorId?: string) => void
}

const KIND_ICON = { shell: Terminal, poll: RefreshCw, delegation: Users } as const

function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

/**
 * One chat feed item listing every async watch of the session — background
 * shells, polled commands and delegations. It keeps a stable position in the
 * feed (never a new item per update) and refreshes on the `monitorsChanged`
 * push event, so a running watch never makes the transcript jump.
 */
export default function BackgroundTasksCard({ agentId, onOpenPane }: Props) {
  const [tasks, setTasks] = useState<MonitorInfo[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const load = () => {
      void window.api.monitorsList(agentId).then(list => { if (alive) setTasks(list) })
    }
    load()
    const off = window.api.onMonitorsChanged(e => { if (e.agentId === agentId) load() })
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { alive = false; off(); clearInterval(tick) }
  }, [agentId])

  const watching = useMemo(() => tasks.filter(t => t.status === 'watching'), [tasks])
  const done = useMemo(() => tasks.filter(t => t.status === 'resolved'), [tasks])

  const stop = useCallback((id: string) => {
    void window.api.monitorsCancel(id)
  }, [])

  // Nothing running means nothing to report: the card lives only while a watch
  // is active. Resolved rows still show while another watch runs, and stay in
  // the Monitors pane after the card is gone.
  if (watching.length === 0) return null

  const summary = [
    watching.length > 0 ? `${watching.length} running` : null,
    done.length > 0 ? `${done.length} done` : null
  ].filter(Boolean).join(' · ')

  return (
    <section className={`chat-tasks${watching.length > 0 ? ' live' : ''}${collapsed ? ' collapsed' : ''}`} aria-label="Background tasks">
      <div className="chat-tasks-head">
        <span className="chat-tasks-icon" aria-hidden="true"><Activity size={13} /></span>
        <span className="chat-tasks-title">Background tasks</span>
        <span className="chat-tasks-summary">{summary}</span>
        <span className="chat-tasks-dots" aria-hidden="true">
          {watching.map(t => <span key={t.id} className="chat-tasks-dot run" />)}
          {done.map(t => <span key={t.id} className={`chat-tasks-dot ${t.reason === 'timeout' ? 'warn' : 'ok'}`} />)}
        </span>
        <span className="chat-tasks-right">
          <button className="chat-tasks-open" onClick={() => onOpenPane()}>Open pane</button>
          <button
            className="chat-tasks-caret"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand background tasks' : 'Collapse background tasks'}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed(v => !v)}
          >
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="chat-tasks-rows">
          {tasks.map(t => {
            const Icon = KIND_ICON[t.kind]
            const live = t.status === 'watching'
            return (
              <div
                key={t.id}
                className="chat-tasks-row"
                role="button"
                tabIndex={0}
                title={`${t.kind} ${t.id}`}
                onClick={() => onOpenPane(t.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPane(t.id) }
                }}
              >
                <span className="chat-tasks-kind" aria-hidden="true"><Icon size={12} /></span>
                <span className="chat-tasks-name">{t.label}</span>
                <span className="chat-tasks-target">
                  {t.kind === 'delegation' ? `delegation ${t.id}` : t.kind === 'shell' ? `proc ${t.targetId}` : t.until}
                </span>
                <span className="chat-tasks-state">
                  <span className={live ? 'run' : t.reason === 'timeout' ? 'warn' : 'ok'}>
                    {live ? 'waiting' : (t.reason ?? 'done')}
                  </span>
                  {live ? elapsed(t.startedAt, now) : ago(t.resolvedAt ?? t.startedAt, now)}
                </span>
                <button
                  className="chat-tasks-stop"
                  title={live ? 'Stop watching' : 'Dismiss'}
                  aria-label={live ? `Stop watching ${t.label}` : `Dismiss ${t.label}`}
                  onClick={e => { e.stopPropagation(); stop(t.id) }}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="chat-tasks-foot">
        <span>Updates live · outside this turn&apos;s steps</span>
        <button className="chat-tasks-link" onClick={() => onOpenPane()}>Open pane →</button>
      </div>
    </section>
  )
}
