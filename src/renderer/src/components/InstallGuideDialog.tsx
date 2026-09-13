import { useEffect, useState } from 'react'
import {
  Puzzle,
  ExternalLink,
  FolderOpen,
  Copy,
  Check,
  ShieldCheck
} from 'lucide-react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'
import BaseModal from './common/BaseModal'

interface Props {
  guide: BrowserInstallGuideEvent | null
  onClose: () => void
}

export default function InstallGuideDialog({ guide, onClose }: Props) {
  const [extensionDir, setExtensionDir] = useState<string | null>(guide?.extensionDir ?? null)
  const [copiedDir, setCopiedDir] = useState(false)

  useEffect(() => {
    if (guide) setExtensionDir(guide.extensionDir)
  }, [guide])

  const handleCopyDir = async () => {
    if (!extensionDir) return
    try {
      await navigator.clipboard.writeText(extensionDir)
      setCopiedDir(true)
      setTimeout(() => setCopiedDir(false), 2000)
    } catch {
      // ignore
    }
  }

  const titleNode = (
    <div className="browser-modal-header">
      <div className="browser-modal-title">
        <Puzzle size={18} style={{ color: 'var(--accent)' }} />
        <span>Install Meow Browser Bridge</span>
      </div>
    </div>
  )

  const actionsNode = (
    <>
      <button className="btn primary" onClick={() => void window.api.openBrowserChromeExtensions()}>
        <ExternalLink size={14} />
        Open chrome://extensions
      </button>
      <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
        <FolderOpen size={14} />
        Extension Folder
      </button>
    </>
  )

  return (
    <BaseModal
      title={titleNode}
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="browser-dialog"
    >
      <div className="browser-dialog-body">
        <div className="browser-guide-steps">
          {/* Step 1 */}
          <div className="browser-guide-step">
            <div className="browser-step-num">1</div>
            <div className="browser-step-content">
              <span className="browser-step-title">Open Chrome Extensions Page</span>
              <span className="browser-step-desc">
                Click <strong>Open chrome://extensions</strong> below or navigate to <code>chrome://extensions</code> in Chrome.
              </span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="browser-guide-step">
            <div className="browser-step-num">2</div>
            <div className="browser-step-content">
              <span className="browser-step-title">Enable Developer Mode</span>
              <span className="browser-step-desc">
                Toggle on <strong>Developer mode</strong> using the switch in the top-right corner of Chrome's Extensions page.
              </span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="browser-guide-step">
            <div className="browser-step-num">3</div>
            <div className="browser-step-content">
              <span className="browser-step-title">Load Unpacked Extension</span>
              <span className="browser-step-desc">
                Click <strong>Load unpacked</strong> in the top toolbar and select the directory below:
              </span>
              {extensionDir && (
                <div className="browser-dir-box">
                  <span className="browser-dir-text">{extensionDir}</span>
                  <button
                    className="btn icon-btn"
                    style={{ width: '1.875rem', height: '1.875rem', flexShrink: 0 }}
                    title="Copy path"
                    onClick={() => void handleCopyDir()}
                  >
                    {copiedDir ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Step 4 */}
          <div className="browser-guide-step">
            <div className="browser-step-num">4</div>
            <div className="browser-step-content">
              <span className="browser-step-title">Pair Extension</span>
              <span className="browser-step-desc">
                Open the Browser Bridge popup in Meow, click <strong>Generate Pairing Code</strong>, and enter the code into the Meow extension popup in Chrome.
              </span>
            </div>
          </div>
        </div>

        {/* Security Banner */}
        <div className="browser-info-banner">
          <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span>
            The extension only connects to Meow on this machine (<code>127.0.0.1</code>) and requires a pairing code for local security.
          </span>
        </div>
      </div>
    </BaseModal>
  )
}
