import { useEffect } from 'react'
import type { PaneModel } from '../App'
import Pane from './Pane'

interface Props {
  panes: PaneModel[]
  activeId: string | null
  onActiveChange: (id: string) => void
  backgrounds: Record<string, boolean>
  onRemove: (id: string) => void
}

// All sessions stay mounted (hidden when inactive) so a hidden session keeps
// streaming/running — switching never stops another. The hiding is CSS only
// (the `hidden` attribute on the slot), never an unmount or a key change.
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove }: Props) {
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
            onFocus={() => onActiveChange(pane.agent.id)}
            onRemove={() => onRemove(pane.agent.id)}
          />
        </div>
      ))}
    </div>
  )
}
