import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Skull, Terminal, X } from 'lucide-react'
import type { BackgroundProcInfo, MonitorInfo } from '@shared/types'

export const PROCESSES_MIN_WIDTH = 320
export const PROCESSES_MAX_WIDTH = 900
export const PROCESSES_DEFAULT_WIDTH = 420

interface Props {
  agentId: string
  full: boolean
  width: number
  onWidthChange: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
}

export default function ProcessesOverlay({ agentId, full, width, onWidthChange, onToggleFull, onClose }: Props) {
  const [shells, setShells] = useState<BackgroundProcInfo[]>([])
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const outRef = useRef<HTMLPreElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(PROCESSES_MAX_WIDTH, Math.max(PROCESSES_MIN_WIDTH, dragRef.current.startWidth + delta))
      onWidthChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  // Poll the lists while open.
  useEffect(() => {
    let alive = true
    const load = async () => {
      const [s, m] = await Promise.all([window.api.backgroundProcsList(agentId), window.api.monitorsList(agentId)])
      if (!alive) return
      setShells(s)
      setMonitors(m)
      setSelected(cur => (cur && s.some(x => x.id === cur) ? cur : (s[0]?.id ?? null)))
    }
    void load()
    const t = setInterval(() => void load(), 1500)
    return () => { alive = false; clearInterval(t) }
  }, [agentId])

  // Stream the selected shell's output.
  useEffect(() => {
    if (!selected) { setOutput(''); return }
    let alive = true
    setOutput('')
    void window.api.backgroundProcSubscribe(selected).then(res => { if (alive && res) setOutput(res.backlog) })
    const offData = window.api.onBackgroundProcData(e => { if (e.id === selected) setOutput(prev => prev + e.chunk) })
    const offExit = window.api.onBackgroundProcExit(e => {
      if (e.id === selected) setShells(prev => prev.map(s => s.id === e.id ? { ...s, status: 'exited', exitCode: e.exitCode } : s))
    })
    return () => {
      alive = false
      offData()
      offExit()
      void window.api.backgroundProcUnsubscribe(selected)
    }
  }, [selected])

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      className={`files-overlay processes-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : { width }}
      role="dialog"
      aria-label="Processes"
    >
      {!full && <div className="files-resizer" onMouseDown={startDrag} />}
      <div className="files-head title-bar">
        <div className="files-head-title">
          <Terminal size={14} aria-hidden="true" />
          <span>Processes</span>
        </div>
        <div className="files-head-actions">
          <button className="icon-btn" title={full ? 'Restore size' : 'Expand'} aria-label={full ? 'Restore size' : 'Expand'} onClick={onToggleFull}>
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Processes" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="files-body">
        <div className="files-side processes-side">
          <div className="processes-group-title">Shells</div>
          {shells.length === 0 && <div className="processes-empty">No background shells.</div>}
          {shells.map(s => (
            <div
              key={s.id}
              className={`processes-row${s.id === selected ? ' active' : ''}`}
              onClick={() => setSelected(s.id)}
            >
              <span className={`status-dot status-${s.status === 'running' ? 'busy' : 'idle'}`} />
              <span className="processes-cmd" title={s.id}>{s.command}</span>
              {s.status === 'exited' && <span className="processes-exit">exit {s.exitCode ?? '?'}</span>}
              {s.status === 'running' && (
                <button
                  className="icon-btn processes-kill"
                  title="Kill"
                  aria-label={`Kill ${s.command}`}
                  onClick={ev => { ev.stopPropagation(); void window.api.backgroundProcKill(s.id) }}
                >
                  <Skull size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <div className="processes-group-title">Monitors</div>
          {monitors.length === 0 && <div className="processes-empty">No active monitors.</div>}
          {monitors.map(m => (
            <div key={m.id} className="processes-row processes-monitor" title={`monitor ${m.id}`}>
              <span className="status-dot status-busy" />
              <span className="processes-cmd">→ {m.targetId}</span>
              <span className="processes-until">{m.until}</span>
            </div>
          ))}
        </div>
        <div className="files-main processes-main">
          {selected ? (
            <pre ref={outRef} className="processes-output">{output || '(no output yet)'}</pre>
          ) : (
            <div className="files-empty">
              <Terminal size={30} aria-hidden="true" />
              <div className="files-empty-title">No shell selected</div>
              <div className="files-empty-hint">Start one with a background bash command, then pick it on the left.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
