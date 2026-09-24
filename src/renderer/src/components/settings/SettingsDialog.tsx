import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Cpu,
  Plug,
  ShieldCheck,
  Terminal,
  Sliders,
  Palette,
  DownloadCloud,
  Share2
} from 'lucide-react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings } from '@shared/types'
import BaseModal from '../common/BaseModal'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import ExternalTab from './ExternalTab'
import UpdatesTab from './UpdatesTab'
import ProvidersTab from './ProvidersTab'
import PersonalizeTab from './PersonalizeTab'

export type TabId =
  | 'agents'
  | 'permissions'
  | 'mcp'
  | 'context'
  | 'commands'
  | 'remote'
  | 'external'
  | 'updates'
  | 'providers'
  | 'personalize'

interface TabItem {
  id: TabId
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

interface TabGroup {
  title: string
  isSystem?: boolean
  items: TabItem[]
}

const TAB_GROUPS: TabGroup[] = [
  {
    title: 'Intelligence',
    items: [
      { id: 'agents', label: 'Sub-agents', icon: Bot },
      { id: 'providers', label: 'Providers', icon: Cpu },
      { id: 'mcp', label: 'MCP', icon: Plug }
    ]
  },
  {
    title: 'Controls & Context',
    items: [
      { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
      { id: 'commands', label: 'Commands', icon: Terminal },
      { id: 'context', label: 'Context', icon: Sliders },
      { id: 'external', label: 'External delegation', icon: Share2 }
    ]
  },
  {
    title: 'Preferences',
    items: [
      { id: 'personalize', label: 'Personalize', icon: Palette }
    ]
  },
  {
    title: 'System',
    isSystem: true,
    items: [{ id: 'updates', label: 'Updates', icon: DownloadCloud }]
  }
]

interface Props {
  onClose: () => void
  projectPath?: string
  initialTab?: TabId
  /** First registered agent, used to fetch the context limit for "auto ≈" placeholders. */
  agentId?: string
}

export default function SettingsDialog({ onClose, projectPath, initialTab = 'agents', agentId }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [draft, setDraft] = useState<MeowSettings | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [resolvedContextTokens, setResolvedContextTokens] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const draftRef = useRef<MeowSettings | null>(null)
  const lastPersistedRef = useRef('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [settings, mcps, nextCatalog] = await Promise.all([
        window.api.getSettings(),
        window.api.getMcpStatus(),
        window.api.listProviderCatalog()
      ])
      lastPersistedRef.current = JSON.stringify(settings)
      setDraft(settings)
      setMcpStatus(mcps)
      setCatalog(nextCatalog)
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    void window.api.getContextInfo(agentId).then(info => {
      if (!cancelled) setResolvedContextTokens(info.limit)
    })
    return () => {
      cancelled = true
    }
  }, [agentId])

  const patch = useCallback((partial: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const onPersisted = useCallback((updated: MeowSettings) => {
    lastPersistedRef.current = JSON.stringify(updated)
    setDraft(updated)
  }, [])

  const doSave = useCallback(async () => {
    if (!draftRef.current) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    const current = draftRef.current
    if (JSON.stringify(current) === lastPersistedRef.current) return

    savingRef.current = true
    if (mountedRef.current) setSaveState('saving')
    try {
      const result = await window.api.saveSettings(current)
      lastPersistedRef.current = JSON.stringify(result)
      if (mountedRef.current) {
        if (draftRef.current === current) {
          draftRef.current = result
          setDraft(result)
        }
        setMcpStatus(await window.api.getMcpStatus())
        setSaveState('saved')
      }
    } catch (err) {
      if (mountedRef.current) {
        setSaveError(String(err))
        setSaveState('error')
      }
    } finally {
      savingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void doSave()
      }
    }
  }, [])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!draft) return
    if (JSON.stringify(draft) === lastPersistedRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    if (mountedRef.current) setSaveState('idle')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, 500)
  }, [draft, doSave])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const current = draftRef.current
    if (current && JSON.stringify(current) !== lastPersistedRef.current) {
      void window.api.saveSettings(current)
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const id = window.setTimeout(() => setSaveState('idle'), 2000)
    return () => window.clearTimeout(id)
  }, [saveState])

  return (
    <BaseModal size="xl" onClose={onClose} className="settings-modal-dialog">
      <BaseModal.Header title="Settings" onClose={onClose} />
      <BaseModal.Body noPadding>
        <div className="settings-body">
          <aside className="settings-sidebar">
            <nav className="settings-nav">
              {TAB_GROUPS.map((group, groupIdx) => (
                <div
                  key={group.title || groupIdx}
                  className={`settings-nav-group ${group.isSystem ? 'settings-nav-group-system' : ''}`}
                >
                  {group.title && <div className="settings-nav-title">{group.title}</div>}
                  {group.items.map(t => {
                    const Icon = t.icon
                    const isActive = tab === t.id
                    return (
                      <button
                        key={t.id}
                        className={`settings-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => setTab(t.id)}
                      >
                        <span className="settings-nav-icon">
                          <Icon size={16} />
                        </span>
                        <span>{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
          </aside>
          <div className="settings-content">
            {draft && tab === 'agents' && (
              <AgentsTab
                agents={draft.agents}
                providers={draft.providers}
                subagentModels={draft.subagentModels}
                onChangeAgents={agents => patch({ agents })}
                onChangeSubagentModels={subagentModels => patch({ subagentModels })}
              />
            )}
            {draft && tab === 'permissions' && (
              <PermissionsTab permission={draft.permission} onChange={permission => patch({ permission })} />
            )}
            {draft && tab === 'mcp' && (
              <McpTab
                mcp={draft.mcp}
                status={mcpStatus}
                onChange={mcp => patch({ mcp })}
                onReconnect={async () => {
                  if (draft) {
                    await window.api.saveSettings(draft)
                  }
                  const result = await window.api.reconnectMcp()
                  setMcpStatus(result)
                  return result
                }}
              />
            )}
            {draft && tab === 'providers' && (
              <ProvidersTab
                settings={draft}
                catalog={catalog}
                onChange={patch}
                onPersisted={onPersisted}
                onRefresh={() => void refresh()}
              />
            )}
            {draft && tab === 'context' && (
              <ContextTab
                maxSteps={draft.maxSteps}
                compaction={draft.compaction}
                toolOutput={draft.toolOutput}
                notifications={draft.notifications ?? { needsInput: true, onDone: true }}
                mcpOutput={draft.mcpOutput}
                resolvedContextTokens={resolvedContextTokens}
                onChange={ctx => patch(ctx)}
              />
            )}
            {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
            {tab === 'remote' && <RemoteTab />}
            {tab === 'external' && <ExternalTab />}
            {tab === 'updates' && <UpdatesTab />}
            {tab === 'personalize' && <PersonalizeTab />}
          </div>
        </div>
        {saveState !== 'idle' && (
          <div className={`settings-save-pill ${saveState}`} role="status">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved ✓'}
            {saveState === 'error' && (saveError || 'Save failed')}
          </div>
        )}
      </BaseModal.Body>
    </BaseModal>
  )
}
