import { useCallback, useEffect } from 'react'
import { DRAFT_SESSION_ID, type ImageAttachment } from '@shared/types'
import type { PaneModel } from '../App'
import ChatPanel from './chat/ChatPanel'
import ChatErrorBoundary from './chat/ChatErrorBoundary'
import type { SubagentOverlayItem } from './chat/SubagentOverlay'

interface Props {
  pane: PaneModel
  background: boolean
  active: boolean
  gitBranch?: string | null
  onFocus: () => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onToggleTerminal?: () => void
  onToggleBrowser?: () => void
  onRunCommand?: (command: string) => void
  onOpenSubagent?: (item: SubagentOverlayItem) => void
  onOpenTasks?: (monitorId?: string) => void
  onOpenGit?: (path: string) => void
  projects: { path: string; name: string }[]
  onSelectProject: (path: string) => void
  onChooseFolder: () => void
}

export default function Pane({ pane, background, active, gitBranch, onFocus, onSendDraftMessage, onToggleTerminal, onToggleBrowser, onRunCommand, onOpenSubagent, onOpenTasks, onOpenGit, projects, onSelectProject, onChooseFolder }: Props) {
  const id = pane.agent.id
  const isDraft = id === DRAFT_SESSION_ID

  // Stable callbacks so App-level re-renders (git poll, agent state) don't
  // cascade past the memoized ChatPanel into the chat feed.
  const handleModeChange = useCallback((m: 'build' | 'plan') => void window.api.setAgentMode(id, m), [id])
  const handleVariantChange = useCallback((v: string | undefined) => void window.api.setAgentVariant(id, v ?? null), [id])
  const handleToggleTerminal = useCallback(() => {
    if (!isDraft) onToggleTerminal?.()
  }, [isDraft, onToggleTerminal])
  const handleToggleBrowser = useCallback(() => {
    if (!isDraft) onToggleBrowser?.()
  }, [isDraft, onToggleBrowser])
  const handleOpenTasks = useCallback((monitorId?: string) => {
    if (!isDraft) onOpenTasks?.(monitorId)
  }, [isDraft, onOpenTasks])
  const handleRunCommand = useCallback((command: string) => {
    if (!isDraft) onRunCommand?.(command)
  }, [isDraft, onRunCommand])

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
            onOpenTasks={onOpenTasks ? handleOpenTasks : undefined}
            onRunCommand={onRunCommand && !isDraft ? handleRunCommand : undefined}
            onOpenGit={onOpenGit}
            projects={projects}
            onSelectProject={onSelectProject}
            onChooseFolder={onChooseFolder}
          />
        </ChatErrorBoundary>
      </div>
    </div>
  )
}
