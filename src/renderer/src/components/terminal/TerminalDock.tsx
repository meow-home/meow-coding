import { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, X, RotateCw, Trash2, Edit2 } from 'lucide-react'
import type { TerminalInfo } from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'
import TerminalView from './TerminalView'

interface TerminalDockProps {
  agentId: string
  visible: boolean
  onClose: () => void
}

function getInitialHeight(): number {
  try {
    const saved = localStorage.getItem('meow.terminal.height')
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!isNaN(parsed) && parsed >= 120) {
        return parsed
      }
    }
  } catch {}
  return 240
}

export default function TerminalDock({ agentId, visible, onClose }: TerminalDockProps) {
  const [height, setHeight] = useState<number>(getInitialHeight)
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [tabMenu, setTabMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const dockRef = useRef<HTMLDivElement>(null)
  const autoCreatedRef = useRef(false)

  useEffect(() => {
    if (!visible) return
    let active = true

    window.api
      .terminalList(agentId)
      .then((list) => {
        if (!active) return
        setTerminals(list)
        if (list.length > 0) {
          setSelectedTerminalId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0].id))
        } else {
          setSelectedTerminalId(null)
          if (!autoCreatedRef.current) {
            autoCreatedRef.current = true
            window.api
              .terminalCreate(agentId)
              .then((created) => {
                if (!active) return
                setSelectedTerminalId(created.id)
              })
              .catch((err) => {
                if (!active) return
                setInlineError(err instanceof Error ? err.message : String(err))
              })
          }
        }
      })
      .catch((err) => {
        if (!active) return
        console.error('[meow] Failed to list terminals:', err)
      })

    const unlisten = window.api.onTerminalsChanged((data) => {
      if (!active || data.agentId !== agentId) return
      setTerminals(data.terminals)
      setSelectedTerminalId((prev) => {
        if (prev && data.terminals.some((t) => t.id === prev)) {
          return prev
        }
        return data.terminals[0]?.id ?? null
      })
    })

    return () => {
      active = false
      unlisten()
    }
  }, [agentId, visible])

  const handleCreate = useCallback(async () => {
    setInlineError(null)
    try {
      const created = await window.api.terminalCreate(agentId)
      setSelectedTerminalId(created.id)
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err))
    }
  }, [agentId])

  const handleKill = useCallback(async (terminalId: string) => {
    setTabMenu(null)
    try {
      await window.api.terminalKill(terminalId)
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleRestart = useCallback(async (terminalId: string) => {
    setTabMenu(null)
    try {
      await window.api.terminalRestart(terminalId)
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleCloseOthers = useCallback(
    async (keepId: string) => {
      setTabMenu(null)
      const toClose = terminals.filter((t) => t.id !== keepId)
      for (const t of toClose) {
        try {
          await window.api.terminalKill(t.id)
        } catch {}
      }
    },
    [terminals]
  )

  const startRename = useCallback(
    (terminalId: string) => {
      setTabMenu(null)
      const tab = terminals.find((t) => t.id === terminalId)
      if (tab) {
        setRenamingId(terminalId)
        setRenameValue(tab.userTitle || tab.title || '')
      }
    },
    [terminals]
  )

  const commitRename = useCallback(
    (terminalId: string) => {
      const nextTitle = renameValue.trim()
      setRenamingId(null)
      void window.api.terminalRename(terminalId, nextTitle || null)
    },
    [renameValue]
  )

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      const startY = e.clientY
      const startHeight = height
      const container = dockRef.current?.parentElement
      const maxHeight = container ? container.clientHeight * 0.7 : window.innerHeight * 0.7

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = startY - moveEvent.clientY
        const clamped = Math.min(Math.max(startHeight + deltaY, 120), Math.max(120, maxHeight))
        const rounded = Math.round(clamped)
        setHeight(rounded)
        try {
          localStorage.setItem('meow.terminal.height', String(rounded))
        } catch {}
      }

      const onMouseUp = () => {
        setIsResizing(false)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [height]
  )

  if (!visible) return null

  const selectedTab = terminals.find((t) => t.id === selectedTerminalId)

  return (
    <div
      ref={dockRef}
      className={`terminal-dock ${isResizing ? 'resizing' : ''}`}
      style={{ height: `${height}px` }}
    >
      <div
        className="terminal-dock-resize"
        onMouseDown={handleResizeMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      />

      <div className="terminal-dock-header">
        <div className="terminal-tabs" role="tablist">
          {terminals.map((tab) => {
            const isSelected = tab.id === selectedTerminalId
            const isRenaming = tab.id === renamingId
            const title = tab.userTitle || tab.title || 'Terminal'
            const isRunning = tab.status === 'running'

            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isSelected}
                className={`terminal-tab ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedTerminalId(tab.id)}
                onDoubleClick={() => startRename(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ terminalId: tab.id, x: e.clientX, y: e.clientY })
                }}
              >
                <span
                  className={`status-dot ${isRunning ? 'status-running' : 'status-exited'}`}
                  role="img"
                  aria-label={isRunning ? 'running' : `exited (${tab.exitCode ?? 0})`}
                />
                {isRenaming ? (
                  <input
                    type="text"
                    className="terminal-tab-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitRename(tab.id)
                      } else if (e.key === 'Escape') {
                        setRenamingId(null)
                      }
                    }}
                    onBlur={() => commitRename(tab.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="terminal-tab-title" title={title}>
                    {title}
                    {!isRunning && tab.exitCode !== null && tab.exitCode !== undefined && (
                      <span className="terminal-tab-exit-code">({tab.exitCode})</span>
                    )}
                  </span>
                )}
                <button
                  className="terminal-tab-close"
                  title="Close terminal"
                  aria-label={`Close ${title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleKill(tab.id)
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="terminal-dock-actions">
          {selectedTab && selectedTab.status === 'exited' && (
            <button
              className="terminal-restart-btn"
              title="Restart terminal"
              aria-label="Restart terminal"
              onClick={() => void handleRestart(selectedTab.id)}
            >
              <RotateCw size={12} aria-hidden="true" />
              <span>Restart</span>
            </button>
          )}
          <button
            className="icon-btn"
            title="New terminal"
            aria-label="New terminal"
            onClick={handleCreate}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            title="Close dock"
            aria-label="Close dock"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {inlineError && (
        <div className="terminal-error-bar" role="alert">
          <span className="terminal-error-text">{inlineError}</span>
          <button
            className="terminal-error-dismiss"
            onClick={() => setInlineError(null)}
            aria-label="Dismiss error"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="terminal-dock-body">
        {selectedTerminalId ? (
          <TerminalView
            key={selectedTerminalId}
            terminalId={selectedTerminalId}
            agentId={agentId}
          />
        ) : (
          <div className="terminal-dock-empty">
            <span className="terminal-empty-text">No open terminals</span>
            <button className="btn btn-primary" onClick={handleCreate}>
              <Plus size={14} aria-hidden="true" />
              <span>New Terminal</span>
            </button>
          </div>
        )}
      </div>

      <BaseDropdown
        menuClassName="sidebar-menu-dropdown"
        open={Boolean(tabMenu)}
        onOpenChange={(open) => {
          if (!open) setTabMenu(null)
        }}
        anchorPoint={tabMenu ? { x: tabMenu.x, y: tabMenu.y } : undefined}
      >
        {tabMenu && (
          <>
            <button className="menu-item" onClick={() => startRename(tabMenu.terminalId)}>
              <Edit2 size={13} aria-hidden="true" />
              <span>Rename</span>
            </button>
            <button className="menu-item" onClick={() => handleRestart(tabMenu.terminalId)}>
              <RotateCw size={13} aria-hidden="true" />
              <span>Restart</span>
            </button>
            <div className="menu-sep" />
            <button className="menu-item danger" onClick={() => handleKill(tabMenu.terminalId)}>
              <Trash2 size={13} aria-hidden="true" />
              <span>Close</span>
            </button>
            {terminals.length > 1 && (
              <button className="menu-item" onClick={() => handleCloseOthers(tabMenu.terminalId)}>
                <X size={13} aria-hidden="true" />
                <span>Close others</span>
              </button>
            )}
          </>
        )}
      </BaseDropdown>
    </div>
  )
}
