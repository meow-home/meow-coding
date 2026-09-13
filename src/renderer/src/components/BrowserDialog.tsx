import { useState } from 'react'
import {
  Globe,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Radio,
  Compass,
  Key,
  ExternalLink,
  FolderOpen,
  Copy,
  Check
} from 'lucide-react'
import type { BrowserStatusInfo, PairingInfo } from '@shared/browser-types'
import BaseModal from './common/BaseModal'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  const pair = async () => {
    const info = await window.api.pairBrowser()
    setPairing(info)
    setCopiedCode(false)
  }

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      // ignore fallback
    }
  }

  const waiting = !status?.paired && (status?.status === 'listening' || status?.status === 'idle')
  const pillClass = status?.paired ? 'paired' : waiting ? 'waiting' : 'idle'

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
    <BaseModal
      title={titleNode}
      onClose={onClose}
      size="lg"
      className="browser-dialog"
    >
      <div className="browser-dialog-body">
        {status?.paired ? (
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
              <div className="row" style={{ marginTop: '0.25rem' }}>
                <button className="btn" onClick={pair}>
                  <Key size={14} />
                  New Pairing Code
                </button>
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
                  <FolderOpen size={14} />
                  Extension Folder
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Setup Card */}
            <div className="browser-card">
              <div className="browser-card-head">
                <div className="context-icon-badge">
                  <Compass size={18} />
                </div>
                <div className="context-title-group">
                  <h4 className="context-card-title">Extension Setup</h4>
                  <p className="context-card-desc">
                    Install the Meow extension in Chrome, then authorize it with a pairing code.
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
                  <button
                    className="btn"
                    onClick={() => void window.api.openBrowserExtensionFolder()}
                  >
                    <FolderOpen size={14} />
                    Extension Folder
                  </button>
                </div>
              </div>
            </div>

            {/* Pairing Card */}
            <div className="browser-card">
              <div className="browser-card-head">
                <div className="context-icon-badge">
                  <Key size={18} />
                </div>
                <div className="context-title-group">
                  <h4 className="context-card-title">Pairing Passcode</h4>
                  <p className="context-card-desc">
                    Generate a one-time 6-digit code to authorize the Chrome extension.
                  </p>
                </div>
              </div>
              <div className="browser-card-body">
                {pairing ? (
                  <div className="browser-pairing-box">
                    <span className="updates-status-desc" style={{ marginBottom: '0.25rem' }}>
                      Enter this code in the Meow extension popup in Chrome:
                    </span>
                    <div className="browser-code-row">
                      <span className="browser-code-display">{pairing.code}</span>
                      <button
                        className="btn icon-btn"
                        style={{ width: '2.25rem', height: '2.25rem' }}
                        title="Copy pairing code"
                        onClick={() => void handleCopyCode(pairing.code)}
                      >
                        {copiedCode ? <Check size={16} style={{ color: '#22c55e' }} /> : <Copy size={16} />}
                      </button>
                    </div>
                    <span className="updates-status-desc" style={{ marginTop: '0.25rem' }}>
                      Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}
                    </span>
                  </div>
                ) : (
                  <div className="row">
                    <button className="btn primary" onClick={pair}>
                      <Key size={14} />
                      Generate Pairing Code
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </BaseModal>
  )
}
