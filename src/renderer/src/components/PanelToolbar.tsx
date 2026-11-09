import { useState } from 'react'
import { Activity, Code, Folder, FolderSymlink, Globe, ListTree, MoreHorizontal, SquareTerminal } from 'lucide-react'
import BaseDropdown from './common/BaseDropdown'

interface Props {
  /** The active project's folder, when one is open. */
  projectPath: string | null
  /** A real session is active (not a draft): session panels are available. */
  sessionReady: boolean
  subagentsAvailable: boolean
  subagentsOpen: boolean
  terminalOpen: boolean
  processesOpen: boolean
  browserOpen: boolean
  browserAgentActive: boolean
  filesOpen: boolean
  onToggleSubagents: () => void
  onToggleTerminal: () => void
  onToggleProcesses: () => void
  onToggleBrowser: () => void
  onToggleFiles: () => void
}

/** Opens and closes the right-side panels from the title bar. */
export default function PanelToolbar({
  projectPath, sessionReady, subagentsAvailable, subagentsOpen, terminalOpen, processesOpen, browserOpen,
  browserAgentActive, filesOpen, onToggleSubagents, onToggleTerminal, onToggleProcesses, onToggleBrowser, onToggleFiles
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isMac = window.api.platform === 'darwin'
  const mod = isMac ? 'Cmd' : 'Ctrl'
  const unavailable = 'Unavailable in draft sessions'

  return (
    <div className="title-bar-tools" onDoubleClick={e => e.stopPropagation()}>
      <button
        className={`icon-btn ${subagentsOpen ? 'active' : ''}`}
        title={subagentsAvailable ? 'Toggle sub-agents' : 'Open a sub-agent from the chat'}
        aria-label="Toggle sub-agents"
        disabled={!subagentsAvailable}
        onClick={onToggleSubagents}
      >
        <ListTree size={15} aria-hidden="true" />
      </button>
      <span className="title-bar-tools-sep" aria-hidden="true" />
      <button
        className={`icon-btn ${terminalOpen ? 'active' : ''}`}
        title={sessionReady ? `Toggle terminal (${mod}+\`)` : unavailable}
        aria-label="Toggle terminal"
        disabled={!sessionReady}
        onClick={onToggleTerminal}
      >
        <SquareTerminal size={15} aria-hidden="true" />
      </button>
      <button
        className={`icon-btn ${processesOpen ? 'active' : ''}`}
        title={sessionReady ? 'Toggle processes' : unavailable}
        aria-label="Toggle processes"
        disabled={!sessionReady}
        onClick={onToggleProcesses}
      >
        <Activity size={15} aria-hidden="true" />
      </button>
      <button
        className={`icon-btn pane-browser-toggle ${browserOpen ? 'active' : ''}`}
        title={sessionReady ? `Toggle browser (${mod}+Shift+B)` : unavailable}
        aria-label="Toggle browser"
        disabled={!sessionReady}
        onClick={onToggleBrowser}
      >
        <Globe size={15} aria-hidden="true" />
        {browserAgentActive && <span className="pane-browser-dot" aria-hidden="true" />}
      </button>
      <button
        className={`icon-btn ${filesOpen ? 'active' : ''}`}
        title="Toggle files"
        aria-label="Toggle files"
        disabled={!projectPath}
        onClick={onToggleFiles}
      >
        <Folder size={15} aria-hidden="true" />
      </button>
      <BaseDropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        placement="bottom-end"
        menuClassName="sidebar-menu-dropdown"
        trigger={(
          <button className="icon-btn" title="More" aria-label="More" disabled={!projectPath}>
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        )}
      >
        <button
          className="menu-item"
          onClick={() => {
            setMenuOpen(false)
            if (projectPath) void window.api.openFolder(projectPath)
          }}
        >
          <FolderSymlink size={16} aria-hidden="true" />
          Open Folder
        </button>
        <button
          className="menu-item"
          onClick={() => {
            setMenuOpen(false)
            if (projectPath) void window.api.openInEditor(projectPath)
          }}
        >
          <Code size={16} aria-hidden="true" />
          Open in VS Code
        </button>
      </BaseDropdown>
    </div>
  )
}
