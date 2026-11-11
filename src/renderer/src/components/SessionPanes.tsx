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
  onSendDraftMessage?: (textAndImages: { text: string; images?: ImageAttachment[] }) => void
  onToggleTerminal?: (id: string) => void
  onToggleBrowser?: (id: string) => void
  onOpenSubagent?: (item: SubagentOverlayItem) => void
  onOpenTasks?: (id: string, monitorId?: string) => void
  projects: { path: string; name: string }[]
  onSelectProject: (path: string) => void
  onChooseFolder: () => void
}

// All sessions stay mounted (hidden when inactive) so a hidden session keeps
// streaming/running — switching never stops another. The hiding is CSS only
// (the `hidden` attribute on the slot), never an unmount or a key change.
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, gitBranch, onSendDraftMessage, onToggleTerminal, onToggleBrowser, onOpenSubagent, onOpenTasks, projects, onSelectProject, onChooseFolder }: Props) {
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
            onFocus={() => onActiveChange(pane.agent.id)}
            onSendDraftMessage={onSendDraftMessage}
            onToggleTerminal={onToggleTerminal ? () => onToggleTerminal(pane.agent.id) : undefined}
            onToggleBrowser={onToggleBrowser ? () => onToggleBrowser(pane.agent.id) : undefined}
            onOpenSubagent={onOpenSubagent}
            onOpenTasks={onOpenTasks ? (monitorId?: string) => onOpenTasks(pane.agent.id, monitorId) : undefined}
            projects={projects}
            onSelectProject={onSelectProject}
            onChooseFolder={onChooseFolder}
          />
        </div>
      ))}
    </div>
  )
}
