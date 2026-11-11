import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowRight, ChevronDown, Maximize2, Minimize2, RefreshCw, Square, Terminal, Trash2, Users, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentStatus, AlertLevel, BackgroundProcInfo, ChatMessage, MonitorInfo } from '@shared/types'
import ConfirmDialog from '../ConfirmDialog'
import antigravityLogo from '../../assets/antigravity-logo.svg'
import logoMark from '../../assets/logo-mark.png'

/** One session of the panel's project. Only `background` ones become rows: the
 *  session the user is looking at is already on screen behind the panel. */
export interface TasksPanelSession {
  id: string
  name: string
  cwd: string
  mode?: string
  model?: string
  parentAgentId?: string
  status: AgentStatus
  alert: AlertLevel
  exitCode: number | null
  lastOutputAt: number | null
  background: boolean
}

interface Props {
  agentId: string
  sessions: TasksPanelSession[]
  full: boolean
  onToggleFull: () => void
  onClose: () => void
  /** A request from the chat's background tasks card to open one watch. */
  focus?: { monitorId?: string; seq: number } | null
  onFocusApplied?: () => void
  onOpenSession: (id: string) => void
  onStopSession: (id: string) => void
  onRemoveSession: (id: string) => void
}

type TaskRow =
  | { kind: 'session'; key: string; live: boolean; session: TasksPanelSession }
  | { kind: 'shell'; key: string; live: boolean; shell: BackgroundProcInfo }
  | { kind: 'monitor'; key: string; live: boolean; monitor: MonitorInfo }

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function ago(at: number | null | undefined, now: number): string {
  if (!at) return '—'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function rowLabel(row: TaskRow): string {
  if (row.kind === 'session') return row.session.name
  if (row.kind === 'shell') return row.shell.command
  return row.monitor.label
}

function rowSub(row: TaskRow): string {
  if (row.kind === 'session') return row.session.parentAgentId ? 'sub-session' : 'session'
  if (row.kind === 'shell') return `shell · ${row.shell.id}`
  return `${row.monitor.cliAgentId ?? row.monitor.kind} · ${row.monitor.targetId}`
}

/** The card's identity badge: what is running, not its state (the chip says that). */
type RowAvatar =
  | { cls: string; image: string; label: string }
  | { cls: string; icon: LucideIcon; label: string }

function rowAvatar(row: TaskRow): RowAvatar {
  if (row.kind === 'session') {
    return row.session.parentAgentId
      ? { cls: 'sub', icon: Users, label: 'Sub-session' }
      : { cls: 'agent', image: logoMark, label: 'Meow session' }
  }
  if (row.kind === 'shell') return { cls: 'shell', icon: Terminal, label: 'Background shell' }
  const m = row.monitor
  if (m.cliAgentId) return { cls: 'cli', image: antigravityLogo, label: 'Antigravity CLI' }
  if (m.kind === 'poll') return { cls: 'poll', icon: RefreshCw, label: 'Polled command' }
  return { cls: 'sub', icon: Users, label: 'Delegation' }
}

/** State chip: the text is the state itself, the class only colours it. */
function rowState(row: TaskRow): { text: string; cls: string } {
  if (row.kind === 'session') {
    const s = row.session
    if (s.status === 'spawning') return { text: 'starting', cls: 'run' }
    if (s.status === 'running') return { text: 'running', cls: 'run' }
    if (s.status === 'idle') return { text: 'waiting for you', cls: 'attention' }
    if (s.status === 'error') return { text: 'error', cls: 'error' }
    return { text: s.exitCode !== null ? `stopped · exit ${s.exitCode}` : 'stopped', cls: '' }
  }
  if (row.kind === 'shell') {
    const s = row.shell
    return s.status === 'running'
      ? { text: 'running', cls: 'run' }
      : { text: s.exitCode !== null ? `exited · ${s.exitCode}` : 'exited', cls: '' }
  }
  const m = row.monitor
  if (m.status === 'watching') return { text: 'waiting', cls: 'wait' }
  return { text: m.reason ?? 'done', cls: m.reason === 'timeout' ? 'timeout' : 'done' }
}

function rowMeta(row: TaskRow, now: number): string {
  if (row.kind === 'session') {
    const s = row.session
    return s.status === 'running' || s.status === 'spawning'
      ? `active ${ago(s.lastOutputAt, now)}`
      : ago(s.lastOutputAt, now)
  }
  if (row.kind === 'shell') {
    if (row.shell.status !== 'running') return `exit ${row.shell.exitCode ?? '?'}`
    return row.shell.startedAt ? elapsed(now - row.shell.startedAt) : '—'
  }
  const m = row.monitor
  return m.status === 'watching' ? elapsed(now - m.startedAt) : ago(m.resolvedAt, now)
}

/** Last two messages of a background session — the row's "content" while it runs. */
function SessionPreview({ agentId }: { agentId: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)

  useEffect(() => {
    let alive = true
    setMessages(null)
    void window.api.listChatMessages(agentId)
      .then(list => { if (alive) setMessages(list.slice(-2)) })
      .catch(() => { if (alive) setMessages([]) })
    return () => { alive = false }
  }, [agentId])

  if (!messages) return <div className="tasks-preview tasks-preview-empty">Loading…</div>
  if (messages.length === 0) return <div className="tasks-preview tasks-preview-empty">No messages yet.</div>
  return (
    <div className="tasks-preview">
      {messages.map(m => (
        <div key={m.id} className="tasks-msg">
          <span className={`tasks-msg-role${m.role === 'assistant' ? ' assistant' : ''}`}>
            {m.role === 'assistant' ? 'meow' : 'you'}
          </span>
          <span className="tasks-msg-text">{m.displayText ?? m.text}</span>
        </div>
      ))}
    </div>
  )
}

/** Live output of one background shell. Mounted only while its row is open, so
 *  the subscription follows the row exactly (no polling while collapsed). */
function ShellOutput({ id }: { id: string }) {
  const [output, setOutput] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    setOutput('')
    void window.api.backgroundProcSubscribe(id).then(res => { if (alive && res) setOutput(res.backlog) })
    const offData = window.api.onBackgroundProcData(e => { if (e.id === id) setOutput(prev => prev + e.chunk) })
    return () => {
      alive = false
      offData()
      void window.api.backgroundProcUnsubscribe(id)
    }
  }, [id])

  useEffect(() => {
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  return (
    <>
      <div className="tasks-block-label">
        <span>Output</span>
        <span className="tasks-live"><span className="tasks-dot run" aria-hidden="true" />live</span>
        <span className="tasks-block-spacer" />
        <button className="tasks-mini" onClick={() => void navigator.clipboard.writeText(output)}>Copy</button>
      </div>
      <pre ref={preRef} className="tasks-output">{output || '(no output yet)'}</pre>
    </>
  )
}

/**
 * The session's Tasks panel (right-hand column): background sessions, background
 * shells, polled commands and delegations, one card each. A card opens with an
 * identity badge (native session, sub-session, shell, poll, Antigravity CLI),
 * then a title line (wraps), its kind · id line, a state chip and age, plus a
 * stop icon while it runs; clicking it expands the card in place to its facts,
 * content (messages / live output / result) and actions. There are no tabs: the
 * list itself is the navigation.
 */
export default function TasksPanel({
  agentId, sessions, full, onToggleFull, onClose,
  focus, onFocusApplied, onOpenSession, onStopSession, onRemoveSession
}: Props) {
  const [shells, setShells] = useState<BackgroundProcInfo[]>([])
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [nextShells, nextMonitors] = await Promise.all([
          window.api.backgroundProcsList(agentId),
          window.api.monitorsList(agentId)
        ])
        if (!alive) return
        setShells(nextShells)
        setMonitors(nextMonitors)
      } catch {
        // Keep the last list: a transient IPC failure must not empty the sheet.
      }
    }
    void load()
    const timer = setInterval(() => void load(), 1500)
    return () => { alive = false; clearInterval(timer) }
  }, [agentId])

  useEffect(() => {
    setExpanded(new Set())
  }, [agentId])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!focus) return
    if (focus.monitorId) {
      const key = `monitor:${focus.monitorId}`
      setExpanded(prev => new Set(prev).add(key))
    }
    onFocusApplied?.()
  }, [focus?.seq])

  const rows = useMemo<TaskRow[]>(() => {
    const out: TaskRow[] = []
    for (const session of sessions) {
      if (!session.background) continue
      const live = session.status !== 'exited' && session.status !== 'stopped' && session.status !== 'error'
      out.push({ kind: 'session', key: `session:${session.id}`, live, session })
    }
    for (const shell of shells) {
      out.push({ kind: 'shell', key: `shell:${shell.id}`, live: shell.status === 'running', shell })
    }
    for (const monitor of monitors) {
      out.push({ kind: 'monitor', key: `monitor:${monitor.id}`, live: monitor.status === 'watching', monitor })
    }
    return out
  }, [sessions, shells, monitors])

  const activeRows = rows.filter(r => r.live)
  const finishedRows = rows.filter(r => !r.live)
  const openable = useMemo(() => new Set(sessions.map(s => s.id)), [sessions])

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Esc closes the open rows first, then the panel — the pane keeps its focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (expanded.size > 0) setExpanded(new Set())
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded, onClose])

  const target = pendingRemove ? sessions.find(s => s.id === pendingRemove) ?? null : null

  /** One stop action per row kind: the card's icon button and the body's red action. */
  const stopRow = (row: TaskRow) => {
    if (row.kind === 'session') onStopSession(row.session.id)
    else if (row.kind === 'shell') void window.api.backgroundProcKill(row.shell.id)
    else void window.api.monitorsCancel(row.monitor.id)
  }

  const stopTitle = (row: TaskRow): string =>
    row.kind === 'session' ? 'Stop session' : row.kind === 'shell' ? 'Kill process' : 'Stop watching'

  const renderRow = (row: TaskRow) => {
    const isOpen = expanded.has(row.key)
    const avatar = rowAvatar(row)
    const state = rowState(row)
    const bodyId = `tasks-body-${row.key.replace(':', '-')}`
    return (
      <div className={`tasks-row${isOpen ? ' open' : ''}${row.kind === 'session' && row.session.alert !== 'normal' ? ' attention' : ''}`} key={row.key}>
        <div className="tasks-row-top">
          <button
            className="tasks-row-head"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => toggle(row.key)}
          >
            <span className="tasks-row-main">
              <span className={`tasks-avatar ${avatar.cls}`} title={avatar.label} aria-hidden="true">
                {'image' in avatar
                  ? <img src={avatar.image} alt="" />
                  : <avatar.icon size={14} aria-hidden="true" />}
              </span>
              <span className="tasks-row-text">
                <span className={`tasks-label${row.kind === 'session' ? '' : ' mono'}`}>{rowLabel(row)}</span>
                <span className="tasks-sub">{rowSub(row)}</span>
              </span>
            </span>
            <span className="tasks-row-aside">
              <span className={`tasks-state${state.cls ? ` ${state.cls}` : ''}`}>{state.text}</span>
              <span className="tasks-meta">{rowMeta(row, now)}</span>
            </span>
            <span className="tasks-caret" aria-hidden="true"><ChevronDown size={12} /></span>
          </button>
          {row.live && (
            <button
              className="tasks-card-stop"
              title={stopTitle(row)}
              aria-label={stopTitle(row)}
              onClick={() => stopRow(row)}
            >
              <Square size={11} fill="currentColor" aria-hidden="true" />
            </button>
          )}
        </div>

        {isOpen && (
          <div className="tasks-row-body" id={bodyId}>
            {row.kind === 'session' && (
              <>
                <div className="tasks-meta-line">
                  <b>{row.session.mode ?? 'build'}</b>
                  <span className="tasks-meta-sep">·</span>
                  {row.session.model ?? 'default model'}
                  <span className="tasks-meta-sep">·</span>
                  {row.session.cwd}
                  <span className="tasks-meta-sep">·</span>
                  {row.session.id.slice(0, 8)}
                </div>
                <div className="tasks-block-label">Last messages</div>
                <SessionPreview agentId={row.session.id} />
                <div className="tasks-actions">
                  <button className="tasks-act primary" onClick={() => onOpenSession(row.session.id)}>
                    <ArrowRight size={11} aria-hidden="true" />
                    {row.live ? 'Open session' : 'Open transcript'}
                  </button>
                  {row.live && (
                    <button className="tasks-act stop" onClick={() => onStopSession(row.session.id)}>
                      <Square size={10} aria-hidden="true" />
                      Stop
                    </button>
                  )}
                  <button className="tasks-act danger" onClick={() => setPendingRemove(row.session.id)}>
                    <Trash2 size={11} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </>
            )}

            {row.kind === 'shell' && (
              <>
                <dl className="tasks-kv">
                  <dt>Command</dt><dd>{row.shell.command}</dd>
                  <dt>CWD</dt><dd>{row.shell.cwd}</dd>
                  {row.shell.startedAt ? (
                    <>
                      <dt>Started</dt><dd>{clock(row.shell.startedAt)} · {ago(row.shell.startedAt, now)}</dd>
                    </>
                  ) : null}
                  {row.shell.status === 'exited' && (
                    <>
                      <dt>Exit</dt><dd>{row.shell.exitCode ?? '?'}</dd>
                    </>
                  )}
                </dl>
                <ShellOutput id={row.shell.id} />
                <div className="tasks-actions">
                  {row.live && (
                    <button className="tasks-act stop" onClick={() => void window.api.backgroundProcKill(row.shell.id)}>
                      <Square size={10} aria-hidden="true" />
                      Kill process
                    </button>
                  )}
                </div>
              </>
            )}

            {row.kind === 'monitor' && (
              <>
                <dl className="tasks-kv">
                  <dt>Kind</dt><dd>{row.monitor.cliAgentId ? 'antigravity delegation' : row.monitor.kind === 'poll' ? 'polled command' : row.monitor.kind === 'delegation' ? 'delegation' : 'background shell'}</dd>
                  <dt>Until</dt><dd>{row.monitor.until || '—'}</dd>
                  <dt>Started</dt><dd>{clock(row.monitor.startedAt)} · {ago(row.monitor.startedAt, now)}</dd>
                  <dt>Session</dt><dd>{row.monitor.sessionId.slice(0, 8)}</dd>
                  {row.monitor.status === 'resolved' && (
                    <>
                      <dt>Finished</dt>
                      <dd>{row.monitor.resolvedAt ? `${clock(row.monitor.resolvedAt)} · ${ago(row.monitor.resolvedAt, now)}` : '—'}</dd>
                    </>
                  )}
                </dl>
                {row.monitor.status === 'resolved' && (
                  <>
                    <div className="tasks-block-label">Result</div>
                    <div className={`tasks-result${row.monitor.reason === 'timeout' ? ' warn' : ''}`}>
                      {row.monitor.detail || row.monitor.reason || '—'}
                    </div>
                  </>
                )}
                <div className="tasks-actions">
                  <button
                    className={`tasks-act${row.live ? ' stop' : ''}`}
                    onClick={() => void window.api.monitorsCancel(row.monitor.id)}
                  >
                    {row.live ? 'Stop watching' : 'Dismiss'}
                  </button>
                  {row.monitor.kind === 'delegation' && openable.has(row.monitor.targetId) && (
                    <button className="tasks-act" onClick={() => onOpenSession(row.monitor.targetId)}>
                      Open session
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className={`tasks-panel${full ? ' full' : ''}`} aria-label="Tasks">
      <div className="tasks-head">
        <span className="tasks-head-icon" aria-hidden="true"><Activity size={13} /></span>
        <span className="tasks-title">Tasks</span>
        <span className="tasks-count">{rows.length}</span>
        <span className="tasks-head-spacer" />
        <button
          className="tasks-icon-btn"
          title={full ? 'Restore' : 'Maximize'}
          aria-label={full ? 'Restore' : 'Maximize'}
          onClick={onToggleFull}
        >
          {full ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
        </button>
        <button className="tasks-icon-btn" title="Close Tasks" aria-label="Close Tasks" onClick={onClose}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="tasks-body">
        {rows.length === 0 && (
          <div className="tasks-empty">
            No tasks — background shells, polls, delegations and background sessions show up here.
          </div>
        )}
        {activeRows.length > 0 && (
          <>
            <div className="tasks-group">
              <span className="tasks-group-label">Active</span>
              <span className="tasks-group-count">{activeRows.length}</span>
            </div>
            {activeRows.map(renderRow)}
          </>
        )}
        {finishedRows.length > 0 && (
          <>
            <div className="tasks-group">
              <span className="tasks-group-label">Finished</span>
              <span className="tasks-group-count">{finishedRows.length}</span>
            </div>
            {finishedRows.map(renderRow)}
          </>
        )}
      </div>

      {target && (
        <ConfirmDialog
          title="Delete session"
          message={`Delete session "${target.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { onRemoveSession(target.id); setPendingRemove(null) }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </section>
  )
}
