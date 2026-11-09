import { useState } from 'react'
import { Code, FolderSymlink, MoreVertical, Trash2 } from 'lucide-react'
import type { AgentState } from '@shared/types'
import BaseDropdown from './common/BaseDropdown'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  name: string
  state: AgentState
  cwd?: string
  onRemove: () => void
}

const STATUS_LABEL: Record<AgentState['status'], string> = {
  spawning: 'spawning', running: 'running', idle: 'idle',
  exited: 'exited', stopped: 'stopped', error: 'error'
}

/**
 * The active session's identity, seated in the window title bar: status dot, name and
 * the `⋮` menu. There is no separate pane header row — the chat pane starts right at
 * the top, and the title must ellipsize instead of pushing the tools off the bar.
 */
export default function SessionTitle({ name, state, cwd, onRemove }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const close = () => setMenuOpen(false)

  return (
    <div className="title-bar-session">
      <span
        className={`status-dot status-${state.status}`}
        role="img"
        aria-label={state.exitCode !== null
          ? `${STATUS_LABEL[state.status]} (${state.exitCode})`
          : STATUS_LABEL[state.status]}
      />
      <span className="title-bar-session-name" title={name}>{name}</span>
      <BaseDropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        placement="bottom-end"
        menuClassName="sidebar-menu-dropdown pane-menu-dropdown"
        trigger={(
          <button
            className="icon-btn"
            title="Session menu"
            aria-label={`menu ${name}`}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </button>
        )}
      >
        {cwd && (
          <>
            <button className="menu-item" onClick={() => { close(); void window.api.openFolder(cwd) }}>
              <FolderSymlink size={16} aria-hidden="true" />
              Open Folder
            </button>
            <button className="menu-item" onClick={() => { close(); void window.api.openInEditor(cwd) }}>
              <Code size={16} aria-hidden="true" />
              Open in VS Code
            </button>
            <div className="menu-sep" aria-hidden="true" />
          </>
        )}
        <button className="menu-item danger" onClick={() => { close(); setConfirmRemove(true) }}>
          <Trash2 size={16} aria-hidden="true" />
          Delete session
        </button>
      </BaseDropdown>
      {confirmRemove && (
        <ConfirmDialog
          title="Delete session"
          message={`Delete session "${name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { setConfirmRemove(false); onRemove() }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
