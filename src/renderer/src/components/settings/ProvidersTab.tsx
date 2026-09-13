import { useState } from 'react'
import {
  Server,
  ShieldCheck,
  Key,
  RefreshCw,
  Edit2,
  Trash2,
  Plus,
  Search,
  Globe,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Star,
  Cpu
} from 'lucide-react'
import type { CatalogProviderSummary, MeowSettings, ProviderSettings } from '@shared/types'
import BaseModal from '../common/BaseModal'
import BaseSelect from '../common/BaseSelect'
import ConfirmDialog from '../ConfirmDialog'

interface Props {
  settings: MeowSettings
  catalog: CatalogProviderSummary[]
  onChange: (patch: Partial<MeowSettings>) => void
  /** Notify the shell that a provider action persisted settings directly */
  onPersisted: (result: MeowSettings) => void
  /** Refresh the provider catalog + settings from main */
  onRefresh: () => void
}

type ModalState =
  | { mode: 'connect'; step: 'select' | 'configure' }
  | { mode: 'edit'; provider: ProviderSettings }
  | null

const PROVIDER_TYPE_OPTIONS = [
  { value: '', label: 'Auto-detect (default)', description: 'Automatically infer provider features' },
  { value: 'deepseek', label: 'DeepSeek', description: 'Requires reasoning_content echo' },
  { value: 'openai', label: 'OpenAI', description: 'Standard OpenAI chat completions API' },
  { value: 'anthropic', label: 'Anthropic', description: 'Anthropic Messages API format' },
  { value: 'google', label: 'Google Gemini', description: 'Google Gemini AI API format' }
]

function ProviderTypeSelect({
  value,
  onChange
}: {
  value: string
  onChange: (val: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = PROVIDER_TYPE_OPTIONS.find(o => o.value === value) || PROVIDER_TYPE_OPTIONS[0]

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      className="provider-type-select-container"
      trigger={<span className="trigger-label">{current.label}</span>}
    >
      <div className="provider-type-menu">
        {PROVIDER_TYPE_OPTIONS.map(opt => {
          const isSelected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`menu-item ${isSelected ? 'active' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              <div className="provider-type-menu-content">
                <span className="provider-type-menu-title">{opt.label}</span>
                <span className="provider-type-menu-hint">{opt.description}</span>
              </div>
            </button>
          )
        })}
      </div>
    </BaseSelect>
  )
}

export default function ProvidersTab({ settings, catalog, onChange, onPersisted, onRefresh }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [manualModels, setManualModels] = useState('')
  const [providerType, setProviderType] = useState('')
  const [originalProviderType, setOriginalProviderType] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modelsMap, setModelsMap] = useState<Record<string, string[]>>({})
  const [loadingModels, setLoadingModels] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const connected = settings.providers

  const catalogFiltered = catalog.filter(
    c =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase())
  )

  const openConnect = () => {
    setSearch('')
    setProviderId('')
    setApiKey('')
    setBaseUrl('')
    setManualModels('')
    setProviderType('')
    setOriginalProviderType('')
    setModal({ mode: 'connect', step: 'select' })
  }

  const selectPreset = (item: CatalogProviderSummary) => {
    setProviderId(item.id)
    setApiKey('')
    setBaseUrl('')
    setManualModels('')
    setProviderType('')
    setOriginalProviderType('')
    setModal({ mode: 'connect', step: 'configure' })
  }

  const selectCustom = () => {
    setProviderId('')
    setApiKey('')
    setBaseUrl('')
    setManualModels('')
    setProviderType('')
    setOriginalProviderType('')
    setModal({ mode: 'connect', step: 'configure' })
  }

  const openEdit = (p: ProviderSettings) => {
    setProviderId(p.id)
    setApiKey('')
    setBaseUrl(p.baseUrl ?? '')
    setManualModels(p.models.join(', '))
    setProviderType(p.providerType ?? '')
    setOriginalProviderType(p.providerType ?? '')
    setModal({ mode: 'edit', provider: p })
  }

  const handleConnectOrSave = async () => {
    const id = providerId.trim()
    if (!id || saving) return
    const isEdit = modal?.mode === 'edit'
    if (!isEdit && !apiKey.trim()) return

    const modelList = manualModels.split(/[\s,]+/).map(m => m.trim()).filter(Boolean)
    const pType = isEdit
      ? providerType.trim() || originalProviderType.trim() || undefined
      : providerType.trim() || undefined

    setStatus('')
    setSaving(true)
    try {
      const result = await window.api.connectProvider(
        id,
        apiKey.trim(),
        baseUrl.trim() || undefined,
        modelList,
        pType
      )
      setModal(null)
      onPersisted(result)
      onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
      onRefresh()
      if (isEdit) {
        setStatus(apiKey.trim() ? `Saved ${id}. API key updated.` : `Saved ${id}. API key kept.`)
      } else {
        const provider = result.providers.find(p => p.id === id)
        setStatus(
          provider && provider.models.length > 0
            ? `Connected ${id}. ${provider.models.length} model(s) synced.`
            : `Connected ${id}. Add models in the modal or they will sync when models.dev is reachable.`
        )
      }
    } catch (err) {
      setStatus(String(err))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async (id: string) => {
    if (saving) return
    setSaving(true)
    setStatus('')
    try {
      const result = await window.api.disconnectProvider(id)
      if (expandedId === id) {
        setExpandedId(null)
      }
      onPersisted(result)
      onChange({ providers: result.providers, defaultProvider: result.defaultProvider })
      setStatus(`Disconnected ${id}.`)
      onRefresh()
    } catch (err) {
      setStatus(String(err))
    } finally {
      setSaving(false)
    }
  }

  const syncModels = async (id: string) => {
    setSyncingId(id)
    setStatus('')
    try {
      const live = await window.api.fetchProviderModels(id)
      const fresh = await window.api.getSettings()
      const p = fresh.providers.find(x => x.id === id)
      if (p) {
        const next = fresh.providers.map(c =>
          c.id === id ? { ...c, models: live.length > 0 ? live : c.models } : c
        )
        const result = await window.api.saveSettings({
          ...fresh,
          defaultProvider: fresh.defaultProvider,
          providers: next
        })
        onPersisted(result)
        onChange({ providers: result.providers })
      }
      setStatus(
        live.length > 0 ? `Synced ${id}. ${live.length} model(s).` : `No models for ${id}. Add them manually in Edit.`
      )
      setModelsMap(prev => ({ ...prev, [id]: live }))
    } catch (err) {
      setStatus(String(err))
    } finally {
      setSyncingId(null)
    }
  }

  const setDefault = async (id: string) => {
    const fresh = await window.api.getSettings()
    const result = await window.api.saveSettings({ ...fresh, defaultProvider: id })
    onPersisted(result)
    onChange({ defaultProvider: id })
  }

  const toggleExpand = async (id: string, initialModels: string[]) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!modelsMap[id]) {
      setLoadingModels(id)
      try {
        const fetched = await window.api.fetchProviderModels(id)
        setModelsMap(prev => ({ ...prev, [id]: fetched.length > 0 ? fetched : initialModels }))
      } catch {
        setModelsMap(prev => ({ ...prev, [id]: initialModels }))
      } finally {
        setLoadingModels(null)
      }
    }
  }

  const maskKey = (key: string): string =>
    key.length <= 8 ? '••••' : `${key.slice(0, 4)}...${key.slice(-4)}`

  return (
    <div className="settings-tab providers-tab">
      <div className="provider-header">
        <div className="provider-header-info">
          <p className="settings-hint">
            Configure AI provider connections, API keys, and custom endpoints. API keys are stored encrypted in the OS keychain.
          </p>
        </div>
        <button type="button" className="btn primary small" onClick={openConnect}>
          <Plus size={14} aria-hidden="true" />
          <span>Connect Provider</span>
        </button>
      </div>

      {status && <div className="settings-status">{status}</div>}

      {connected.length === 0 ? (
        <div className="provider-empty-card">
          <div className="provider-empty-icon">
            <Server size={24} aria-hidden="true" />
          </div>
          <div className="provider-empty-text">
            <h4>No Providers Connected</h4>
            <p>Connect OpenAI, Anthropic, DeepSeek, or any custom OpenAI-compatible API to power agent sessions.</p>
          </div>
          <button type="button" className="btn primary small" onClick={openConnect}>
            <Plus size={14} aria-hidden="true" />
            <span>Connect your first provider</span>
          </button>
        </div>
      ) : (
        <div className="provider-grid">
          {connected.map(p => {
            const isDefault = settings.defaultProvider === p.id
            const isExpanded = expandedId === p.id
            const displayModels = modelsMap[p.id] || p.models

            return (
              <div className={`provider-card ${isDefault ? 'is-default' : ''}`} key={p.id}>
                <div className="provider-card-head">
                  <div className="provider-title-group">
                    <div className="provider-icon-badge">
                      <Server size={15} aria-hidden="true" />
                    </div>
                    <div className="provider-name-wrapper">
                      <div className="provider-name-row">
                        <span className="provider-name">{p.id}</span>
                        {isDefault && (
                          <span className="provider-badge badge-default">
                            <Star size={11} fill="currentColor" />
                            <span>Default</span>
                          </span>
                        )}
                        {p.keyRef ? (
                          <span className="provider-badge badge-secure" title="Key stored encrypted in OS keychain">
                            <ShieldCheck size={11} />
                            <span>OS Vaulted</span>
                          </span>
                        ) : p.apiKey ? (
                          <span className="provider-badge badge-key" title="Key stored in settings">
                            <Key size={11} />
                            <span>key {maskKey(p.apiKey)}</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="provider-meta-row">
                        {p.baseUrl ? (
                          <span className="provider-url-tag">
                            <Globe size={11} />
                            <span>{p.baseUrl}</span>
                          </span>
                        ) : (
                          <span className="provider-type-tag">Standard API</span>
                        )}
                        <span className="provider-models-count">
                          {p.models.length} model{p.models.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="provider-actions-toolbar">
                    {!isDefault && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => void setDefault(p.id)}
                        title="Set as default provider for new sessions"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small"
                      disabled={syncingId === p.id}
                      onClick={() => void syncModels(p.id)}
                    >
                      <RefreshCw size={13} className={syncingId === p.id ? 'spin' : ''} aria-hidden="true" />
                      <span>{syncingId === p.id ? 'Syncing...' : 'Sync'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => openEdit(p)}
                    >
                      <Edit2 size={13} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Disconnect provider"
                      onClick={() => setConfirmDisconnectId(p.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Model List */}
                <div className="provider-card-footer">
                  <button
                    type="button"
                    className="provider-toggle-btn"
                    onClick={() => void toggleExpand(p.id, p.models)}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{isExpanded ? 'Hide Synced Models' : 'View Synced Models'}</span>
                  </button>

                  {isExpanded && (
                    <div className="provider-models-chips">
                      {loadingModels === p.id ? (
                        <span className="provider-models-loading">Loading models...</span>
                      ) : displayModels.length > 0 ? (
                        displayModels.map(m => (
                          <span className="provider-model-chip" key={m}>
                            <Cpu size={11} />
                            <span>{m}</span>
                          </span>
                        ))
                      ) : (
                        <span className="provider-models-empty">No models available. Click "Sync" or add them in Edit.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Connect & Edit Modal */}
      {modal && (
        <BaseModal size="md" onClose={() => setModal(null)}>
          <BaseModal.Header
            title={
              modal.mode === 'edit'
                ? `Edit ${modal.provider.id}`
                : modal.step === 'select'
                  ? 'Connect Provider'
                  : providerId
                    ? `Connect ${providerId}`
                    : 'Connect Custom Endpoint'
            }
          />
          <BaseModal.Body>
            {modal.mode === 'connect' && modal.step === 'select' ? (
              <div className="provider-modal-select">
                <div className="provider-search-box">
                  <Search size={15} className="search-icon" />
                  <input
                    className="input provider-modal-search"
                    placeholder="Search preset providers (OpenAI, Anthropic, DeepSeek...)"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="preset-grid">
                  {catalogFiltered.map(c => {
                    const isConnected = connected.some(p => p.id === c.id)
                    return (
                      <button
                        type="button"
                        className={`preset-card ${isConnected ? 'connected' : ''}`}
                        key={c.id}
                        onClick={() => selectPreset(c)}
                      >
                        <div className="preset-card-head">
                          <span className="preset-name">{c.name}</span>
                          {isConnected && <CheckCircle2 size={13} className="connected-icon" />}
                        </div>
                        <span className="preset-id"><code>{c.id}</code></span>
                        <span className="preset-meta">{c.modelCount} models available</span>
                      </button>
                    )
                  })}
                </div>

                <div className="provider-custom-divider">
                  <span>OR</span>
                </div>

                <button
                  type="button"
                  className="provider-custom-btn"
                  onClick={selectCustom}
                >
                  <Globe size={16} />
                  <div className="custom-btn-text">
                    <span className="title">Custom OpenAI-compatible Endpoint</span>
                    <span className="sub">Connect Ollama, vLLM, LMStudio, LocalAI, or custom proxy</span>
                  </div>
                  <ChevronRight size={16} className="arrow" />
                </button>
              </div>
            ) : (
              <div className="provider-modal-form">
                {modal.mode === 'connect' && (
                  <button
                    type="button"
                    className="provider-back-btn"
                    onClick={() => setModal({ mode: 'connect', step: 'select' })}
                  >
                    ← Back to Provider Presets
                  </button>
                )}

                <div className="settings-field">
                  <label className="label" htmlFor="provider-id">Provider ID</label>
                  <input
                    id="provider-id"
                    className="input"
                    placeholder="e.g. deepseek, local-llm, ollama"
                    value={providerId}
                    disabled={saving || (modal.mode === 'edit')}
                    onChange={e => setProviderId(e.target.value)}
                  />
                </div>

                <div className="settings-field">
                  <label className="label" htmlFor="provider-key">API Key</label>
                  <input
                    id="provider-key"
                    type="password"
                    className="input"
                    placeholder={
                      modal.mode === 'edit'
                        ? 'API key (leave blank to keep current key)'
                        : 'Enter your API key'
                    }
                    value={apiKey}
                    disabled={saving}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <span className="field-hint">
                    Stored encrypted in the OS keychain. Never displayed in plain text again.
                  </span>
                </div>

                <div className="settings-field">
                  <label className="label" htmlFor="provider-url">Base URL (Optional)</label>
                  <input
                    id="provider-url"
                    className="input"
                    placeholder="e.g. http://localhost:11434/v1"
                    value={baseUrl}
                    disabled={saving}
                    onChange={e => setBaseUrl(e.target.value)}
                  />
                </div>

                <div className="settings-field">
                  <label className="label">Provider Type</label>
                  <ProviderTypeSelect
                    value={providerType}
                    onChange={val => setProviderType(val)}
                  />
                </div>

                <div className="settings-field">
                  <label className="label" htmlFor="provider-models">Manual Models (Optional)</label>
                  <textarea
                    id="provider-models"
                    className="input"
                    rows={2}
                    placeholder="Comma or space separated (e.g. gpt-4o, claude-3-5-sonnet)"
                    value={manualModels}
                    disabled={saving}
                    onChange={e => setManualModels(e.target.value)}
                  />
                  <span className="field-hint">
                    Leave blank to auto-sync from <code>/models</code>. Manual entries override the synced list.
                  </span>
                </div>
              </div>
            )}
          </BaseModal.Body>
          <BaseModal.Footer>
            <button type="button" className="btn" onClick={() => setModal(null)}>
              Cancel
            </button>
            {(modal.mode === 'edit' || modal.step === 'configure') && (
              <button
                type="button"
                className="btn primary"
                disabled={saving || !providerId.trim() || (modal.mode !== 'edit' && !apiKey.trim())}
                onClick={() => void handleConnectOrSave()}
              >
                {saving ? 'Saving...' : modal.mode === 'edit' ? 'Save Changes' : 'Connect Provider'}
              </button>
            )}
          </BaseModal.Footer>
        </BaseModal>
      )}

      {confirmDisconnectId && (
        <ConfirmDialog
          title="Disconnect Provider"
          message={`Are you sure you want to disconnect provider "${confirmDisconnectId}"? Saved API key will be removed.`}
          confirmLabel="Disconnect"
          onConfirm={() => {
            void disconnect(confirmDisconnectId)
            setConfirmDisconnectId(null)
          }}
          onCancel={() => setConfirmDisconnectId(null)}
        />
      )}
    </div>
  )
}
