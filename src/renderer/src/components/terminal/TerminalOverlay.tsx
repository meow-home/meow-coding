import { useCallback, useEffect, useRef, useState } from 'react'
import { Edit2, Plus, RotateCw, Trash2, X } from 'lucide-react'
import type { TerminalInfo } from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'
import PanelHeader from '../common/PanelHeader'
import TerminalView from './TerminalView'
import { toTerminalInput } from '../chat/commandBlocks'

interface Props {
  agentId: string
  full: boolean
  onToggleFull: () => void
  onClose: () => void
  onOpenBrowser: (agentId: string) => void
  /** Command a chat command box asked to run; `seq` allows the same command twice. */
  pendingCommand?: { command: string; seq: number } | null
  onCommandConsumed?: (seq: number) => void
}

export default function TerminalOverlay({ agentId, full, onToggleFull, onClose, onOpenBrowser, pendingCommand, onCommandConsumed }: Props) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [tabMenu, setTabMenu] = useState<{ terminalId: string; x: number; y: number } | null>(null)
  const autoCreatedRef = useRef(false)
  // The initial list must land before a pending command runs: until then we do
  // not know whether this session already has a terminal to type into, and a
  // second auto-create would open a duplicate tab.
  const [ready, setReady] = useState(false)
  const pendingCommandRef = useRef(pendingCommand)
  pendingCommandRef.current = pendingCommand

  useEffect(() => {
    let active = true
    autoCreatedRef.current = false
    setReady(false)

    window.api
      .terminalList(agentId)
      .then((list) => {
        if (!active) return
        setTerminals(list)
        setReady(true)
        if (list.length > 0) {
          setSelectedTerminalId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0].id))
          return
        }
        setSelectedTerminalId(null)
        // A command from the chat creates the tab itself (with the command).
        if (autoCreatedRef.current || pendingCommandRef.current) return
        autoCreatedRef.current = true
        window.api
          .terminalCreate(agentId)
          .then((created) => {
            if (active) setSelectedTerminalId(created.id)
          })
          .catch((err) => {
            if (active) setInlineError(err instanceof Error ? err.message : String(err))
          })
      })
      .catch((err) => {
        if (active) {
          console.error('[meow] Failed to list terminals:', err)
          setReady(true)
        }
      })

    const unlisten = window.api.onTerminalsChanged((data) => {
      if (!active || data.agentId !== agentId) return
      setTerminals(data.terminals)
      setSelectedTerminalId((prev) =>
        prev && data.terminals.some((t) => t.id === prev) ? prev : (data.terminals[0]?.id ?? null))
    })

    return () => {
      active = false
      unlisten()
    }
  }, [agentId])

  // Runs a command handed over from the chat: into the selected terminal when it
  // is alive, else the first running one, else a restarted tab, else a new tab.
  const consumedSeqRef = useRef(0)
  useEffect(() => {
    if (!pendingCommand || !ready) return
    const { command, seq } = pendingCommand
    if (consumedSeqRef.current >= seq) return
    consumedSeqRef.current = seq
    onCommandConsumed?.(seq)

    const run = async () => {
      try {
        const list = await window.api.terminalList(agentId)
        const running = list.filter((t) => t.status === 'running')
        const live = running.find((t) => t.id === selectedTerminalId) ?? running[0]
        if (live) {
          setSelectedTerminalId(live.id)
          await window.api.terminalWrite(live.id, toTerminalInput(command))
          return
        }
        const exited = list.find((t) => t.id === selectedTerminalId) ?? list[0]
        if (exited) {
          setSelectedTerminalId(exited.id)
          await window.api.terminalRestart(exited.id)
          await window.api.terminalWrite(exited.id, toTerminalInput(command))
          return
        }
        const created = await window.api.terminalCreate(agentId, { command: toTerminalInput(command) })
        setSelectedTerminalId(created.id)
      } catch (err) {
        setInlineError(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
  }, [pendingCommand, ready, agentId, selectedTerminalId, onCommandConsumed])

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

  const handleCloseOthers = useCallback(async (keepId: string) => {
    setTabMenu(null)
    for (const t of terminals.filter((t) => t.id !== keepId)) {
      try {
        await window.api.terminalKill(t.id)
      } catch {}
    }
  }, [terminals])

  const startRename = useCallback((terminalId: string) => {
    setTabMenu(null)
    const tab = terminals.find((t) => t.id === terminalId)
    if (!tab) return
    setRenamingId(terminalId)
    setRenameValue(tab.userTitle || tab.title || '')
  }, [terminals])

  const commitRename = useCallback((terminalId: string) => {
    const nextTitle = renameValue.trim()
    setRenamingId(null)
    void window.api.terminalRename(terminalId, nextTitle || null)
  }, [renameValue])

  const selectedTab = terminals.find((t) => t.id === selectedTerminalId)

  return (
    <section
      className={`files-overlay terminal-overlay${full ? ' full' : ' docked'}`}
      role="dialog"
      aria-label="Terminal"
    >
      <PanelHeader
        ariaLabel="Terminals"
        activeId={selectedTerminalId}
        onSelect={setSelectedTerminalId}
        addLabel="New terminal"
        onAdd={handleCreate}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Terminal"
        onClose={onClose}
        actions={selectedTab && selectedTab.status === 'exited' ? (
          <button
            className="icon-btn terminal-restart-btn"
            title="Restart terminal"
            aria-label="Restart terminal"
            onClick={() => void handleRestart(selectedTab.id)}
          >
            <RotateCw size={14} aria-hidden="true" />
          </button>
        ) : undefined}
        tabs={terminals.map((tab) => {
          const title = tab.userTitle || tab.title || 'Terminal'
          const isRunning = tab.status === 'running'
          return {
            id: tab.id,
            className: 'terminal-tab',
            title,
            lead: (
              <span
                className={`terminal-tab-dot${isRunning ? ' running' : ''}`}
                role="img"
                aria-label={isRunning ? 'running' : `exited (${tab.exitCode ?? 0})`}
              />
            ),
            label: tab.id === renamingId ? (
              <input
                type="text"
                className="terminal-tab-rename-input"
                value={renameValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(tab.id)
                  else if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={() => commitRename(tab.id)}
              />
            ) : (
              <>
                {title}
                {!isRunning && tab.exitCode !== undefined && (
                  <span className="terminal-tab-exit-code"> ({tab.exitCode})</span>
                )}
              </>
            ),
            closeClassName: 'terminal-tab-close',
            closeLabel: `Close ${title}`,
            onClose: () => void handleKill(tab.id),
            onDoubleClick: () => startRename(tab.id),
            onContextMenu: (e) => {
              e.preventDefault()
              setTabMenu({ terminalId: tab.id, x: e.clientX, y: e.clientY })
            }
          }
        })}
      />

      {inlineError && (
        <div className="terminal-error-bar" role="alert">
          <span className="terminal-error-text">{inlineError}</span>
          <button className="icon-btn" onClick={() => setInlineError(null)} aria-label="Dismiss error">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="terminal-overlay-body">
        {selectedTerminalId ? (
          <TerminalView
            key={selectedTerminalId}
            terminalId={selectedTerminalId}
            agentId={agentId}
            onOpenBrowser={onOpenBrowser}
            onError={setInlineError}
          />
        ) : (
          <div className="files-empty">
            <div className="files-empty-title">No open terminals</div>
            <button className="btn" onClick={handleCreate}>
              <Plus size={14} aria-hidden="true" />
              <span>New terminal</span>
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
              <Edit2 size={16} aria-hidden="true" />
              Rename
            </button>
            <button className="menu-item" onClick={() => void handleRestart(tabMenu.terminalId)}>
              <RotateCw size={16} aria-hidden="true" />
              Restart
            </button>
            <div className="menu-sep" aria-hidden="true" />
            {terminals.length > 1 && (
              <button className="menu-item" onClick={() => void handleCloseOthers(tabMenu.terminalId)}>
                <X size={16} aria-hidden="true" />
                Close others
              </button>
            )}
            <button className="menu-item danger" onClick={() => void handleKill(tabMenu.terminalId)}>
              <Trash2 size={16} aria-hidden="true" />
              Close
            </button>
          </>
        )}
      </BaseDropdown>
    </section>
  )
}
