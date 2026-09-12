import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'
import type { BrowserStatusInfo } from '@shared/browser-types'
import type {
  AgentConfig, AgentState, ArtifactEntry, GitStatus, Template, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
} from '@shared/types'
import Sidebar from './components/Sidebar'
import SessionPanes from './components/SessionPanes'
import BackgroundPanel from './components/BackgroundPanel'
import EmptyState from './components/EmptyState'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import RightPanel from './components/RightPanel'
import SettingsDialog, { type TabId } from './components/settings/SettingsDialog'
import BrowserDialog from './components/BrowserDialog'
import InstallGuideDialog from './components/InstallGuideDialog'
import UpdateDialog from './components/UpdateDialog'

export interface PaneModel {
  agent: AgentConfig
  state: AgentState
  git: GitStatus | null
}

// Upper bound on how many projects stay mounted as keep-alives.
export const MAX_KEEP_ALIVE = 5

// One project's pane shell. Kept-alive projects are mounted but hidden via
// `.workspace-hidden`; the app toggles which one is visible by swapping the
// `workspace-active` wrapper, so hidden ChatPanels keep streaming events.
function WorkspaceView({
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane
}: {
  runtime: WorkspaceRuntime
  backgrounds: Record<string, boolean>
  activeSessionByPath: Record<string, string>
  onActiveChange: (path: string, id: string) => void
  onRemovePane: (path: string, id: string) => void
}) {
  const panes: PaneModel[] = useMemo(() =>
    runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'idle', exitCode: null, lastOutputAt: null, alert: 'normal'
      },
      git: runtime.git
    })), [runtime])

  const activeId = useMemo(() => {
    if (panes.length === 0) return null
    const remembered = activeSessionByPath[runtime.workspace.projectPath]
    return remembered && panes.some(p => p.agent.id === remembered) ? remembered : (panes[0]?.agent.id ?? null)
  }, [panes, runtime.workspace.projectPath, activeSessionByPath])

  if (panes.length === 0) return <EmptyState hasWorkspace />

  return (
    <>
      <SessionPanes
        panes={panes}
        activeId={activeId}
        onActiveChange={id => onActiveChange(runtime.workspace.projectPath, id)}
        backgrounds={backgrounds}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
      />
      <BackgroundPanel
        panes={panes}
        backgrounds={backgrounds}
        onOpen={agentId => void window.api.setAgentBackground(agentId, false)}
        onStop={agentId => void window.api.stopChat(agentId)}
        onRemove={id => onRemovePane(runtime.workspace.projectPath, id)}
      />
    </>
  )
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<TabId>('agents')
  // Every loaded project's workspace stays mounted (hidden via CSS display:none)
  // so switching back is instant and hidden agents keep streaming into their feed.
  const [runtimes, setRuntimesState] = useState<Record<string, WorkspaceRuntime>>({})
  const [activePath, setActivePathState] = useState<string | null>(null)
  // Most recently used at the head; bounds keep-alive memory (LRU eviction).
  const [keepAliveOrder, setKeepAliveOrderState] = useState<string[]>([])
  const [backgrounds, setBackgrounds] = useState<Record<string, boolean>>({})
  const [browser, setBrowser] = useState<BrowserStatusInfo | null>(null)
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false)
  const [installGuide, setInstallGuide] = useState<BrowserInstallGuideEvent | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdaterStatusEvent | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [upToDateOpen, setUpToDateOpen] = useState(false)
  const manualCheckRef = useRef(false)
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('meow.rightpanel.open') !== '0')
  const [rightTab, setRightTab] = useState<'tree' | 'artifacts'>(() =>
    localStorage.getItem('meow.rightpanel.tab') === 'artifacts' ? 'artifacts' : 'tree')
  const [rightWidth, setRightWidth] = useState(() => {
    const w = Number(localStorage.getItem('meow.rightpanel.width'))
    return Number.isFinite(w) && w >= 240 && w <= 600 ? w : 280
  })
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactEntry[]>>({})
  // Project path -> agent ids currently waiting on a permission/question
  // prompt (needs user reply/approval). Drives the sidebar badges.
  const [needsInput, setNeedsInput] = useState<Record<string, string[]>>({})
  // Active session per project path so switching workspaces and coming back
  // restores the session that was showing (persisted across restarts too).
  const [activeSessionByPath, setActiveSessionByPath] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('meow.activeSessionByPath')
      return raw ? JSON.parse(raw) as Record<string, string> : {}
    } catch {
      return {}
    }
  })
  // Refs mirror the state so stable mount-once subscriptions and callbacks never
  // read a stale value (state updates run at commit, refs update synchronously).
  const runtimesRef = useRef<Record<string, WorkspaceRuntime>>({})
  const orderRef = useRef<string[]>([])
  const activePathRef = useRef<string | null>(null)
  // agentIds with a turn in flight — eviction skips projects owning any of these.
  const runningAgentsRef = useRef<Set<string>>(new Set())

  const setRuntimes = useCallback((updater: (prev: Record<string, WorkspaceRuntime>) => Record<string, WorkspaceRuntime>) => {
    setRuntimesState(prev => {
      const next = updater(prev)
      runtimesRef.current = next
      return next
    })
  }, [])

  const setKeepAliveOrder = useCallback((updater: (prev: string[]) => string[]) => {
    setKeepAliveOrderState(prev => {
      const next = updater(prev)
      orderRef.current = next
      return next
    })
  }, [])

  const setActivePath = useCallback((path: string | null) => {
    activePathRef.current = path
    setActivePathState(path)
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  useEffect(() => {
    localStorage.setItem('meow.rightpanel.open', rightOpen ? '1' : '0')
  }, [rightOpen])
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.tab', rightTab)
  }, [rightTab])
  useEffect(() => {
    localStorage.setItem('meow.rightpanel.width', String(rightWidth))
  }, [rightWidth])
  useEffect(() => {
    localStorage.setItem('meow.activeSessionByPath', JSON.stringify(activeSessionByPath))
  }, [activeSessionByPath])

  useEffect(() => {
    return window.api.onArtifactsChanged(({ projectPath, artifacts: list }) => {
      setArtifacts(prev => ({ ...prev, [projectPath]: list }))
    })
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
    void window.api.listTemplates().then(setTemplates)
  }, [refreshWorkspaces])

  useEffect(() => {
    const offState = window.api.onAgentState(({ agentId, state }) => {
      if (state.status === 'running') runningAgentsRef.current.add(agentId)
      else runningAgentsRef.current.delete(agentId)
      const path = Object.keys(runtimesRef.current).find(p =>
        runtimesRef.current[p].workspace.agents.some(a => a.id === agentId))
      if (!path) return
      setRuntimes(prev => ({
        ...prev,
        [path]: { ...prev[path], agents: prev[path].agents.map(a => (a.agentId === agentId ? state : a)) }
      }))
    })
    const offGit = window.api.onGitStatus(({ projectPath, git }) => {
      setRuntimes(prev => (prev[projectPath] ? { ...prev, [projectPath]: { ...prev[projectPath], git } } : prev))
    })
    const offBg = window.api.onAgentBackground(({ agentId, background }) => {
      setBackgrounds(prev => ({ ...prev, [agentId]: background }))
    })
    const offConfig = window.api.onAgentConfig(({ agentId, config }) => {
      const path = Object.keys(runtimesRef.current).find(p =>
        runtimesRef.current[p].workspace.agents.some(a => a.id === agentId))
      if (!path) return
      setRuntimes(prev => ({
        ...prev,
        [path]: {
          ...prev[path],
          workspace: {
            ...prev[path].workspace,
            agents: prev[path].workspace.agents.map(a => a.id === agentId ? config : a)
          }
        }
      }))
    })
    const offBrowser = window.api.onBrowserStatus((info) => {
      setBrowser(info)
    })
    const offInstallGuide = window.api.onBrowserOpenInstallGuide((e) => {
      setInstallGuide(e)
    })
    const offUpdater = window.api.onUpdaterStatus((e) => {
      setUpdateStatus(e)
      setUpdateChecking(e.type === 'checking')
      // Download runs in the background even when the popup is closed — when
      // it finishes, bring the dialog back so the user can restart now or
      // defer to later.
      if (e.type === 'update-available' || e.type === 'downloaded') setUpdateDialogOpen(true)
      if (e.type === 'error' || e.type === 'not-supported') setUpdateDialogOpen(false)
      // Only surface "up to date" when the user asked for a manual check —
      // the automatic check on startup must not pop a dialog.
      if (e.type === 'up-to-date' && manualCheckRef.current) {
        manualCheckRef.current = false
        setUpToDateOpen(true)
      }
    })
    void window.api.getBrowserStatus().then(setBrowser)
    return () => {
      offState()
      offGit()
      offBg()
      offConfig()
      offBrowser()
      offInstallGuide()
      offUpdater()
    }
  }, [])

  // Sidebar "needs input" badges: seed from main (agents waiting from before
  // this window mounted) then keep in sync via push events.
  useEffect(() => {
    const offPrompt = window.api.onPromptState(({ projectPath, agentId, pending }) => {
      setNeedsInput(prev => {
        const list = prev[projectPath] ?? []
        if (pending) {
          if (list.includes(agentId)) return prev
          return { ...prev, [projectPath]: [...list, agentId] }
        }
        if (!list.includes(agentId)) return prev
        const next = list.filter(a => a !== agentId)
        if (next.length === 0) {
          const copy = { ...prev }
          delete copy[projectPath]
          return copy
        }
        return { ...prev, [projectPath]: next }
      })
    })
    void window.api.listPromptStates().then(states => {
      setNeedsInput(Object.fromEntries(states.map(s => [s.projectPath, s.agentIds])))
    })
    // OS notification click -> jump to the project + session of the waiting agent.
    const offActivate = window.api.onActivateAgent(({ projectPath, agentId }) => {
      setActiveSessionByPath(prev => (prev[projectPath] === agentId ? prev : { ...prev, [projectPath]: agentId }))
      if (activePathRef.current !== projectPath) {
        void activateRef.current(projectPath)
      }
    })
    return () => {
      offPrompt()
      offActivate()
    }
  }, [])

  const handleCheckUpdate = useCallback(() => {
    manualCheckRef.current = true
    window.api.checkForUpdates()
  }, [])

  const openWorkspace = useCallback(async (path: string) => {
    const rt = await window.api.openWorkspace(path)
    const list = await window.api.listArtifacts(path)
    setRuntimes(prev => ({ ...prev, [path]: rt }))
    setActivePath(path)
    // Most recently used at the head of keepAliveOrder.
    setKeepAliveOrder(prev => [path, ...prev.filter(p => p !== path)])
    setArtifacts(prev => ({ ...prev, [path]: list }))
    setBackgrounds(Object.fromEntries(rt.workspace.agents.map(a => [a.id, a.background ?? false])))
    evictIfNeeded()
  }, [])

  // Fast toggle for an already-loaded project: main only repoints activeProject
  // and its pollers; the mounted runtime is reused so its sessions keep running.
  const activate = useCallback((path: string) => {
    if (!runtimesRef.current[path]) {
      void openWorkspace(path)
      return
    }
    setActivePath(path)
    setKeepAliveOrder(prev => [path, ...prev.filter(p => p !== path)])
    evictIfNeeded()
    void window.api.activateWorkspace(path).then(rt => {
      // Refresh the cached entry's agent states (statuses may have moved while hidden).
      setRuntimes(prev => (prev[path] ? { ...prev, [path]: { ...prev[path], agents: rt.agents } } : prev))
    })
  }, [openWorkspace])
  const activateRef = useRef(activate)
  activateRef.current = activate

  // Keeps at most MAX_KEEP_ALIVE projects mounted. Only the single LRU project
  // (tail of keepAliveOrder, never the active one) is a candidate; if its agent is
  // still running the eviction waits — stepping aside means dropping the one
  // project the user just switched away from, which is usually the least safe to
  // unmount. Retry happens on 'done'/'error' via evictIfNeeded().
  const evictIfNeeded = useCallback((): void => {
    const victims: string[] = []
    const order = [...orderRef.current]
    for (let i = order.length - 1; i >= 0; i--) {
      const p = order[i]
      if (p === activePathRef.current) continue
      const rt = runtimesRef.current[p]
      if (rt && rt.workspace.agents.some(a => runningAgentsRef.current.has(a.id))) break
      victims.push(p)
      if (order.length - victims.length <= MAX_KEEP_ALIVE) break
    }
    if (victims.length === 0) return
    const victimSet = new Set(victims)
    setRuntimes(prev => {
      const next = { ...prev }
      for (const p of victimSet) delete next[p]
      return next
    })
    setKeepAliveOrder(prev => prev.filter(p => !victimSet.has(p)))
  }, [setRuntimes, setKeepAliveOrder])

  // Retry eviction the moment a hidden project's turn ends (a running agent
  // previously blocked its eviction).
  useEffect(() => {
    return window.api.onChatEvent((e) => {
      if (e.agentId == null) return
      if (e.type === 'turn-started') runningAgentsRef.current.add(e.agentId)
      else if (e.type === 'done' || e.type === 'error') {
        runningAgentsRef.current.delete(e.agentId)
        evictIfNeeded()
      }
    })
  }, [evictIfNeeded])

  const removeWorkspace = useCallback(async (path: string) => {
    try {
      await window.api.removeWorkspace(path)
    } catch {
      /* surface via sidebar later; still refresh list */
    }
    setRuntimes(prev => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
    setKeepAliveOrder(prev => prev.filter(p => p !== path))
    setActiveSessionByPath(prev => {
      if (!(path in prev)) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
    if (activePathRef.current === path) {
      // Main already reset activeProject (WorkspaceRemove). Repoint at the next
      // most recently used remaining project, or clear.
      const next = (orderRef.current.filter(p => p !== path))[0] ?? null
      setActivePath(next)
      if (next) void window.api.activateWorkspace(next)
    }
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  const removeAgent = useCallback(async (path: string, agentId: string) => {
    try {
      await window.api.removeAgent(path, agentId)
    } catch {
      /* surface via pane menu later; still refresh */
    }
    const rt = await window.api.openWorkspace(path)
    // Merge the fresh runtime in, but keep the cached git snapshot (runtimeFor
    // returns git:null — do not clobber a real status we already show).
    setRuntimes(prev => (prev[path]
      ? { ...prev, [path]: { ...prev[path], ...rt, git: rt.git ?? prev[path].git } }
      : { ...prev, [path]: rt }))
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  const handleRemovePane = useCallback((path: string, id: string) => {
    void removeAgent(path, id)
  }, [removeAgent])

  const handleWorkspaceActiveChange = useCallback((path: string, id: string) => {
    setActiveSessionByPath(prev => (prev[path] === id ? prev : { ...prev, [path]: id }))
  }, [])

  // Sidebar "+": every new session is a native meow session, and creating it also
  // makes it the project's active one (main appends it last in `agents`). Returns
  // false when the create failed, so the last-session delete can abort instead of
  // leaving a project with no sessions.
  const onNewSession = useCallback(async (path: string): Promise<boolean> => {
    const created = await window.api.addAgent(path, {
      name: 'New session', templateId: 'meow', cwd: path, kind: 'native'
    }).catch(() => null)
    if (!created) return false
    setRuntimes(prev => (prev[path]
      ? { ...prev, [path]: { ...prev[path], ...created, git: created.git ?? prev[path].git } }
      : { ...prev, [path]: created }))
    activate(path)
    const newId = created.workspace.agents[created.workspace.agents.length - 1]?.id
    if (newId) setActiveSessionByPath(prev => (prev[path] === newId ? prev : { ...prev, [path]: newId }))
    await refreshWorkspaces()
    return true
  }, [activate, refreshWorkspaces])

  const onSelectSession = useCallback((path: string, id: string) => {
    if (activePathRef.current !== path) activate(path)
    handleWorkspaceActiveChange(path, id)
  }, [activate, handleWorkspaceActiveChange])

  const onRenameSession = useCallback(async (path: string, id: string, name: string) => {
    try {
      await window.api.renameAgent(path, id, name)
    } catch {
      /* surface via sidebar later; still refresh list */
    }
    await refreshWorkspaces()
  }, [refreshWorkspaces])

  // A project must always own at least one session. When the deleted session is
  // the project's last, create its replacement **first** (create-then-delete): the
  // project is never left at zero sessions, and a failed create aborts the delete
  // instead of destroying the last session. "Last" is detected from local state
  // before touching main — the mounted runtime when the project is open, else the
  // sidebar summary (a project need not be opened to list and delete a session).
  const onDeleteSession = useCallback(async (path: string, id: string) => {
    const rt = runtimesRef.current[path]
    const knownIds = rt
      ? rt.workspace.agents.map(a => a.id)
      : (workspaces.find(w => w.projectPath === path)?.sessions.map(s => s.id) ?? [])
    const isLastSession = knownIds.length <= 1 && knownIds.includes(id)
    if (isLastSession && !(await onNewSession(path))) return
    await removeAgent(path, id)
  }, [onNewSession, removeAgent, workspaces])

  const onStopSession = useCallback((id: string) => {
    void window.api.stopChat(id)
  }, [])

  const activeRuntime = activePath ? (runtimes[activePath] ?? null) : null

  return (
    <div className="app">
      <TitleBar panelOpen={rightOpen} onTogglePanel={() => setRightOpen(v => !v)} />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          needsInput={needsInput}
          activePath={activePath}
          runtimes={runtimes}
          activeSessionByPath={activeSessionByPath}
          onOpen={openWorkspace}
          onRemove={removeWorkspace}
          onRefresh={refreshWorkspaces}
          onNewSession={onNewSession}
          onSelectSession={onSelectSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
          onStopSession={onStopSession}
          onOpenSettings={() => { setSettingsTab('agents'); setShowSettings(true) }}
          onOpenProviders={() => { setSettingsTab('providers'); setShowSettings(true) }}
          onOpenGit={path => void window.api.gitOpenViewer(path)}
          onCheckUpdate={handleCheckUpdate}
          updateChecking={updateChecking}
        />
        <main className="main">
          {activePath && runtimes[activePath] && (
            <div className="workspace-active">
              <WorkspaceView
                runtime={runtimes[activePath]}
                backgrounds={backgrounds}
                activeSessionByPath={activeSessionByPath}
                onActiveChange={handleWorkspaceActiveChange}
                onRemovePane={handleRemovePane}
              />
            </div>
          )}
          {/* Hidden projects stay mounted (display:none) so their ChatPanels keep
              consuming ChatEvents and the transcript stays live — every session of
              a kept-alive project keeps running too. */}
          {keepAliveOrder
            .filter(p => p !== activePath && runtimes[p])
            .map(p => (
              <div className="workspace-hidden" key={p} aria-hidden="true">
                <WorkspaceView
                  runtime={runtimes[p]}
                  backgrounds={backgrounds}
                  activeSessionByPath={activeSessionByPath}
                  onActiveChange={handleWorkspaceActiveChange}
                  onRemovePane={handleRemovePane}
                />
              </div>
            ))}
        </main>
        {rightOpen && (
          <RightPanel
            root={activePath ?? null}
            tab={rightTab}
            width={rightWidth}
            artifacts={artifacts[activePath ?? ''] ?? []}
            onTabChange={setRightTab}
            onWidthChange={setRightWidth}
            onClearArtifacts={() => {
              if (activePath) void window.api.clearArtifacts(activePath)
            }}
          />
        )}
      </div>
      <StatusBar
        workspaceName={activeRuntime?.workspace.name ?? null}
        git={activeRuntime?.git ?? null}
        agents={activeRuntime?.agents ?? []}
        browser={browser}
        onBrowserClick={() => setBrowserDialogOpen(true)}
        onGitClick={activeRuntime ? () => void window.api.gitOpenViewer(activeRuntime.workspace.projectPath) : undefined}
      />
      {browserDialogOpen && (
        <BrowserDialog status={browser} onClose={() => setBrowserDialogOpen(false)} />
      )}
      {installGuide && (
        <InstallGuideDialog guide={installGuide} onClose={() => setInstallGuide(null)} />
      )}
      {updateDialogOpen && (updateStatus?.type === 'update-available' || updateStatus?.type === 'downloaded' || updateStatus?.type === 'download-progress') && (
        <UpdateDialog
          status={updateStatus}
          onClose={() => setUpdateDialogOpen(false)}
          onInstall={() => void window.api.installUpdate()}
        />
      )}
      {upToDateOpen && (
        <UpToDateDialog version={updateStatus?.type === 'up-to-date' ? updateStatus.currentVersion : undefined} onClose={() => setUpToDateOpen(false)} />
      )}
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          projectPath={activePath ?? undefined}
          templates={templates}
          onTemplatesChange={setTemplates}
          initialTab={settingsTab}
          agentId={activeRuntime?.workspace.agents[0]?.id}
        />
      )}
    </div>
  )
}

function UpToDateDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Update</h3>
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        <p className="settings-hint">
          This is the latest version{version ? ` (v${version})` : ''}.
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
