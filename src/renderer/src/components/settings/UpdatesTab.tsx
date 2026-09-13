import { useEffect, useState } from 'react'
import { DownloadCloud, CheckCircle2, RefreshCw, ArrowUpCircle, AlertCircle, Sparkles, Info } from 'lucide-react'
import type { UpdaterStatusEvent } from '@shared/types'

export default function UpdatesTab() {
  const [status, setStatus] = useState<UpdaterStatusEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
    const off = window.api.onUpdaterStatus(setStatus)
    return off
  }, [])

  const check = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.checkForUpdates()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="updates-tab">
      <div className="updates-card">
        <div className="updates-card-head">
          <div className="context-icon-badge">
            <DownloadCloud size={18} />
          </div>
          <div className="context-title-group">
            <div className="context-title-row">
              <h4 className="context-card-title">Software Updates</h4>
              {version && <span className="context-tag">v{version}</span>}
            </div>
            <p className="context-card-desc">
              Meow checks GitHub Releases on startup to keep your installation up to date.
            </p>
          </div>
        </div>

        <div className="updates-card-body">
          {/* Status Banner */}
          {(!status || status.type === 'up-to-date') && (
            <div className="updates-status-banner ok">
              <div className="updates-info-group">
                <CheckCircle2 size={20} style={{ color: '#22c55e', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">You're on the latest version</span>
                  <span className="updates-status-desc">
                    {version || (status?.type === 'up-to-date' ? status.currentVersion : '')
                      ? `Running version v${version || (status?.type === 'up-to-date' ? status.currentVersion : '')}.`
                      : 'No updates pending.'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {(status?.type === 'checking' || (busy && !status)) && (
            <div className="updates-status-banner info">
              <div className="updates-info-group">
                <RefreshCw size={20} className="spin" style={{ color: '#3b82f6', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">Checking for updates…</span>
                  <span className="updates-status-desc">Querying GitHub Releases for new updates.</span>
                </div>
              </div>
            </div>
          )}

          {status?.type === 'update-available' && (
            <div className="updates-status-banner info">
              <div className="updates-info-group">
                <ArrowUpCircle size={20} style={{ color: '#3b82f6', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">Version v{status.version} is available</span>
                  <span className="updates-status-desc">A new version of Meow is ready to install.</span>
                </div>
              </div>
              <button
                className="btn primary small"
                onClick={() => void window.api.installUpdate()}
              >
                Update &amp; Restart
              </button>
            </div>
          )}

          {status?.type === 'download-progress' && (
            <div className="updates-status-banner info" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="updates-info-group">
                <DownloadCloud size={20} className="spin" style={{ color: '#3b82f6', flexShrink: 0 }} />
                <div className="updates-status-text" style={{ flex: 1 }}>
                  <span className="updates-status-title">Downloading update… ({status.percent}%)</span>
                  <span className="updates-status-desc">Fetching release package from GitHub.</span>
                </div>
              </div>
              <div className="updates-progress-bar" style={{ marginTop: '0.5rem' }}>
                <div className="updates-progress-inner" style={{ width: `${status.percent}%` }} />
              </div>
            </div>
          )}

          {status?.type === 'downloaded' && (
            <div className="updates-status-banner ok">
              <div className="updates-info-group">
                <Sparkles size={20} style={{ color: '#22c55e', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">Download complete</span>
                  <span className="updates-status-desc">Restart Meow now to apply the update.</span>
                </div>
              </div>
              <button
                className="btn primary small"
                onClick={() => void window.api.installUpdate()}
              >
                Restart Now
              </button>
            </div>
          )}

          {status?.type === 'error' && (
            <div className="updates-status-banner error">
              <div className="updates-info-group">
                <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">Update check failed</span>
                  <span className="updates-status-desc">{status.message}</span>
                </div>
              </div>
            </div>
          )}

          {status?.type === 'not-supported' && (
            <div className="updates-status-banner error">
              <div className="updates-info-group">
                <Info size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
                <div className="updates-status-text">
                  <span className="updates-status-title">Updates not supported</span>
                  <span className="updates-status-desc">{status.message}</span>
                </div>
              </div>
            </div>
          )}

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '0.083333rem solid var(--hairline)' }}>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void check()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <RefreshCw size={13} className={busy ? 'spin' : ''} />
              {busy ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
