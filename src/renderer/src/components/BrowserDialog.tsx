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
import BaseModal from './common/BaseModal'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [trusted, setTrusted] = useState<TrustedExtension[]>([])
  const [busy, setBusy] = useState(false)

  const refreshTrusted = useCallback(async () => {
    setTrusted(await window.api.getBrowserTrustedExtensions())
  }, [])

  useEffect(() => {
    void refreshTrusted()
  }, [refreshTrusted])

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
    </BaseModal>
  )
}
