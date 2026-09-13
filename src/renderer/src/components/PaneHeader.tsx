import { useEffect, useRef, useState } from 'react'
import { FileText, FolderTree, Layers, MoreVertical, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import type { AgentState } from '@shared/types'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  name: string
  state: AgentState
  background?: boolean
  native?: boolean
  active?: boolean
  onStop: () => void
  onRestart: () => void
  onInject: (text: string) => void
  onOpenLog: () => void
  onToggleBackground?: () => void
  onOpenFiles?: () => void
  onRemove: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

export default function PaneHeader({
  name, state, background = false, native = false, active = false,
  onStop, onRestart, onInject, onOpenLog, onToggleBackground, onOpenFiles, onRemove
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [injecting, setInjecting] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const close = () => setMenuOpen(false)

  const submitInject = () => {
    const text = prompt.trim()
    if (text) onInject(text)
    setPrompt('')
    setInjecting(false)
  }

  return (
    <div className={`pane-header ${active ? 'active' : ''} alert-${state.alert}`}>
      <span
        className={`status-dot status-${state.status}`}
        role="img"
        aria-label={state.exitCode !== null
          ? `${STATUS_LABEL[state.status]} (${state.exitCode})`
          : STATUS_LABEL[state.status]}
      />
      <span className="pane-title">{name}</span>
      <span className="pane-actions">
        {injecting && (
          <input
            className="input inject-input"
            autoFocus
            placeholder="prompt..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitInject()
              if (e.key === 'Escape') setInjecting(false)
            }}
          />
        )}
        <div className="pane-menu" ref={rootRef}>
          <button
            className="icon-btn"
            title="Pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="sidebar-menu-dropdown pane-menu-dropdown">
              {/* Only the parked PTY path has inject/log/stop/restart actions; a
                  native session's own menu is the sidebar's session row. */}
              {!native && (
                <>
                  <button className="menu-item" onClick={() => { close(); setInjecting(v => !v) }}>
                    <Play size={16} aria-hidden="true" />
                    Inject
                  </button>
                  <button className="menu-item" onClick={() => { close(); onOpenLog() }}>
                    <FileText size={16} aria-hidden="true" />
                    Log
                  </button>
                  <button className="menu-item" onClick={() => { close(); onStop() }}>
                    <Square size={16} aria-hidden="true" />
                    Stop
                  </button>
                  <button className="menu-item" onClick={() => { close(); onRestart() }}>
                    <RotateCw size={16} aria-hidden="true" />
                    Restart
                  </button>
                </>
              )}
              {onToggleBackground && (
                <button className="menu-item" onClick={() => { close(); onToggleBackground() }}>
                  <Layers size={16} aria-hidden="true" />
                  {background ? 'Open pane' : 'Run in background'}
                </button>
              )}
              {onOpenFiles && (
                <button className="menu-item" onClick={() => { close(); onOpenFiles() }}>
                  <FolderTree size={16} aria-hidden="true" />
                  Files
                </button>
              )}
              <div className="menu-sep" aria-hidden="true" />
              <button className="menu-item danger" onClick={() => { close(); setConfirmRemove(true) }}>
                <Trash2 size={16} aria-hidden="true" />
                Delete session
              </button>
            </div>
          )}
        </div>
      </span>
      {confirmRemove && (
        <ConfirmDialog
          title="Delete session"
          message={`Delete session "${name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { setConfirmRemove(false); onRemove() }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
