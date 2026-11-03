import { useCallback, useEffect } from 'react'
import { DRAFT_SESSION_ID, type ImageAttachment } from '@shared/types'
import type { PaneModel } from '../App'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'
import ChatErrorBoundary from './chat/ChatErrorBoundary'
import type { SubagentOverlayItem } from './chat/SubagentOverlay'

interface Props {
  pane: PaneModel
  background: boolean
  active: boolean
  terminalOpen?: boolean
  onFocus: () => void
  onRemove: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onOpenFiles?: () => void
  onOpenProcesses?: () => void
  onToggleTerminal?: () => void
  onOpenSubagent?: (item: SubagentOverlayItem) => void
}

export default function Pane({ pane, background, active, terminalOpen = false, onFocus, onRemove, onSendDraftMessage, onOpenFiles, onOpenProcesses, onToggleTerminal, onOpenSubagent }: Props) {
  const id = pane.agent.id
  const native = pane.agent.kind === 'native'
  const isDraft = id === DRAFT_SESSION_ID

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
    if (!isDraft) onToggleTerminal?.()
  }, [isDraft, onToggleTerminal])

  useEffect(() => {
    if (!active || isDraft || !onToggleTerminal) return
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
  }, [active, isDraft, onToggleTerminal, handleToggleTerminal])

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
        onToggleTerminal={onToggleTerminal ? handleToggleTerminal : undefined}
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
      </div>
    </div>
  )
}
