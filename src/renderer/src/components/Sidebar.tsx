import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Code, FolderOpen, FolderPlus, FolderSymlink, GitBranch, Moon, MoreVertical,
  PanelLeft, Pencil, Plus, RefreshCw, Server, Settings, Square, Sun, Terminal, Trash2, X
} from 'lucide-react'
import BaseDropdown from './common/BaseDropdown'
import ConfirmDialog from './ConfirmDialog'
import type { WorkspaceRuntime, WorkspaceSummary } from '@shared/types'
import { DRAFT_SESSION_ID } from '@shared/types'
import { applyTheme, type Theme } from '../theme'

function MoreIcon() {
  return <MoreVertical size={14} aria-hidden="true" />
}

type SessionStatus = 'running' | 'waiting' | 'idle'

interface Props {
  collapsed?: boolean
  workspaces: WorkspaceSummary[]
  /** Project path -> session ids waiting on a permission/question prompt. */
  needsInput: Record<string, string[]>
  activePath: string | null
  /** Mounted runtimes keyed by project path — drives each session row's status dot. */
  runtimes: Record<string, WorkspaceRuntime>
  /** Project path -> the session id currently showing (drives the active row). */
  activeSessionByPath: Record<string, string>
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenProviders: () => void
  onOpenGit: (path: string) => void
  onCheckUpdate: () => void
  updateChecking: boolean
  onNewSession: (path: string) => void
  onSelectSession: (path: string, id: string) => void
  onRenameSession: (path: string, id: string, name: string) => void
  onDeleteSession: (path: string, id: string) => void
  onStopSession: (id: string) => void
}

// Must match the .project-menu-dropdown / .sidebar-footer-dropdown CSS min-width;
// these menus are positioned from the trigger's rect and clamp to this width.
const MENU_WIDTH = 200

export default function Sidebar({
  collapsed = false,
  workspaces, needsInput, activePath, runtimes, activeSessionByPath, onOpen, onRemove, onRefresh,
  onOpenSettings, onOpenProviders, onOpenGit, onCheckUpdate, updateChecking,
  onNewSession, onSelectSession, onRenameSession, onDeleteSession, onStopSession
}: Props) {
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('meow.theme') === 'light' ? 'light' : 'dark')
  // Which projects show their session list; persisted so the sidebar reopens the
  // way the user left it.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('meow.sidebar.expanded') ?? '{}') as Record<string, boolean> } catch { return {} }
  })

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('meow.theme', theme)
  }, [theme])

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  useEffect(() => {
    localStorage.setItem('meow.sidebar.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    localStorage.setItem('meow.sidebar.expanded', JSON.stringify(expanded))
  }, [expanded])

  const handleAddProjectDirect = async () => {
    try {
      const folderPath = await window.api.pickFolder()
      if (!folderPath) return
      const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
      await window.api.addWorkspace(folderPath, name)
      setError('')
      onRefresh()
      onOpen(folderPath)
    } catch (err) {
      setError(String(err))
    }
  }

  // The real run state of a session, independent of the status dot: a session
  // blocked on a prompt still has `status === 'running'` and must stay stoppable.
  const isSessionRunning = (path: string, id: string): boolean =>
    runtimes[path]?.agents.find(a => a.agentId === id)?.status === 'running'

  // A session is "waiting" when it has a pending permission/question prompt,
  // "running" while a turn is in flight, and "idle" otherwise. Waiting wins over
  // running: a blocked session's `AgentState.status` stays 'running' for the whole
  // turn, so testing running first would make the yellow dot unreachable.
  const sessionStatus = (path: string, id: string): SessionStatus => {
    if (needsInput[path]?.includes(id)) return 'waiting'
    if (isSessionRunning(path, id)) return 'running'
    return 'idle'
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {error && <div className="sidebar-error">{error}</div>}
      <div className="sidebar-header-menu">
        <button
          type="button"
          className="sidebar-header-item"
          onClick={() => {
            if (workspaces.length > 0) {
              onNewSession(workspaces[0].projectPath)
            } else {
              void handleAddProjectDirect()
            }
          }}
        >
          <Plus size={14} aria-hidden="true" />
          <span>New session</span>
        </button>
        <button
          type="button"
          className="sidebar-header-item"
          onClick={() => void handleAddProjectDirect()}
        >
          <FolderPlus size={14} aria-hidden="true" />
          <span>Add folder</span>
        </button>
      </div>
      {collapsed ? (
        <ul className="project-rail">
          {workspaces.map(ws => {
            const inputCount = needsInput[ws.projectPath]?.length ?? 0
            return (
            <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
              <button
                className="project-avatar"
                title={inputCount > 0 ? `${ws.name} — needs your reply/approval` : ws.name}
                aria-label={ws.name}
                onClick={() => onOpen(ws.projectPath)}
              >
                {ws.name.charAt(0).toUpperCase()}
                {inputCount > 0 && <span className="project-avatar-badge" aria-hidden="true" />}
              </button>
            </li>
            )
          })}
        </ul>
      ) : (
      <ul className="project-list">
        {workspaces.map(ws => {
          const inputCount = needsInput[ws.projectPath]?.length ?? 0
          return (
          <li key={ws.projectPath} className={ws.projectPath === activePath ? 'active' : ''}>
            <div
              className="project-row"
              title={ws.projectPath}
              onContextMenu={e => {
                e.preventDefault()
                setOpenProjectMenu(ws.projectPath)
              }}
            >
              {/* Name + chevron are one flex group so clicking anywhere across
                  the pair toggles expand/collapse — not just the small icon. */}
              <button
                type="button"
                className="project-toggle"
                aria-label={expanded[ws.projectPath] ? 'Collapse' : 'Expand'}
                aria-expanded={!!expanded[ws.projectPath]}
                onClick={() => setExpanded(p => ({ ...p, [ws.projectPath]: !p[ws.projectPath] }))}
              >
                <span className="project-name">{ws.name}</span>
                <span className="project-expand" aria-hidden="true">
                  {expanded[ws.projectPath]
                    ? <ChevronDown size={13} aria-hidden="true" />
                    : <ChevronRight size={13} aria-hidden="true" />}
                </span>
              </button>
              {inputCount > 0 && (
                <span
                  className="project-badge"
                  title={`${inputCount} session(s) need your reply/approval`}
                >
                  {inputCount}
                </span>
              )}
              {/* `.project-menu` has no styles — it is only the hook the
                  document-mousedown effect above tests (`closest('.project-menu')`)
                  to keep this menu open while its own buttons are clicked. Do not
                  remove it as an "unused class": dropping it makes the menu
                  unclosable by its own button. */}
              <div className="project-menu project-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="icon-btn"
                  title="New session"
                  aria-label={`new session ${ws.name}`}
                  onClick={() => onNewSession(ws.projectPath)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                <BaseDropdown
                  open={openProjectMenu === ws.projectPath}
                  onOpenChange={(open) => setOpenProjectMenu(open ? ws.projectPath : null)}
                  placement="bottom-start"
                  menuClassName="sidebar-menu-dropdown project-menu-dropdown"
                  trigger={(
                    <button
                      className="icon-btn"
                      title="Project menu"
                      aria-label={`menu ${ws.name}`}
                    >
                      <MoreIcon />
                    </button>
                  )}
                >
                  <span className="menu-head" title={ws.projectPath}>{ws.projectPath}</span>
                  <button
                    className="menu-item"
                    onClick={() => { setOpenProjectMenu(null); onOpen(ws.projectPath) }}
                  >
                    <FolderOpen size={16} aria-hidden="true" />
                    Open
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => { setOpenProjectMenu(null); void window.api.openInEditor(ws.projectPath) }}
                  >
                    <Code size={16} aria-hidden="true" />
                    Open in VS Code
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => { setOpenProjectMenu(null); onOpenGit(ws.projectPath) }}
                  >
                    <GitBranch size={16} aria-hidden="true" />
                    Git
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}
                  >
                    <FolderSymlink size={16} aria-hidden="true" />
                    Open Folder
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => { setOpenProjectMenu(null); void window.api.openSystemTerminal(ws.projectPath) }}
                  >
                    <Terminal size={16} aria-hidden="true" />
                    Open Terminal
                  </button>
                  <div className="menu-sep" aria-hidden="true" />
                  <button
                    className="menu-item danger"
                    onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}
                  >
                    <X size={16} aria-hidden="true" />
                    Remove
                  </button>
                </BaseDropdown>
              </div>
            </div>
            {expanded[ws.projectPath] && (
              <ul className="session-list">
                {ws.sessions.filter(s => s.id !== DRAFT_SESSION_ID).map(s => {
                  const status = sessionStatus(ws.projectPath, s.id)
                  const running = isSessionRunning(ws.projectPath, s.id)
                  const activeSession = activeSessionByPath[ws.projectPath] === s.id && ws.projectPath === activePath
                  return (
                    <li
                      key={s.id}
                      className={`session-row ${activeSession ? 'active' : ''}`}
                      onClick={() => onSelectSession(ws.projectPath, s.id)}
                    >
                      <span className={`session-dot session-status-${status}`} aria-label={status} />
                      <span className="session-name">{s.name}</span>
                      <SessionRowMenu
                        running={running}
                        onRename={name => onRenameSession(ws.projectPath, s.id, name)}
                        onDelete={() => onDeleteSession(ws.projectPath, s.id)}
                        onStop={() => onStopSession(s.id)}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
          )
        })}
      </ul>
      )}
      <footer className="sidebar-footer">
        <BaseDropdown
          open={footerMenuOpen}
          onOpenChange={setFooterMenuOpen}
          placement="top-start"
          menuClassName="sidebar-menu-dropdown sidebar-footer-dropdown"
          trigger={(
            <button
              className="sidebar-settings-btn sidebar-footer-menu"
              title="Menu"
              aria-label="Menu"
            >
              <Settings size={15} aria-hidden="true" />
              <span className="sidebar-settings-label">Menu</span>
            </button>
          )}
        >
          <button
            className="menu-item"
            onClick={() => { setFooterMenuOpen(false); onOpenSettings() }}
          >
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
          <button
            className="menu-item"
            onClick={() => { setFooterMenuOpen(false); onOpenProviders() }}
          >
            <Server size={16} aria-hidden="true" />
            Providers
          </button>
          <button
            className="menu-item"
            onClick={() => { setTheme(t => t === 'dark' ? 'light' : 'dark') }}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item"
            disabled={updateChecking}
            onClick={onCheckUpdate}
          >
            <RefreshCw size={16} aria-hidden="true" className={updateChecking ? 'spin' : undefined} />
            <span className="menu-item-label">{updateChecking ? 'Checking…' : 'Check update'}</span>
            <span className="sidebar-update-version">v{version || '…'}</span>
          </button>
        </BaseDropdown>
      </footer>
    </aside>
  )
}

/**
 * Per-session `...` menu: Rename (inline input), Delete (always) and Stop (only
 * while running). Owns its own outside-click handling — `open` is local state,
 * so Sidebar's document listener cannot close it.
 */
function SessionRowMenu({ running, onRename, onDelete, onStop }: {
  running: boolean
  onRename: (name: string) => void
  onDelete: () => void
  onStop: () => void
}) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState('')

  return (
    <span className="session-menu" onClick={e => e.stopPropagation()}>
      <BaseDropdown
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        menuClassName="sidebar-menu-dropdown session-menu-dropdown"
        trigger={(
          <button
            className="icon-btn"
            title="Session menu"
            aria-label="Session menu"
          >
            <MoreVertical size={13} aria-hidden="true" />
          </button>
        )}
      >
        <button className="menu-item" onClick={() => { setOpen(false); setRenaming(true) }}>
          <Pencil size={16} aria-hidden="true" />
          Rename
        </button>
        {running && (
          <button className="menu-item" onClick={() => { setOpen(false); onStop() }}>
            <Square size={16} aria-hidden="true" />
            Stop
          </button>
        )}
        <div className="menu-sep" aria-hidden="true" />
        <button className="menu-item danger" onClick={() => { setOpen(false); setConfirmDelete(true) }}>
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </button>
      </BaseDropdown>
      {renaming && (
        <input
          className="input session-rename-input"
          autoFocus
          placeholder="Session name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && name.trim()) { onRename(name.trim()); setRenaming(false); setName('') }
            if (e.key === 'Escape') { setRenaming(false); setName('') }
          }}
          onBlur={() => { setRenaming(false); setName('') }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete session"
          message="Are you sure you want to delete this session? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmDelete(false)
            onDelete()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </span>
  )
}
