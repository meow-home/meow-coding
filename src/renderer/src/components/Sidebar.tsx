import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, GitBranch, Moon, MoreVertical, PanelLeft, Plus, RefreshCw, Settings, Server, Sun } from 'lucide-react'
import type { WorkspaceRuntime, WorkspaceSummary } from '@shared/types'
import AddProjectDialog from './AddProjectDialog'
import { applyTheme, type Theme } from '../theme'

function MoreIcon() {
  return <MoreVertical size={14} aria-hidden="true" />
}

type SessionStatus = 'running' | 'waiting' | 'idle'

interface Props {
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

export default function Sidebar({
  workspaces, needsInput, activePath, runtimes, activeSessionByPath, onOpen, onRemove, onRefresh,
  onOpenSettings, onOpenProviders, onOpenGit, onCheckUpdate, updateChecking,
  onNewSession, onSelectSession, onRenameSession, onDeleteSession, onStopSession
}: Props) {
  const [showAddProject, setShowAddProject] = useState(false)
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [footerMenuPos, setFooterMenuPos] = useState<{ x: number; bottom: number } | null>(null)
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

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      // Menus may be portaled to <body>, so also ignore clicks inside them.
      if (target instanceof Element &&
        (target.closest('.project-menu') || target.closest('.project-menu-dropdown') ||
         target.closest('.sidebar-footer-menu') || target.closest('.sidebar-footer-dropdown'))) return
      setOpenProjectMenu(null)
      setProjectMenuPos(null)
      setFooterMenuOpen(false)
      setFooterMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenProjectMenu(null)
        setProjectMenuPos(null)
        setFooterMenuOpen(false)
        setFooterMenuPos(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const handleAddProject = async (projectPath: string, name: string) => {
    try {
      await window.api.addWorkspace(projectPath, name)
      setShowAddProject(false)
      setError('')
      onRefresh()
      onOpen(projectPath)
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
      <div className="panel-head sidebar-head">
        <span className="panel-title">Projects</span>
        <button className="btn primary small" onClick={() => setShowAddProject(true)}>Add Project</button>
        <button
          className={`sidebar-toggle ${collapsed ? 'collapsed' : ''}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(v => !v)}
        >
          <PanelLeft size={14} aria-hidden="true" />
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
              onClick={() => onOpen(ws.projectPath)}
              title={ws.projectPath}
              onContextMenu={e => {
                e.preventDefault()
                setProjectMenuPos({ x: e.clientX, y: e.clientY })
                setOpenProjectMenu(ws.projectPath)
              }}
            >
              <span className="project-name">{ws.name}</span>
              <button
                className="project-expand"
                aria-label={expanded[ws.projectPath] ? 'Collapse' : 'Expand'}
                onClick={e => {
                  e.stopPropagation()
                  setExpanded(p => ({ ...p, [ws.projectPath]: !p[ws.projectPath] }))
                }}
              >
                {expanded[ws.projectPath]
                  ? <ChevronDown size={13} aria-hidden="true" />
                  : <ChevronRight size={13} aria-hidden="true" />}
              </button>
              {inputCount > 0 && (
                <span
                  className="project-badge"
                  title={`${inputCount} session(s) need your reply/approval`}
                >
                  {inputCount}
                </span>
              )}
              <div className="project-menu project-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="btn ghost small"
                  title="New session"
                  aria-label={`new session ${ws.name}`}
                  onClick={() => onNewSession(ws.projectPath)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button
                  className="btn ghost small"
                  title="Project menu"
                  aria-label={`menu ${ws.name}`}
                  onClick={e => {
                    // Anchor the portaled menu at the button, clamped to the viewport.
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const width = 160
                    const x = Math.max(4, Math.min(r.right - width, window.innerWidth - width - 8))
                    const y = r.bottom + 4
                    setProjectMenuPos({ x, y })
                    setOpenProjectMenu(p => (p === ws.projectPath ? null : ws.projectPath))
                  }}
                >
                  <span className="btn-icon"><MoreIcon /></span>
                </button>
                {openProjectMenu === ws.projectPath && projectMenuPos && createPortal(
                  <div
                    className="sidebar-menu-dropdown project-menu-dropdown"
                    style={{ position: 'fixed', left: projectMenuPos.x, top: projectMenuPos.y, right: 'auto', bottom: 'auto' }}
                  >
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpen(ws.projectPath) }}
                    >
                      Open
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openInEditor(ws.projectPath) }}
                    >
                      Open in VS Code
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpenGit(ws.projectPath) }}
                    >
                      <GitBranch size={14} aria-hidden="true" />
                      Git
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}
                    >
                      Open Folder
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openSystemTerminal(ws.projectPath) }}
                    >
                      Open Terminal
                    </button>
                    <button
                      className="menu-item danger"
                      onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}
                    >
                      Remove
                    </button>
                  </div>,
                  document.body
                )}
              </div>
            </div>
            {expanded[ws.projectPath] && (
              <ul className="session-list">
                {ws.sessions.map(s => {
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
      {showAddProject && (
        <AddProjectDialog onAdd={(p, n) => void handleAddProject(p, n)} onClose={() => setShowAddProject(false)} />
      )}
      <footer className="sidebar-footer">
        <button
          className="sidebar-settings-btn sidebar-footer-menu"
          title="Menu"
          aria-label="Menu"
          onClick={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const width = 160
            const x = Math.max(4, Math.min(r.right - width, window.innerWidth - width - 8))
            // Footer sits at the bottom edge of the window, so the menu opens
            // upward (bottom-anchored) to stay inside the viewport.
            const bottom = window.innerHeight - r.top + 4
            setFooterMenuPos({ x, bottom })
            setFooterMenuOpen(v => !v)
          }}
        >
          <Settings size={15} aria-hidden="true" />
          <span className="sidebar-settings-label">Menu</span>
        </button>
        {footerMenuOpen && footerMenuPos && createPortal(
          <div
            className="sidebar-menu-dropdown sidebar-footer-dropdown"
            style={{ position: 'fixed', left: footerMenuPos.x, right: 'auto', top: 'auto', bottom: footerMenuPos.bottom }}
          >
            <button
              className="menu-item"
              onClick={() => { setFooterMenuOpen(false); setFooterMenuPos(null); onOpenSettings() }}
            >
              <Settings size={14} aria-hidden="true" />
              Settings
            </button>
            <button
              className="menu-item"
              onClick={() => { setFooterMenuOpen(false); setFooterMenuPos(null); onOpenProviders() }}
            >
              <Server size={14} aria-hidden="true" />
              Providers
            </button>
            <button
              className="menu-item"
              onClick={() => { setTheme(t => t === 'dark' ? 'light' : 'dark') }}
            >
              {theme === 'dark' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <div className="sidebar-update-block">
              <span className="sidebar-update-version">v{version || '…'}</span>
              <div className="sidebar-update-actions">
                <button
                  className="btn small"
                  disabled={updateChecking}
                  onClick={onCheckUpdate}
                >
                  <RefreshCw size={12} aria-hidden="true" className={updateChecking ? 'spin' : undefined} />
                  {updateChecking ? 'Checking…' : 'Check update'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
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
  const [name, setName] = useState('')
  const rootRef = useRef<HTMLSpanElement>(null)

  // Close the dropdown when the click lands outside this menu. This listener is
  // only attached while `open` — the inline rename input appears only after the
  // dropdown has closed, so it can never be torn down mid-typing by this
  // handler; the input's own blur closes it.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <span className="session-menu" ref={rootRef} onClick={e => e.stopPropagation()}>
      <button
        className="btn ghost small"
        title="Session menu"
        aria-label="Session menu"
        onClick={() => setOpen(v => !v)}
      >
        <MoreVertical size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="sidebar-menu-dropdown session-menu-dropdown">
          <button className="menu-item" onClick={() => { setOpen(false); setRenaming(true) }}>Rename</button>
          {running && <button className="menu-item" onClick={() => { setOpen(false); onStop() }}>Stop</button>}
          <button className="menu-item danger" onClick={() => { setOpen(false); onDelete() }}>Delete</button>
        </div>
      )}
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
    </span>
  )
}
