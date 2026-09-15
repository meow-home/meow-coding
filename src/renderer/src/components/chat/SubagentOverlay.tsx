import { useCallback, useEffect, useRef } from 'react'
import { Bot, Maximize2, Minimize2, X } from 'lucide-react'

export const SUBAGENT_MIN_WIDTH = 320
export const SUBAGENT_MAX_WIDTH = 900
export const SUBAGENT_DEFAULT_WIDTH = 420

export interface SubagentOverlayItem {
  taskId: string
  subagentType?: string
  background?: boolean
  state: 'running' | 'completed' | 'cancelled' | 'error'
  tools: string[]
  text?: string
  result?: string
}

interface Props {
  item: SubagentOverlayItem
  full: boolean
  width: number
  onWidthChange: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
}

export default function SubagentOverlay({ item, full, width, onWidthChange, onToggleFull, onClose }: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const textEndRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(SUBAGENT_MAX_WIDTH, Math.max(SUBAGENT_MIN_WIDTH, dragRef.current.startWidth + delta))
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (item.state === 'running') {
      textEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [item.text, item.state])

  return (
    <section
      className={`subagent-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : { width }}
      aria-label="Sub-agent Details"
    >
      {!full && <div className="subagent-resizer" onMouseDown={startDrag} title="Drag to resize" />}
      <div className="files-head">
        <div className="files-head-title">
          <Bot size={16} aria-hidden="true" />
          <span>sub-agent{item.subagentType ? ` (${item.subagentType})` : ''}</span>
          {item.background && <span className="subagent-bg">background</span>}
        </div>
        <div className="files-head-actions">
          <button
            className="pane-header-action"
            title={full ? 'Restore panel size' : 'Expand panel'}
            onClick={onToggleFull}
          >
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="pane-header-action"
            title="Close panel (Esc)"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="files-body" style={{ flexDirection: 'column', padding: '0.833333rem', overflowY: 'auto' }}>
        <div className="subagent-live-state">
          <span className={`subagent-state state-${item.state}`}>{item.state}</span>
          {item.tools.length > 0 && (
            <div className="subagent-tools">
              {item.tools.map((t, idx) => <code key={idx}>{t}</code>)}
            </div>
          )}
        </div>
        <div className="subagent-live-text">
          {item.text || (item.state === 'running' ? '…' : '')}
          <div ref={textEndRef} />
        </div>
        {item.result && <div className="subagent-live-result">{item.result}</div>}
      </div>
    </section>
  )
}
