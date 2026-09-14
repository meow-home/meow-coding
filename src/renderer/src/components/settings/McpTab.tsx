import { useState } from 'react'
import { Server, Globe, Terminal, Plus, RefreshCw, Trash2, AlertCircle, CheckCircle2, Lock, Key } from 'lucide-react'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import BaseModal from '../common/BaseModal'
import ConfirmDialog from '../ConfirmDialog'

interface Props {
  mcp: Record<string, McpServerConfig>
  status: McpServerStatus[]
  onChange: (mcp: Record<string, McpServerConfig>) => void
  onReconnect: () => Promise<McpServerStatus[]>
}

export default function McpTab({ mcp, status, onChange, onReconnect }: Props) {
  const [adding, setAdding] = useState(false)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [serverType, setServerType] = useState<'command' | 'url'>('command')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newBearerToken, setNewBearerToken] = useState('')
  const [newHeaders, setNewHeaders] = useState<Array<{ key: string; value: string }>>([])
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [testing, setTesting] = useState(false)

  const splitCommand = (value: string): Partial<McpServerConfig> => {
    const parts = value.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return {}
    return parts.length === 1
      ? { command: parts[0] }
      : { command: parts[0], args: parts.slice(1) }
  }

  const updateServer = (name: string, patch: Partial<McpServerConfig>) => {
    const next = { ...mcp }
    next[name] = { ...next[name], ...patch }
    onChange(next)
  }

  const openAdd = () => {
    setNewName('')
    setNewUrl('')
    setNewBearerToken('')
    setNewHeaders([])
    setNewCommand('')
    setNewArgs('')
    setServerType('command')
    setAdding(true)
  }

  const addServer = () => {
    const name = newName.trim()
    if (!name || mcp[name]) return
    const cfg: McpServerConfig = {}
    if (serverType === 'url' && newUrl.trim()) {
      cfg.url = newUrl.trim()
      const headersMap: Record<string, string> = {}
      if (newBearerToken.trim()) {
        headersMap['Authorization'] = `Bearer ${newBearerToken.trim()}`
      }
      for (const h of newHeaders) {
        const k = h.key.trim()
        const v = h.value.trim()
        if (k && v) {
          headersMap[k] = v
        }
      }
      if (Object.keys(headersMap).length > 0) {
        cfg.headers = headersMap
      }
    } else {
      Object.assign(cfg, splitCommand(newCommand))
      const args = newArgs.split(' ').map(a => a.trim()).filter(Boolean)
      if (args.length > 0) cfg.args = args
    }
    onChange({ ...mcp, [name]: cfg })
    setAdding(false)
  }

  const removeServer = (name: string) => {
    const next = { ...mcp }
    delete next[name]
    onChange(next)
  }

  const statusFor = (name: string): McpServerStatus | undefined => status.find(s => s.name === name)

  const testConnections = async () => {
    if (testing) return
    setTesting(true)
    try {
      await onReconnect()
    } finally {
      setTesting(false)
    }
  }

  const serverCount = Object.keys(mcp).length
  const connectedCount = status.filter(s => s.status === 'connected').length

  return (
    <div className="settings-tab mcp-tab">
      <div className="mcp-header">
        <div className="mcp-header-info">
          <p className="settings-hint">
            Model Context Protocol (MCP) servers extend agent capabilities with external tools, APIs, and services via stdio commands or HTTP endpoints.
          </p>
          {serverCount > 0 && (
            <div className="mcp-summary-bar">
              <div className="summary-pill badge-allow">
                <CheckCircle2 size={13} />
                <span>{connectedCount} / {serverCount} Connected</span>
              </div>
            </div>
          )}
        </div>

        <div className="mcp-head-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => void testConnections()}
            disabled={testing || serverCount === 0}
          >
            <RefreshCw size={13} className={testing ? 'spin' : ''} aria-hidden="true" />
            <span>{testing ? 'Testing...' : 'Test Connections'}</span>
          </button>
          <button type="button" className="btn primary small" onClick={openAdd}>
            <Plus size={14} aria-hidden="true" />
            <span>Add Server</span>
          </button>
        </div>
      </div>

      {serverCount === 0 ? (
        <div className="mcp-empty-card">
          <div className="mcp-empty-icon">
            <Server size={24} aria-hidden="true" />
          </div>
          <div className="mcp-empty-text">
            <h4>No MCP Servers Configured</h4>
            <p>Connect a stdio command (e.g. npx @playwright/mcp) or HTTP endpoint to equip agent tools.</p>
          </div>
          <button type="button" className="btn primary small" onClick={openAdd}>
            <Plus size={14} aria-hidden="true" />
            <span>Add your first server</span>
          </button>
        </div>
      ) : (
        <div className="mcp-grid">
          {Object.entries(mcp).map(([name, cfg]) => {
            const st = statusFor(name)
            const isConnected = st?.status === 'connected'
            const isHttp = Boolean(cfg.url)
            const TypeIcon = isHttp ? Globe : Terminal

            return (
              <div className="mcp-card" key={name}>
                <div className="mcp-card-head">
                  <div className="mcp-title-group">
                    <div className="mcp-icon-badge">
                      <TypeIcon size={15} aria-hidden="true" />
                    </div>
                    <div className="mcp-name-wrapper">
                      <span className="mcp-name">{name}</span>
                      <span className="mcp-type-tag">{isHttp ? 'HTTP / SSE' : 'Stdio Command'}</span>
                    </div>
                  </div>

                  <div className="mcp-status-actions">
                    <span className={`mcp-status-chip ${isConnected ? 'status-connected' : 'status-failed'}`}>
                      <span className={`mcp-dot ${st?.status ?? 'error'}`} />
                      <span>
                        {isConnected
                          ? `${st.tools.length} tool${st.tools.length === 1 ? '' : 's'}`
                          : 'Disconnected'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Remove server"
                      onClick={() => setConfirmDeleteName(name)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {st?.error && (
                  <div className="mcp-error-box">
                    <AlertCircle size={14} className="mcp-error-icon" aria-hidden="true" />
                    <span className="mcp-error-text">{st.error}</span>
                  </div>
                )}

                <div className="mcp-fields-grid">
                  {isHttp ? (
                    <>
                      <div className="mcp-field-item full-width">
                        <label className="mcp-field-label">URL Endpoint</label>
                        <input
                          className="input"
                          placeholder="http://localhost:3000/mcp"
                          value={cfg.url ?? ''}
                          onChange={e => updateServer(name, { url: e.target.value })}
                        />
                      </div>
                      {cfg.headers && Object.keys(cfg.headers).length > 0 && (
                        <div className="mcp-field-item full-width">
                          <label className="mcp-field-label">Configured Headers</label>
                          <div className="mcp-headers-summary">
                            {Object.entries(cfg.headers).map(([hKey, hVal]) => {
                              const isSecret = /auth|key|token|secret|password/i.test(hKey)
                              const displayVal = isSecret
                                ? (hVal.startsWith('Bearer ') ? `Bearer ${'•'.repeat(8)}` : '•'.repeat(8))
                                : hVal
                              return (
                                <div key={hKey} className="mcp-header-badge">
                                  <Lock size={12} className="mcp-header-lock-icon" />
                                  <span className="header-key">{hKey}:</span>
                                  <span className="header-val">{displayVal}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mcp-field-item">
                        <label className="mcp-field-label">Command</label>
                        <input
                          className="input"
                          placeholder="e.g. npx @playwright/mcp"
                          value={cfg.command ?? ''}
                          onChange={e => updateServer(name, splitCommand(e.target.value))}
                        />
                      </div>
                      <div className="mcp-field-item">
                        <label className="mcp-field-label">Arguments</label>
                        <input
                          className="input"
                          placeholder="space separated arguments"
                          value={cfg.args?.join(' ') ?? ''}
                          onChange={e =>
                            updateServer(name, { args: e.target.value.split(' ').filter(Boolean) })
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <BaseModal size="md" onClose={() => setAdding(false)}>
          <BaseModal.Header title="Add MCP Server" />
          <BaseModal.Body>
            <div className="mcp-modal-content">
              <div className="mcp-type-selector">
                <button
                  type="button"
                  className={`mcp-type-btn ${serverType === 'command' ? 'active' : ''}`}
                  onClick={() => setServerType('command')}
                >
                  <Terminal size={15} />
                  <span>Stdio Command</span>
                </button>
                <button
                  type="button"
                  className={`mcp-type-btn ${serverType === 'url' ? 'active' : ''}`}
                  onClick={() => setServerType('url')}
                >
                  <Globe size={15} />
                  <span>HTTP / SSE Endpoint</span>
                </button>
              </div>

              <div className="settings-field">
                <label className="label" htmlFor="mcp-name">Server Name</label>
                <input
                  id="mcp-name"
                  className="input"
                  placeholder="e.g. playwright, katalon, github"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                />
              </div>

              {serverType === 'url' ? (
                <>
                  <div className="settings-field">
                    <label className="label" htmlFor="mcp-url">HTTP Endpoint URL</label>
                    <input
                      id="mcp-url"
                      className="input"
                      placeholder="http://localhost:3000/mcp"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="label" htmlFor="mcp-bearer">
                      <Key size={13} style={{ display: 'inline', marginRight: 4 }} />
                      Bearer Token (Optional)
                    </label>
                    <input
                      id="mcp-bearer"
                      type="password"
                      className="input"
                      placeholder="eyJhbGciOi..."
                      value={newBearerToken}
                      onChange={e => setNewBearerToken(e.target.value)}
                    />
                    <span className="settings-hint">Sets Authorization: Bearer token header.</span>
                  </div>
                  <div className="settings-field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label className="label" style={{ marginBottom: 0 }}>Custom Headers (Optional)</label>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setNewHeaders([...newHeaders, { key: '', value: '' }])}
                      >
                        <Plus size={13} />
                        <span>Add Header</span>
                      </button>
                    </div>
                    {newHeaders.map((h, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <input
                          className="input"
                          placeholder="Header Name (e.g. X-Api-Key)"
                          value={h.key}
                          onChange={e => {
                            const next = [...newHeaders]
                            next[idx].key = e.target.value
                            setNewHeaders(next)
                          }}
                        />
                        <input
                          className="input"
                          type="password"
                          placeholder="Header Value"
                          value={h.value}
                          onChange={e => {
                            const next = [...newHeaders]
                            next[idx].value = e.target.value
                            setNewHeaders(next)
                          }}
                        />
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => setNewHeaders(newHeaders.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-field">
                    <label className="label" htmlFor="mcp-command">Executable Command</label>
                    <input
                      id="mcp-command"
                      className="input"
                      placeholder="e.g. npx @playwright/mcp"
                      value={newCommand}
                      onChange={e => setNewCommand(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="label" htmlFor="mcp-args">Arguments</label>
                    <input
                      id="mcp-args"
                      className="input"
                      placeholder="space separated arguments (optional)"
                      value={newArgs}
                      onChange={e => setNewArgs(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          </BaseModal.Body>
          <BaseModal.Footer>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!newName.trim() || (serverType === 'url' ? !newUrl.trim() : !newCommand.trim())}
              onClick={addServer}
            >
              Add Server
            </button>
          </BaseModal.Footer>
        </BaseModal>
      )}

      {confirmDeleteName && (
        <ConfirmDialog
          title="Disconnect MCP Server"
          message={`Are you sure you want to disconnect MCP server "${confirmDeleteName}"?`}
          confirmLabel="Disconnect"
          onConfirm={() => {
            removeServer(confirmDeleteName)
            setConfirmDeleteName(null)
          }}
          onCancel={() => setConfirmDeleteName(null)}
        />
      )}
    </div>
  )
}
