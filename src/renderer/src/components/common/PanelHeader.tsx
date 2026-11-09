import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { Maximize2, Minimize2, Plus, X } from 'lucide-react'

export interface PanelHeaderTab {
  id: string
  /** Usually the tab's text; a node for cases such as an inline rename field. */
  label: ReactNode
  title?: string
  lead?: ReactNode
  className?: string
  closeClassName?: string
  closeLabel?: string
  /** Replaces the default X, for an action that is not a plain close (killing a process). */
  closeIcon?: ReactNode
  onClose?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: MouseEvent) => void
}

interface Props {
  ariaLabel: string
  tabs: PanelHeaderTab[]
  activeId: string | null
  onSelect: (id: string) => void
  addLabel?: string
  onAdd?: () => void
  /** Panel-specific buttons, placed before expand and close. */
  actions?: ReactNode
  full: boolean
  onToggleFull: () => void
  closeLabel: string
  onClose: () => void
}

/** The one header of every right-side panel: its tabs are the title. */
export default function PanelHeader({
  ariaLabel, tabs, activeId, onSelect, addLabel, onAdd, actions, full, onToggleFull, closeLabel, onClose
}: Props) {
  return (
    <div className="panel-head">
      <div className="panel-tabs-wrap">
        {tabs.length > 0 && (
          <div className="panel-tabs" role="tablist" aria-label={ariaLabel}>
            {tabs.map(tab => {
              const selected = tab.id === activeId
              return (
                <div
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={selected}
                  title={tab.title}
                  className={`panel-tab${tab.className ? ` ${tab.className}` : ''}${selected ? ' active' : ''}`}
                  onClick={() => onSelect(tab.id)}
                  onDoubleClick={tab.onDoubleClick}
                  onContextMenu={tab.onContextMenu}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      onSelect(tab.id)
                    }
                  }}
                >
                  {tab.lead}
                  <span className="panel-tab-label">{tab.label}</span>
                  {tab.onClose && (
                    <button
                      className={`panel-tab-close${tab.closeClassName ? ` ${tab.closeClassName}` : ''}`}
                      aria-label={tab.closeLabel}
                      title={tab.closeLabel}
                      onClick={(e) => {
                        e.stopPropagation()
                        tab.onClose?.()
                      }}
                    >
                      {tab.closeIcon ?? <X size={13} aria-hidden="true" />}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {onAdd && (
          <button className="icon-btn panel-add" title={addLabel} aria-label={addLabel} onClick={onAdd}>
            <Plus size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="panel-actions">
        {actions}
        <button
          className="icon-btn"
          title={full ? 'Restore size' : 'Expand'}
          aria-label={full ? 'Restore size' : 'Expand'}
          onClick={onToggleFull}
        >
          {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </button>
        <button className="icon-btn" title="Close" aria-label={closeLabel} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
