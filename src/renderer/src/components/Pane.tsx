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
  gitBranch?: string | null
  onFocus: () => void
  onRemove: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onToggleTerminal?: () => void
  onToggleBrowser?: () => void
  onOpenSubagent?: (item: SubagentOverlayItem) => void
}

export default function Pane({ pane, background, active, gitBranch, onFocus, onRemove, onSendDraftMessage, onToggleTerminal, onToggleBrowser, onOpenSubagent }: Props) {
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
  const handleToggleBrowser = useCallback(() => {
    if (!isDraft) onToggleBrowser?.()
  }, [isDraft, onToggleBrowser])

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
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        const target = e.target as HTMLElement | null
        const isInputOrTextarea =
          !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        const isXtermHelper = !!target?.classList?.contains('xterm-helper-textarea')
        if (isInputOrTextarea && !isXtermHelper) return
        e.preventDefault()
        handleToggleBrowser()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, isDraft, onToggleTerminal, onToggleBrowser, handleToggleTerminal, handleToggleBrowser])

  // Keys typed in the native page never reach the window listener: main forwards
  // the app-level ones here for the active pane only.
  useEffect(() => {
    if (!active || isDraft) return
    return window.api.onBrowserShortcut(({ action }) => {
      if (action === 'toggle-terminal') handleToggleTerminal()
      else if (action === 'toggle-browser') handleToggleBrowser()
    })
  }, [active, isDraft, handleToggleTerminal, handleToggleBrowser])

  return (
    <div className={`pane ${background ? 'backgrounded' : ''} ${active ? 'active' : ''} status-${pane.state.status}`} onClick={onFocus}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        cwd={pane.agent.cwd}
        native={native}
        active={active}
        onStop={handleStop}
        onRestart={handleRestart}
        onInject={handleInject}
        onOpenLog={handleOpenLog}
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
            gitBranch={gitBranch}
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
