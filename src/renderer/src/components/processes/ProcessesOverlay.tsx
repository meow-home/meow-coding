import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Square, Terminal } from 'lucide-react'
import type { BackgroundProcInfo, MonitorInfo } from '@shared/types'
import PanelHeader from '../common/PanelHeader'

export const PROCESSES_MIN_WIDTH = 320
export const PROCESSES_MAX_WIDTH = 900
export const PROCESSES_DEFAULT_WIDTH = 420

const MONITORS_TAB = 'monitors'

interface Props {
  agentId: string
  full: boolean
  width?: number
  onWidthChange?: (width: number) => void
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
  const showingMonitors = selected === MONITORS_TAB
  const selectedShell = selected && !showingMonitors ? selected : null

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (!onWidthChange || width === undefined) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !onWidthChange) return
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
      setSelected(cur => {
        if (cur === MONITORS_TAB && m.length > 0) return cur
        if (cur && s.some(x => x.id === cur)) return cur
        return s[0]?.id ?? (m.length > 0 ? MONITORS_TAB : null)
      })
    }
    void load()
    const t = setInterval(() => void load(), 1500)
    return () => { alive = false; clearInterval(t) }
  }, [agentId])

  // Stream the selected shell's output.
  useEffect(() => {
    if (!selectedShell) { setOutput(''); return }
    let alive = true
    setOutput('')
    void window.api.backgroundProcSubscribe(selectedShell).then(res => { if (alive && res) setOutput(res.backlog) })
    const offData = window.api.onBackgroundProcData(e => { if (e.id === selectedShell) setOutput(prev => prev + e.chunk) })
    const offExit = window.api.onBackgroundProcExit(e => {
      if (e.id === selectedShell) setShells(prev => prev.map(s => s.id === e.id ? { ...s, status: 'exited', exitCode: e.exitCode } : s))
    })
    return () => {
      alive = false
      offData()
      offExit()
      void window.api.backgroundProcUnsubscribe(selectedShell)
    }
  }, [selectedShell])

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shellTabs = shells.map(s => {
    const running = s.status === 'running'
    return {
      id: s.id,
      title: s.command,
      lead: <span className={`terminal-tab-dot${running ? ' running' : ''}`} role="img" aria-label={running ? 'running' : 'exited'} />,
      label: running ? s.command : `${s.command} (exit ${s.exitCode ?? '?'})`,
      // Not a plain close: this stops the process, so it does not look like one.
      ...(running ? {
        closeLabel: `Kill ${s.command}`,
        closeIcon: <Square size={11} aria-hidden="true" />,
        onClose: () => void window.api.backgroundProcKill(s.id)
      } : {})
    }
  })
  const monitorTab = monitors.length > 0 ? [{
    id: MONITORS_TAB,
    lead: <Activity size={14} aria-hidden="true" />,
    label: `Monitors (${monitors.length})`
  }] : []

  return (
    <section
      className={`files-overlay processes-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : (width !== undefined ? { width } : undefined)}
      role="dialog"
      aria-label="Processes"
    >
      {!full && onWidthChange && width !== undefined && <div className="files-resizer" onMouseDown={startDrag} />}
      <PanelHeader
        ariaLabel="Background processes"
        activeId={selected}
        onSelect={setSelected}
        tabs={[...shellTabs, ...monitorTab]}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Processes"
        onClose={onClose}
      />
      <div className="files-body">
        {showingMonitors ? (
          <div className="processes-monitors">
            {monitors.map(m => (
              <div key={m.id} className="processes-monitor-row" title={`monitor ${m.id}`}>
                <span className="terminal-tab-dot running" aria-hidden="true" />
                <span className="processes-monitor-target">{m.targetId}</span>
                <span className="processes-monitor-until">{m.until}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="files-main processes-main">
            {selectedShell ? (
              <pre ref={outRef} className="processes-output">{output || '(no output yet)'}</pre>
            ) : (
              <div className="files-empty">
                <Terminal size={30} aria-hidden="true" />
                <div className="files-empty-title">No background processes</div>
                <div className="files-empty-hint">Start one with a background bash command.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
