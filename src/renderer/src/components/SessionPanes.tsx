import { useEffect } from 'react'
import type { ImageAttachment } from '@shared/types'
import type { PaneModel } from '../App'
import Pane from './Pane'
import type { SubagentOverlayItem } from './chat/SubagentOverlay'

interface Props {
  panes: PaneModel[]
  activeId: string | null
  onActiveChange: (id: string) => void
  backgrounds: Record<string, boolean>
  gitBranch?: string | null
  onRemove: (id: string) => void
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onOpenFiles?: (id: string) => void
  onOpenProcesses?: (id: string) => void
  terminalOpenFor?: string | null
  onToggleTerminal?: (id: string) => void
  browserOpenFor?: string | null
  onToggleBrowser?: (id: string) => void
  browserAgentActiveIds?: Set<string>
  onOpenSubagent?: (item: SubagentOverlayItem) => void
}

// All sessions stay mounted (hidden when inactive) so a hidden session keeps
// streaming/running — switching never stops another. The hiding is CSS only
// (the `hidden` attribute on the slot), never an unmount or a key change.
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, gitBranch, onRemove, onSendDraftMessage, onOpenFiles, onOpenProcesses, terminalOpenFor, onToggleTerminal, browserOpenFor, onToggleBrowser, browserAgentActiveIds, onOpenSubagent }: Props) {
  useEffect(() => {
    if (panes.length === 0) return
    if (activeId && panes.some(p => p.agent.id === activeId)) return
    onActiveChange(panes[0].agent.id)
  }, [panes, activeId, onActiveChange])

  const active = panes.find(p => p.agent.id === activeId) ?? panes[0]

  return (
    <div className="session-panes">
      {panes.map(pane => (
        <div key={pane.agent.id} className="pane-slot" hidden={pane.agent.id !== active?.agent.id}>
          <Pane
            pane={pane}
            background={Boolean(backgrounds[pane.agent.id])}
            active={pane.agent.id === active?.agent.id}
            gitBranch={gitBranch}
            terminalOpen={terminalOpenFor === pane.agent.id}
            browserOpen={browserOpenFor === pane.agent.id}
            browserAgentActive={browserAgentActiveIds?.has(pane.agent.id) ?? false}
            onFocus={() => onActiveChange(pane.agent.id)}
            onRemove={() => onRemove(pane.agent.id)}
            onSendDraftMessage={onSendDraftMessage}
            onOpenFiles={onOpenFiles ? () => onOpenFiles(pane.agent.id) : undefined}
            onOpenProcesses={onOpenProcesses ? () => onOpenProcesses(pane.agent.id) : undefined}
            onToggleTerminal={onToggleTerminal ? () => onToggleTerminal(pane.agent.id) : undefined}
            onToggleBrowser={onToggleBrowser ? () => onToggleBrowser(pane.agent.id) : undefined}
            onOpenSubagent={onOpenSubagent}
          />
        </div>
      ))}
    </div>
  )
}
