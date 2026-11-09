import { useCallback, useEffect, useState } from 'react'
import {
  Globe,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Radio,
  Compass,
  ExternalLink,
  FolderOpen,
  Trash2,
  Check,
  X
} from 'lucide-react'
import type { BrowserStatusInfo, TrustedExtension } from '@shared/browser-types'
import type { MeowSettings } from '@shared/types'
import BaseSelect from './common/BaseSelect'
import ConfirmDialog from './ConfirmDialog'
import BaseModal from './common/BaseModal'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
  onSaved?: () => void
}

export default function BrowserDialog({ status, onClose, onSaved }: Props) {
  const [trusted, setTrusted] = useState<TrustedExtension[]>([])
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<MeowSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [backendOpen, setBackendOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [cleared, setCleared] = useState(false)

  const refreshTrusted = useCallback(async () => {
    setTrusted(await window.api.getBrowserTrustedExtensions())
  }, [])

  useEffect(() => {
    void refreshTrusted()
  }, [refreshTrusted])

  useEffect(() => {
    void window.api.getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  const backend = settings?.browser?.backend ?? 'builtin'
  const siteApproval = settings?.browser?.siteApproval ?? 'ask'

  const saveBrowser = async (patch: { backend?: 'builtin' | 'chrome'; siteApproval?: 'ask' | 'off' }): Promise<void> => {
    if (!settings) return
    setSaving(true)
    setSaveError(null)
    try {
      const current = await window.api.getSettings()
      const browser = {
        backend: patch.backend ?? current.browser?.backend ?? 'builtin',
        siteApproval: patch.siteApproval ?? current.browser?.siteApproval ?? 'ask'
      }
      await window.api.saveSettings({ ...current, browser })
      setSettings({ ...current, browser })
      onSaved?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const clearData = async (): Promise<void> => {
    setConfirmClear(false)
    setSaving(true)
    setSaveError(null)
    try {
      await window.api.browserClearData()
      setCleared(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const pending = status?.pendingExtension
  const waiting = !status?.paired && !pending && (status?.status === 'listening' || status?.status === 'idle')
  const pillClass = status?.paired ? 'paired' : pending || waiting ? 'waiting' : 'idle'

  const decide = async (approve: boolean) => {
    if (!pending) return
    setBusy(true)
    try {
      if (approve) await window.api.approveBrowserExtension(pending.extensionId)
      else await window.api.denyBrowserExtension(pending.extensionId)
      await refreshTrusted()
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (extensionId: string) => {
    setBusy(true)
    try {
      await window.api.revokeBrowserExtension(extensionId)
      await refreshTrusted()
    } finally {
      setBusy(false)
    }
  }

  const titleNode = (
    <div className="browser-modal-header">
      <div className="browser-modal-title">
        <Globe size={18} style={{ color: 'var(--accent)' }} />
        <span>Browser Bridge</span>
        <span className={`browser-status-pill ${pillClass}`}>
          {status?.paired ? (
            <>
              <CheckCircle2 size={12} />
              Paired {status.port ? `(Port ${status.port})` : ''}
            </>
          ) : pending ? (
            <>
              <ShieldAlert size={12} />
              Approval needed
            </>
          ) : waiting ? (
            <>
              <RefreshCw size={12} className="spin" />
              Waiting for extension
            </>
          ) : (
            <>
              <Radio size={12} />
              {status?.status ?? 'Idle'}
            </>
          )}
        </span>
      </div>
    </div>
  )

  return (
    <BaseModal title={titleNode} onClose={onClose} size="lg" className="browser-dialog">
      <div className="browser-dialog-body">
        <div className="browser-card">
          <div className="browser-card-head">
            <div className="context-icon-badge">
              <Globe size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="context-title-group">
              <h4 className="context-card-title">Agent browser</h4>
              <p className="context-card-desc">Which browser the agent drives by default.</p>
            </div>
          </div>
          <div className="browser-card-body">
            <div className="browser-setting-row">
              <span className="browser-setting-label">Backend</span>
              <BaseSelect
                open={backendOpen}
                onToggle={() => setBackendOpen(open => !open)}
                onClose={() => setBackendOpen(false)}
                title="Default browser backend"
                align="right"
                trigger={<span className="select-value-label">{backend === 'chrome' ? 'Chrome' : 'Built-in'}</span>}
              >
                <div>
                  {([
                    { value: 'builtin', label: 'Built-in' },
                    { value: 'chrome', label: 'Chrome' }
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={backend === option.value}
                      className={`menu-item ${backend === option.value ? 'active' : ''}`}
                      disabled={saving}
                      onClick={() => {
                        setBackendOpen(false)
                        if (option.value !== backend) void saveBrowser({ backend: option.value })
                      }}
                    >
                      <span className="menu-item-label">{option.label}</span>
                      <span className="menu-item-check">{backend === option.value && <Check size={14} aria-hidden="true" />}</span>
                    </button>
                  ))}
                </div>
              </BaseSelect>
            </div>
            <p className="browser-setting-help">
              {backend === 'chrome'
                ? 'Chrome: your real Chrome profile through the extension.'
                : 'Built-in: runs in the Browser panel with its own sign-ins.'}
            </p>
            {backend === 'builtin' && (
              <>
                <div className="browser-setting-row">
                  <span className="browser-setting-label">Site approval</span>
                  <BaseSelect
                    open={approvalOpen}
                    onToggle={() => setApprovalOpen(open => !open)}
                    onClose={() => setApprovalOpen(false)}
                    title="Site approval"
                    align="right"
                    trigger={<span className="select-value-label">{siteApproval === 'off' ? "Don't ask" : 'Ask first'}</span>}
                  >
                    <div>
                      {([
                        { value: 'ask', label: 'Ask before acting on a new site' },
                        { value: 'off', label: "Don't ask" }
                      ] as const).map(option => (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={siteApproval === option.value}
                          className={`menu-item ${siteApproval === option.value ? 'active' : ''}`}
                          disabled={saving}
                          onClick={() => {
                            setApprovalOpen(false)
                            if (option.value !== siteApproval) void saveBrowser({ siteApproval: option.value })
                          }}
                        >
                          <span className="menu-item-label">{option.label}</span>
                          <span className="menu-item-check">{siteApproval === option.value && <Check size={14} aria-hidden="true" />}</span>
                        </button>
                      ))}
                    </div>
                  </BaseSelect>
                </div>
                {siteApproval === 'off' && (
                  <p className="browser-setting-help warn">Meow can click and type on any site without asking.</p>
                )}
                <div className="browser-setting-row">
                  <span className="browser-setting-label">Browsing data</span>
                  <button className="btn small" disabled={saving} onClick={() => setConfirmClear(true)}>
                    Clear browsing data
                  </button>
                </div>
                {cleared && <p className="browser-setting-help">Browsing data cleared.</p>}
              </>
            )}
            {saving && <p className="browser-setting-help">Saving…</p>}
            {saveError && <p className="browser-setting-help warn" role="alert">{saveError}</p>}
          </div>
        </div>
        {pending ? (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldAlert size={18} style={{ color: '#eab308' }} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Extension wants to connect</h4>
                <p className="context-card-desc">
                  Approve it once — later connections from this extension id are trusted automatically.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="browser-extension-id">
                <span className="updates-status-desc">Extension ID</span>
                <span className="browser-extension-id-value">{pending.extensionId}</span>
                {pending.version && (
                  <span className="updates-status-desc">Version {pending.version}</span>
                )}
              </div>
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>
                  <Check size={14} />
                  Allow
                </button>
                <button className="btn" disabled={busy} onClick={() => void decide(false)}>
                  <X size={14} />
                  Deny
                </button>
              </div>
            </div>
          </div>
        ) : status?.paired ? (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldCheck size={18} style={{ color: '#22c55e' }} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Active Connection</h4>
                <p className="context-card-desc">
                  Chrome Extension is connected and ready for browser automation.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="updates-status-banner ok">
                <div className="updates-info-group">
                  <CheckCircle2 size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
                  <div className="updates-status-text">
                    <span className="updates-status-title">Bridge Ready</span>
                    <span className="updates-status-desc">
                      Connected via local loopback on port {status.port ?? '127.0.0.1'}.
                    </span>
                  </div>
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
                  <FolderOpen size={14} />
                  Extension Folder
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <Compass size={18} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Extension Setup</h4>
                <p className="context-card-desc">
                  Install the Meow extension in Chrome. It asks for approval here the first time it connects.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() => void window.api.openBrowserInstallGuide()}
                >
                  <ExternalLink size={14} />
                  Open Install Guide
                </button>
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
                  <FolderOpen size={14} />
                  Extension Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {trusted.length > 0 && (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldCheck size={18} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Trusted extensions</h4>
                <p className="context-card-desc">
                  These extension ids connect without asking. Revoking disconnects one immediately.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              {trusted.map(entry => (
                <div className="browser-trusted-row" key={entry.id}>
                  <span className="browser-extension-id-value">{entry.id}</span>
                  <button
                    className="btn icon-btn"
                    title="Revoke"
                    disabled={busy}
                    onClick={() => void revoke(entry.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {confirmClear && (
        <ConfirmDialog
          title="Clear browsing data"
          message="Sign out of all sites in the built-in browser and delete its cookies, storage and cache? This cannot be undone. Open pages may need to be reloaded."
          confirmLabel="Clear browsing data"
          onConfirm={() => void clearData()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </BaseModal>
  )
}
