import { useCallback, useEffect, useState } from 'react'
import { DRAFT_SESSION_ID, type ImageAttachment } from '@shared/types'
import type { PaneModel } from '../App'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'
import ChatErrorBoundary from './chat/ChatErrorBoundary'
import type { SubagentOverlayItem } from './chat/SubagentOverlay'
import TerminalDock from './terminal/TerminalDock'

interface Props {
  pane: PaneModel
  background: boolean
  active: boolean
  onFocus: () => void
  onRemove: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onOpenFiles?: () => void
  onOpenProcesses?: () => void
  onOpenSubagent?: (item: SubagentOverlayItem) => void
}

function getInitialTerminalOpen(agentId: string): boolean {
  try {
    return localStorage.getItem(`meow.terminal.open.${agentId}`) === 'true'
  } catch {
    return false
  }
}

export default function Pane({ pane, background, active, onFocus, onRemove, onSendDraftMessage, onOpenFiles, onOpenProcesses, onOpenSubagent }: Props) {
  const id = pane.agent.id
  const native = pane.agent.kind === 'native'
  const isDraft = id === DRAFT_SESSION_ID

  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => getInitialTerminalOpen(id))

  // Stable callbacks so App-level re-renders (git poll, agent state) don't
  // cascade past the memoized ChatPanel into the chat feed.
  const handleStop = useCallback(() => {
    if (native) void window.api.stopChat(id)
    else void window.api.stopAgent(id)
  }, [id, native])
  const handleRestart = useCallback(() => {
    if (!native) void window.api.restartAgent(id)
  }, [id, native])
  const handleInject = useCallback((text: string) => void window.api.injectPrompt(id, text), [id])
  const handleOpenLog = useCallback(() => void window.api.openLog(id), [id])
  const handleModeChange = useCallback((m: 'build' | 'plan') => void window.api.setAgentMode(id, m), [id])
  const handleVariantChange = useCallback((v: string | undefined) => void window.api.setAgentVariant(id, v ?? null), [id])
  const handleToggleBackground = useCallback(() => {
    void window.api.setAgentBackground(id, !background)
  }, [id, background])

  const handleToggleTerminal = useCallback(() => {
    if (isDraft) return
    setTerminalOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(`meow.terminal.open.${id}`, String(next))
      } catch {}
      return next
    })
  }, [id, isDraft])

  const handleCloseTerminal = useCallback(() => {
    setTerminalOpen(false)
    try {
      localStorage.setItem(`meow.terminal.open.${id}`, 'false')
    } catch {}
  }, [id])

  useEffect(() => {
    if (!active || isDraft) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        const target = e.target as HTMLElement | null
        const isInputOrTextarea =
          !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        const isXtermHelper = !!target?.classList?.contains('xterm-helper-textarea')
        if (isInputOrTextarea && !isXtermHelper) {
          return
        }
        e.preventDefault()
        handleToggleTerminal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, isDraft, handleToggleTerminal])

  return (
    <div className={`pane ${background ? 'backgrounded' : ''} ${active ? 'active' : ''} status-${pane.state.status}`} onClick={onFocus}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        cwd={pane.agent.cwd}
        native={native}
        active={active}
        terminalOpen={terminalOpen}
        isDraft={isDraft}
        onToggleTerminal={handleToggleTerminal}
        onStop={handleStop}
        onRestart={handleRestart}
        onInject={handleInject}
        onOpenLog={handleOpenLog}
        onOpenFiles={onOpenFiles}
        onOpenProcesses={onOpenProcesses}
        onRemove={onRemove}
      />
      {background ? (
        <button className="pane-background-badge" onClick={() => void window.api.setAgentBackground(id, false)}>
          <span className="pane-background-name">{pane.agent.name}</span>
          <span className="pane-background-status">{pane.state.status}</span>
          <span className="pane-background-hint">click to open</span>
        </button>
      ) : null}
      <div className="pane-body">
        <ChatErrorBoundary agentId={id}>
          <ChatPanel
            agentId={id}
            cwd={pane.agent.cwd}
            mode={pane.agent.mode ?? 'build'}
            variant={pane.agent.variant}
            onModeChange={handleModeChange}
            onVariantChange={handleVariantChange}
            onSendDraftMessage={onSendDraftMessage}
            onOpenSubagent={onOpenSubagent}
          />
        </ChatErrorBoundary>
        {!isDraft && (
          <TerminalDock
            agentId={id}
            visible={active && !background && terminalOpen}
            onClose={handleCloseTerminal}
          />
        )}
      </div>
    </div>
  )
}
