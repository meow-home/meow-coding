import { useCallback } from 'react'
import type { PaneModel } from '../App'
import PaneHeader from './PaneHeader'
import ChatPanel from './chat/ChatPanel'
import ChatErrorBoundary from './chat/ChatErrorBoundary'

interface Props {
  pane: PaneModel
  background: boolean
  active: boolean
  onFocus: () => void
  onRemove: () => void
}

export default function Pane({ pane, background, active, onFocus, onRemove }: Props) {
  const id = pane.agent.id
  const native = pane.agent.kind === 'native'
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

  return (
    <div className={`pane ${background ? 'backgrounded' : ''} ${active ? 'active' : ''} status-${pane.state.status}`} onClick={onFocus}>
      <PaneHeader
        name={pane.agent.name}
        state={pane.state}
        background={background}
        native={native}
        active={active}
        onStop={handleStop}
        onRestart={handleRestart}
        onInject={handleInject}
        onOpenLog={handleOpenLog}
        onToggleBackground={handleToggleBackground}
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
          />
        </ChatErrorBoundary>
      </div>
    </div>
  )
}
