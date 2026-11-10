import { useState, useEffect, useCallback } from 'react'
import {
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Copy,
  Check,
  X,
  AlertCircle,
  Plus
} from 'lucide-react'
import type {
  CliAgent,
  CliAgentsStatus,
  CliAgentStatus,
  CliInstallDescriptor,
  CliRuntimeDetectResult,
  CliRuntimeId
} from '@shared/types'
import BaseModal from '../common/BaseModal'
import BaseDropdown from '../common/BaseDropdown'
import CliLoginDialog from './CliLoginDialog'

export interface CliAgentsTabProps {
  projectPath?: string
}

interface RuntimeMeta {
  id: CliRuntimeId
  label: string
  sub: string
  logo: string
  isOc?: boolean
  docUrl: string
}

const RUNTIME_METAS: RuntimeMeta[] = [
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    sub: 'Google · subscription models, Gemini API keys, custom agents',
    logo: 'agy',
    docUrl: 'https://antigravity.google/docs'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    sub: 'Provider accounts · Anthropic, OpenAI, Copilot, OpenRouter, custom',
    logo: 'oc',
    isOc: true,
    docUrl: 'https://opencode.ai/docs'
  }
]

const OPENCODE_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', sub: 'Claude subscription or API key', glyph: 'A' },
  { id: 'openai', label: 'OpenAI', sub: 'ChatGPT / Codex sign-in', glyph: 'O' },
  { id: 'github-copilot', label: 'GitHub Copilot', sub: 'Device code', glyph: 'C' },
  { id: 'google', label: 'Google', sub: 'Gemini API key or OAuth', glyph: 'G' },
  { id: 'openrouter', label: 'OpenRouter', sub: 'API key or endpoint', glyph: 'R' },
  { id: 'custom', label: 'Custom provider', sub: 'Custom profile or endpoint', glyph: '✦' }
]

export default function CliAgentsTab({ projectPath }: CliAgentsTabProps) {
  const [status, setStatus] = useState<CliAgentsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [runtimeModels, setRuntimeModels] = useState<Record<CliRuntimeId, string[]>>({
    antigravity: [],
    opencode: []
  })
  const [detectResults, setDetectResults] = useState<Record<CliRuntimeId, CliRuntimeDetectResult | null>>({
    antigravity: null,
    opencode: null
  })
  const [installDescriptors, setInstallDescriptors] = useState<Record<CliRuntimeId, CliInstallDescriptor | null>>({
    antigravity: null,
    opencode: null
  })
  const [editingPathRuntime, setEditingPathRuntime] = useState<CliRuntimeId | null>(null)
  const [customPaths, setCustomPaths] = useState<Record<CliRuntimeId, string>>({
    antigravity: '',
    opencode: ''
  })
  const [copiedRuntime, setCopiedRuntime] = useState<CliRuntimeId | null>(null)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState<string | null>(null)

  const [activeLogin, setActiveLogin] = useState<{
    loginId: string
    runtime: CliRuntimeId
    agentId?: string
    label?: string
  } | null>(null)

  const [showGeminiKeyModal, setShowGeminiKeyModal] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiLabel, setGeminiLabel] = useState('')
  const [geminiSubmitting, setGeminiSubmitting] = useState(false)

  const [showCustomProviderModal, setShowCustomProviderModal] = useState(false)
  const [customProviderName, setCustomProviderName] = useState('')
  const [customProviderLabel, setCustomProviderLabel] = useState('')
  const [customProviderSubmitting, setCustomProviderSubmitting] = useState(false)

  const [agentToRemove, setAgentToRemove] = useState<CliAgent | null>(null)
  const [agentToRename, setAgentToRename] = useState<CliAgent | null>(null)
  const [renameLabel, setRenameLabel] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.getCliAgentsStatus()
      setStatus(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await window.api.getCliAgentsStatus()
        if (!cancelled) setStatus(s)
        const [agyModels, ocModels] = await Promise.all([
          window.api.listCliModels('antigravity').catch(() => []),
          window.api.listCliModels('opencode').catch(() => [])
        ])
        if (!cancelled) {
          setRuntimeModels({ antigravity: agyModels, opencode: ocModels })
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    const unsubAgents = window.api.onCliAgentsChanged((e) => {
      if (e.status) setStatus(e.status)
      else void refreshStatus()
    })
    const unsubSessions = window.api.onCliSessionsChanged(() => {
      void refreshStatus()
    })

    return () => {
      cancelled = true
      unsubAgents()
      unsubSessions()
    }
  }, [refreshStatus])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const handleToggleRuntime = async (runtime: CliRuntimeId, current: boolean) => {
    try {
      await window.api.setCliRuntimeEnabled(runtime, !current)
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDetect = async (runtime: CliRuntimeId) => {
    try {
      const res = await window.api.detectCliRuntime(runtime)
      setDetectResults(prev => ({ ...prev, [runtime]: res }))
      await refreshStatus()
      const models = await window.api.listCliModels(runtime).catch(() => [])
      setRuntimeModels(prev => ({ ...prev, [runtime]: models }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInstall = async (runtime: CliRuntimeId) => {
    try {
      const desc = await window.api.installCliRuntime(runtime)
      setInstallDescriptors(prev => ({ ...prev, [runtime]: desc }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSavePath = async (runtime: CliRuntimeId) => {
    try {
      const pathVal = customPaths[runtime]?.trim() || null
      await window.api.setCliRuntimePath(runtime, pathVal)
      setEditingPathRuntime(null)
      await refreshStatus()
      setNotice(`Binary path updated for ${runtime}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleResetPath = async (runtime: CliRuntimeId) => {
    try {
      await window.api.setCliRuntimePath(runtime, null)
      setEditingPathRuntime(null)
      await refreshStatus()
      setNotice(`Binary path reset to auto-detected for ${runtime}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAddAntigravityGoogle = async () => {
    try {
      const res = await window.api.addCliAgent('antigravity', 'google')
      if (res.loginId) {
        setActiveLogin({
          loginId: res.loginId,
          runtime: 'antigravity',
          agentId: res.agent?.id,
          label: 'Antigravity (Google)'
        })
      } else {
        await refreshStatus()
        setNotice('Antigravity Google agent added.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAddGeminiKey = async () => {
    if (!geminiKey.trim()) return
    setGeminiSubmitting(true)
    try {
      const res = await window.api.addCliAgent('antigravity', 'gemini-key', undefined, geminiKey.trim())
      if (res.agent?.id && geminiLabel.trim()) {
        await window.api.renameCliAgent(res.agent.id, geminiLabel.trim())
      }
      setShowGeminiKeyModal(false)
      setGeminiKey('')
      setGeminiLabel('')
      await refreshStatus()
      setNotice('Gemini API key agent created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeminiSubmitting(false)
    }
  }

  const handleAddOpenCode = async (provider: string, label?: string) => {
    try {
      const res = await window.api.addCliAgent('opencode', 'profile', provider)
      if (res.agent?.id && label?.trim()) {
        await window.api.renameCliAgent(res.agent.id, label.trim())
      }
      if (res.loginId) {
        setActiveLogin({
          loginId: res.loginId,
          runtime: 'opencode',
          agentId: res.agent?.id,
          label: `OpenCode · ${provider}`
        })
      } else {
        await refreshStatus()
        setNotice(`OpenCode agent for ${provider} added.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCustomProviderSubmit = async () => {
    if (!customProviderName.trim()) return
    setCustomProviderSubmitting(true)
    try {
      const name = customProviderName.trim()
      const label = customProviderLabel.trim() || undefined
      setShowCustomProviderModal(false)
      setCustomProviderName('')
      setCustomProviderLabel('')
      await handleAddOpenCode(name, label)
    } finally {
      setCustomProviderSubmitting(false)
    }
  }

  const handleActivate = async (agent: CliAgent) => {
    try {
      await window.api.activateCliAgent(agent.id)
      await refreshStatus()
      setNotice(`Activated agent "${agent.label}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSetDefault = async (agent: CliAgent) => {
    try {
      await window.api.setDefaultCliAgent(agent.id)
      await refreshStatus()
      setNotice(`Set "${agent.label}" as the default CLI agent.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateSession = async (agent: CliAgent) => {
    if (!projectPath) {
      setNotice('Open a project first to create a CLI session.')
      return
    }
    try {
      const s = await window.api.createCliSession(agent.id, projectPath)
      setNotice(`Created CLI session "${s.title}" (${s.id}).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRenameConfirm = async () => {
    if (!agentToRename || !renameLabel.trim()) return
    const id = agentToRename.id
    const label = renameLabel.trim()
    setAgentToRename(null)
    try {
      await window.api.renameCliAgent(id, label)
      await refreshStatus()
      setNotice(`Renamed agent to "${label}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRemoveConfirm = async () => {
    if (!agentToRemove) return
    const id = agentToRemove.id
    const label = agentToRemove.label
    setAgentToRemove(null)
    try {
      await window.api.removeCliAgent(id)
      await refreshStatus()
      setNotice(`Removed agent "${label}".`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading && !status) {
    return <div className="settings-tab">Loading CLI agents…</div>
  }

  if (!status) {
    return (
      <div className="settings-tab">
        <div className="settings-error">{error || 'Failed to load CLI agents status.'}</div>
      </div>
    )
  }

  const antigravityAgents = status.agents.filter(a => a.runtime === 'antigravity')
  const openCodeAgents = status.agents.filter(a => a.runtime === 'opencode')

  const renderStatusPill = (agentStatus: CliAgentStatus) => {
    switch (agentStatus) {
      case 'ready':
        return <span className="cli-pill ok"><span className="cli-dot" /> Ready</span>
      case 'needs-login':
        return <span className="cli-pill err"><span className="cli-dot" /> Needs login</span>
      case 'quota':
        return <span className="cli-pill warn"><span className="cli-dot" /> Quota low</span>
      case 'disabled':
        return <span className="cli-pill"><span className="cli-dot" /> Disabled</span>
      default:
        return <span className="cli-pill">{agentStatus}</span>
    }
  }

  const getAgentSub = (agent: CliAgent) => {
    const parts: string[] = []
    if (agent.email) parts.push(agent.email)
    if (agent.plan) parts.push(agent.plan)
    if (agent.provider) parts.push(agent.provider)
    if (agent.profileDir) parts.push(`profile: ${agent.profileDir}`)
    if (agent.model) parts.push(`model: ${agent.model}`)
    if (agent.mode) parts.push(`mode: ${agent.mode}`)
    return parts.join(' · ')
  }

  const getAgentAvatar = (agent: CliAgent) => {
    if (agent.kind === 'gemini-key') {
      return <div className="cli-avatar key">K</div>
    }
    if (agent.runtime === 'opencode') {
      const char = agent.provider ? agent.provider[0].toUpperCase() : 'O'
      return <div className="cli-avatar oc">{char}</div>
    }
    const char = agent.label ? agent.label[0].toUpperCase() : 'A'
    return <div className="cli-avatar">{char}</div>
  }

  return (
    <div className="settings-tab cli-agents-tab">
      <p className="settings-hint">
        External coding CLIs run as their own agents, with their own sessions, tools and permissions. Give an
        agent any task directly, or let a Meow session delegate to it and report back when the task is done.
      </p>

      {error && (
        <div className="cli-notice warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" className="icon-btn" onClick={() => setError(null)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="cli-notice" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button type="button" className="icon-btn" onClick={() => setNotice(null)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── RUNTIMES ────────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Runtimes</span>
          <span className="cli-pill">2 supported</span>
        </div>

        {RUNTIME_METAS.map((meta) => {
          const cfg = status.runtimes[meta.id] ?? { enabled: false, binaryPath: null }
          const isInstalled = Boolean(cfg.binaryPath)
          const detect = detectResults[meta.id]
          const desc = installDescriptors[meta.id]
          const agentsCount = status.agents.filter(a => a.runtime === meta.id).length
          const models = runtimeModels[meta.id] ?? []

          return (
            <div key={meta.id} className="cli-runtime-card">
              <div className="cli-runtime-top">
                <div className={`cli-runtime-logo ${meta.isOc ? 'oc' : ''}`}>{meta.logo}</div>
                <div className="cli-runtime-info">
                  <div className="cli-runtime-name">{meta.label}</div>
                  <div className="cli-runtime-sub">{meta.sub}</div>
                </div>
                <span style={{ flex: 1 }} />
                <span className={`cli-pill ${isInstalled ? 'ok' : 'warn'}`}>
                  <span className="cli-dot" />
                  {isInstalled ? `Installed${cfg.version ? ` · v${cfg.version}` : ''}` : 'Not installed'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cfg.enabled}
                  className={`cli-toggle ${cfg.enabled ? 'on' : ''}`}
                  title={cfg.enabled ? 'Enabled' : 'Disabled'}
                  onClick={() => handleToggleRuntime(meta.id, cfg.enabled)}
                />
              </div>

              <div className="cli-runtime-meta">
                <span>Binary <code>{cfg.binaryPath ?? 'Not configured'}</code></span>
                <span>Agents <b>{agentsCount}</b></span>
                <span>Max parallel tasks <b>{cfg.maxConcurrent ?? 2}</b></span>
              </div>

              {models.length > 0 && (
                <div className="cli-runtime-models">
                  {models.slice(0, 6).map((m) => (
                    <span key={m} className="cli-model-chip">{m}</span>
                  ))}
                  {models.length > 6 && (
                    <span className="cli-model-chip" title={models.slice(6).join(', ')}>
                      +{models.length - 6} more
                    </span>
                  )}
                </div>
              )}

              <div className="cli-runtime-actions">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => handleDetect(meta.id)}
                >
                  <RefreshCw size={12} style={{ marginRight: '0.25rem' }} /> Detect
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => {
                    setEditingPathRuntime(editingPathRuntime === meta.id ? null : meta.id)
                    setCustomPaths(prev => ({ ...prev, [meta.id]: cfg.binaryPath ?? '' }))
                  }}
                >
                  Change path
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => handleInstall(meta.id)}
                >
                  Install
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => void window.api.browserOpenExternal(meta.docUrl)}
                >
                  CLI docs <ExternalLink size={12} style={{ marginLeft: '0.25rem' }} />
                </button>
              </div>

              {editingPathRuntime === meta.id && (
                <div className="cli-runtime-path-form">
                  <input
                    type="text"
                    className="input cli-runtime-path-input"
                    placeholder={meta.id === 'antigravity' ? 'e.g. C:\\tools\\agy.exe' : 'e.g. C:\\npm\\opencode.cmd'}
                    value={customPaths[meta.id] ?? ''}
                    onChange={(e) => setCustomPaths(prev => ({ ...prev, [meta.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => handleSavePath(meta.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => handleResetPath(meta.id)}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setEditingPathRuntime(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {detect && (
                <div className={`cli-detect-box ${detect.found && detect.valid ? 'ok' : 'warn'}`}>
                  {detect.found ? (
                    detect.valid ? (
                      <span>✓ Detected v{detect.version} at <code>{detect.binaryPath}</code></span>
                    ) : (
                      <span>⚠ Found binary <code>{detect.binaryPath}</code> (v{detect.version}), requires min v{detect.minVersion}</span>
                    )
                  ) : (
                    <span>✕ Binary not found on PATH or known directories{detect.error ? `: ${detect.error}` : ''}</span>
                  )}
                </div>
              )}

              {desc && (
                <div className="cli-install-box">
                  <p className="settings-hint" style={{ marginBottom: '0.333333rem' }}>
                    Meow does not run the installer automatically. Run this command in your terminal:
                  </p>
                  <div className="cli-install-cmd">
                    <code>{desc.command} {desc.args.join(' ')}</code>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        const fullCmd = `${desc.command} ${desc.args.join(' ')}`
                        void navigator.clipboard.writeText(fullCmd)
                        setCopiedRuntime(meta.id)
                        setTimeout(() => setCopiedRuntime(null), 2000)
                      }}
                    >
                      {copiedRuntime === meta.id ? (
                        <>Copied <Check size={12} style={{ marginLeft: '0.25rem' }} /></>
                      ) : (
                        <>Copy <Copy size={12} style={{ marginLeft: '0.25rem' }} /></>
                      )}
                    </button>
                  </div>
                  {desc.docUrl && (
                    <p className="settings-hint" style={{ marginTop: '0.333333rem', fontSize: 'var(--fs-sm)' }}>
                      Install guide:{' '}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          void window.api.browserOpenExternal(desc.docUrl!)
                        }}
                      >
                        {desc.docUrl} ↗
                      </a>
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* ── AGENTS ──────────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Agents</span>
          <BaseDropdown
            open={addMenuOpen}
            onOpenChange={setAddMenuOpen}
            placement="bottom-end"
            trigger={
              <button type="button" className="btn sm primary">
                <Plus size={13} style={{ marginRight: '0.25rem' }} /> Add agent ▾
              </button>
            }
          >
            <div className="menu cli-add-menu">
              <div className="cli-menu-header">Antigravity</div>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setAddMenuOpen(false)
                  void handleAddAntigravityGoogle()
                }}
              >
                <span className="cli-provider-badge">G</span>
                <div className="cli-menu-item-content">
                  <span className="cli-menu-item-title">Google sign-in</span>
                  <span className="cli-menu-item-sub">Google AI Pro / Ultra plan</span>
                </div>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setAddMenuOpen(false)
                  setShowGeminiKeyModal(true)
                }}
              >
                <span className="cli-provider-badge">K</span>
                <div className="cli-menu-item-content">
                  <span className="cli-menu-item-title">Gemini API key</span>
                  <span className="cli-menu-item-sub">Separate quota · runs in parallel</span>
                </div>
              </button>

              <div style={{ borderTop: '0.083333rem solid var(--hairline)', margin: '0.333333rem 0' }} />
              <div className="cli-menu-header">OpenCode</div>
              {OPENCODE_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setAddMenuOpen(false)
                    if (p.id === 'custom') {
                      setShowCustomProviderModal(true)
                    } else {
                      void handleAddOpenCode(p.id)
                    }
                  }}
                >
                  <span className="cli-provider-badge oc">{p.glyph}</span>
                  <div className="cli-menu-item-content">
                    <span className="cli-menu-item-title">{p.label}</span>
                    <span className="cli-menu-item-sub">{p.sub}</span>
                  </div>
                </button>
              ))}
            </div>
          </BaseDropdown>
        </div>

        {/* Antigravity group */}
        <div style={{ marginTop: '0.5rem' }}>
          <div className="cli-notice warn" style={{ marginBottom: '0.666667rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.125rem' }} />
            <div>
              <strong>Antigravity keeps one Google sign-in per machine.</strong> Agents with a saved sign-in can be
              activated, but only one Google account is active at a time; starting a task on another Antigravity
              Google agent pauses and queues the rest.
            </div>
          </div>

          <div className="cli-group-label">Antigravity</div>
          {antigravityAgents.length === 0 ? (
            <div className="cli-empty-agents">No Antigravity agents configured yet.</div>
          ) : (
            <div className="cli-account-list">
              {antigravityAgents.map((agent) => {
                const isDefault = status.defaultAgentId === agent.id
                return (
                  <div key={agent.id} className="cli-account-row">
                    {getAgentAvatar(agent)}
                    <div className="cli-account-who">
                      <div className="cli-account-name">
                        <span>{agent.label}</span>
                        {agent.active && <span className="cli-badge on">Active</span>}
                        {isDefault && <span className="cli-badge on">Default</span>}
                        {agent.kind === 'gemini-key' && <span className="cli-badge">API key</span>}
                      </div>
                      <div className="cli-account-sub">{getAgentSub(agent)}</div>
                    </div>
                    <div className="cli-account-actions">
                      {renderStatusPill(agent.status)}
                      {agent.kind === 'google' && !agent.active && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => handleActivate(agent)}
                        >
                          Activate
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn sm"
                        disabled={!projectPath || agent.status === 'disabled' || agent.status === 'needs-login'}
                        onClick={() => handleCreateSession(agent)}
                      >
                        New session
                      </button>
                      <BaseDropdown
                        open={moreMenuOpen === agent.id}
                        onOpenChange={(open) => setMoreMenuOpen(open ? agent.id : null)}
                        placement="bottom-end"
                        trigger={
                          <button type="button" className="icon-btn" title="More options">
                            <MoreHorizontal size={14} />
                          </button>
                        }
                      >
                        <div className="menu">
                          {!isDefault && (
                            <button
                              type="button"
                              className="menu-item"
                              onClick={() => {
                                setMoreMenuOpen(null)
                                void handleSetDefault(agent)
                              }}
                            >
                              Set as default
                            </button>
                          )}
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              setMoreMenuOpen(null)
                              setAgentToRename(agent)
                              setRenameLabel(agent.label)
                            }}
                          >
                            Rename agent
                          </button>
                          <button
                            type="button"
                            className="menu-item danger"
                            onClick={() => {
                              setMoreMenuOpen(null)
                              setAgentToRemove(agent)
                            }}
                          >
                            Remove agent
                          </button>
                        </div>
                      </BaseDropdown>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* OpenCode group */}
        <div style={{ marginTop: '1rem' }}>
          <div className="cli-group-label">OpenCode</div>
          {openCodeAgents.length === 0 ? (
            <div className="cli-empty-agents">No OpenCode agents configured yet.</div>
          ) : (
            <div className="cli-account-list">
              {openCodeAgents.map((agent) => {
                const isDefault = status.defaultAgentId === agent.id
                return (
                  <div key={agent.id} className="cli-account-row">
                    {getAgentAvatar(agent)}
                    <div className="cli-account-who">
                      <div className="cli-account-name">
                        <span>{agent.label}</span>
                        {isDefault && <span className="cli-badge on">Default</span>}
                        {agent.kind === 'profile' && <span className="cli-badge">Profile</span>}
                      </div>
                      <div className="cli-account-sub">{getAgentSub(agent)}</div>
                    </div>
                    <div className="cli-account-actions">
                      {renderStatusPill(agent.status)}
                      <button
                        type="button"
                        className="btn sm"
                        disabled={!projectPath || agent.status === 'disabled' || agent.status === 'needs-login'}
                        onClick={() => handleCreateSession(agent)}
                      >
                        New session
                      </button>
                      <BaseDropdown
                        open={moreMenuOpen === agent.id}
                        onOpenChange={(open) => setMoreMenuOpen(open ? agent.id : null)}
                        placement="bottom-end"
                        trigger={
                          <button type="button" className="icon-btn" title="More options">
                            <MoreHorizontal size={14} />
                          </button>
                        }
                      >
                        <div className="menu">
                          {!isDefault && (
                            <button
                              type="button"
                              className="menu-item"
                              onClick={() => {
                                setMoreMenuOpen(null)
                                void handleSetDefault(agent)
                              }}
                            >
                              Set as default
                            </button>
                          )}
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              setMoreMenuOpen(null)
                              setAgentToRename(agent)
                              setRenameLabel(agent.label)
                            }}
                          >
                            Rename agent
                          </button>
                          <button
                            type="button"
                            className="menu-item danger"
                            onClick={() => {
                              setMoreMenuOpen(null)
                              setAgentToRemove(agent)
                            }}
                          >
                            Remove agent
                          </button>
                        </div>
                      </BaseDropdown>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── DELEGATION ──────────────────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-header">Delegation from Meow</div>
        <p className="settings-hint">
          Summary of current delegation rules. When allowed, Meow sessions can delegate tasks to CLI agents
          via <code>delegate_cli</code>.
        </p>
        <div className="settings-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Allow CLI worker delegation</strong>
            <div className="settings-hint">Exposes CLI worker delegation to Meow sessions</div>
          </div>
          <span className={`cli-pill ${status.delegation?.allow ? 'ok' : ''}`}>
            {status.delegation?.allow ? 'Allowed' : 'Disabled'}
          </span>
        </div>
        <div className="settings-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Max feedback rounds</strong>
            <div className="settings-hint">Meow may send corrections to the same CLI conversation before asking you</div>
          </div>
          <span className="cli-badge">{status.delegation?.maxRounds ?? 3} rounds</span>
        </div>
        <div className="settings-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Queued tasks per agent</strong>
            <div className="settings-hint">FIFO capacity beyond which source session waits</div>
          </div>
          <span className="cli-badge">{status.delegation?.maxNonterminalPerAgent ?? 5} tasks</span>
        </div>
      </section>

      {/* ── MODALS ──────────────────────────────────────────────────── */}

      {/* Login Dialog */}
      {activeLogin && (
        <CliLoginDialog
          loginId={activeLogin.loginId}
          runtime={activeLogin.runtime}
          agentId={activeLogin.agentId}
          label={activeLogin.label}
          onClose={() => {
            setActiveLogin(null)
            void refreshStatus()
          }}
        />
      )}

      {/* Add Gemini Key Modal */}
      {showGeminiKeyModal && (
        <BaseModal
          title="Add Antigravity Agent — Gemini API Key"
          onClose={() => setShowGeminiKeyModal(false)}
          actions={
            <>
              <button
                type="button"
                className="btn"
                disabled={geminiSubmitting}
                onClick={() => setShowGeminiKeyModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!geminiKey.trim() || geminiSubmitting}
                onClick={handleAddGeminiKey}
              >
                {geminiSubmitting ? 'Creating…' : 'Create agent'}
              </button>
            </>
          }
        >
          <p className="settings-hint">
            API-key agents are fully isolated: each task gets <code>modelProvider: "gemini"</code> and its own
            <code>GEMINI_API_KEY</code>. They run in parallel with a signed-in Google agent, but use Google AI Studio
            quota instead of your subscription.
          </p>
          <div className="settings-field">
            <label className="label">Gemini API key</label>
            <input
              type="password"
              className="input"
              placeholder="AIzaSy…"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label className="label">Agent label (optional)</label>
            <input
              type="text"
              className="input"
              placeholder="Antigravity · Gemini Key"
              value={geminiLabel}
              onChange={(e) => setGeminiLabel(e.target.value)}
            />
          </div>
          <p className="settings-hint" style={{ fontSize: 'var(--fs-sm)' }}>
            The key is stored in the vault; it never reaches the renderer after saving.
          </p>
        </BaseModal>
      )}

      {/* Add Custom OpenCode Provider Modal */}
      {showCustomProviderModal && (
        <BaseModal
          title="Add OpenCode Agent — Custom Provider"
          onClose={() => setShowCustomProviderModal(false)}
          actions={
            <>
              <button
                type="button"
                className="btn"
                disabled={customProviderSubmitting}
                onClick={() => setShowCustomProviderModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!customProviderName.trim() || customProviderSubmitting}
                onClick={handleCustomProviderSubmit}
              >
                {customProviderSubmitting ? 'Starting…' : 'Start sign-in'}
              </button>
            </>
          }
        >
          <p className="settings-hint">
            Provide the provider identifier recognized by OpenCode CLI (e.g. <code>deepseek</code>, <code>mistral</code>, <code>ollama</code>).
          </p>
          <div className="settings-field">
            <label className="label">Provider identifier</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. deepseek"
              value={customProviderName}
              onChange={(e) => setCustomProviderName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label className="label">Agent label (optional)</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. OpenCode · DeepSeek"
              value={customProviderLabel}
              onChange={(e) => setCustomProviderLabel(e.target.value)}
            />
          </div>
        </BaseModal>
      )}

      {/* Rename Agent Modal */}
      {agentToRename && (
        <BaseModal
          title={`Rename ${agentToRename.label}`}
          onClose={() => setAgentToRename(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setAgentToRename(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!renameLabel.trim()}
                onClick={handleRenameConfirm}
              >
                Save
              </button>
            </>
          }
        >
          <div className="settings-field">
            <label className="label">Agent label</label>
            <input
              type="text"
              className="input"
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              autoFocus
            />
          </div>
        </BaseModal>
      )}

      {/* Remove Agent Modal */}
      {agentToRemove && (
        <BaseModal
          title={`Remove ${agentToRemove.label}?`}
          onClose={() => setAgentToRemove(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setAgentToRemove(null)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={handleRemoveConfirm}>
                Remove agent
              </button>
            </>
          }
        >
          <p className="settings-hint">
            Are you sure you want to remove <strong>{agentToRemove.label}</strong>?
            {agentToRemove.runtime === 'opencode' && ' This will remove the local profile directory.'}
            {agentToRemove.kind === 'gemini-key' && ' This will delete the stored API key from the vault.'}
            {agentToRemove.kind === 'google' && ' This agent record will be deleted.'}
          </p>
        </BaseModal>
      )}
    </div>
  )
}
