import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings } from '@shared/types'
import BaseModal from '../common/BaseModal'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import UpdatesTab from './UpdatesTab'
import ProvidersTab from './ProvidersTab'
import PersonalizeTab from './PersonalizeTab'

export type TabId = 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'updates' | 'providers' | 'personalize'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Profiles' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'providers', label: 'Providers' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' },
  { id: 'updates', label: 'Updates' },
  { id: 'personalize', label: 'Personalize' }
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
    return () => { cancelled = true }
  }, [agentId])

  const patch = useCallback((partial: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const onPersisted = useCallback((updated: MeowSettings) => {
    lastPersistedRef.current = JSON.stringify(updated)
    setDraft(updated)
  }, [])

  const doSave = useCallback(async () => {
    if (!draftRef.current || savingRef.current) return
    const current = draftRef.current
    if (JSON.stringify(current) === lastPersistedRef.current) return

    savingRef.current = true
    setSaveState('saving')
    try {
      const result = await window.api.saveSettings(current)
      if (draftRef.current === current) {
        draftRef.current = result
        lastPersistedRef.current = JSON.stringify(result)
        setDraft(result)
      }
      setMcpStatus(await window.api.getMcpStatus())
      setSaveState('saved')
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
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
    setSaveState('idle')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, 500)
  }, [draft, doSave])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      const current = draftRef.current
      if (current && JSON.stringify(current) !== lastPersistedRef.current) {
        void window.api.saveSettings(current)
      }
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const id = window.setTimeout(() => setSaveState('idle'), 2000)
    return () => window.clearTimeout(id)
  }, [saveState])

  return (
    <BaseModal
      title="Settings"
      onClose={onClose}
      size="xl"
      className="settings-modal-dialog"
    >
      <div className="settings-body">
        <aside className="settings-sidebar">
          <nav className="settings-nav">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`settings-nav-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
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
    </BaseModal>
  )
}
