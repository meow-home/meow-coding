import { ArrowUpCircle, X } from 'lucide-react'

interface Props {
  version: string
  onRestart: () => void
  onOpen: () => void
  onDismiss: () => void
}

/**
 * Non-modal notice for an update that finished downloading in the background.
 * The OS notification covers the unfocused case; this one is what the user sees
 * while working, so a completed download is never silently missed.
 */
export default function UpdateToast({ version, onRestart, onOpen, onDismiss }: Props) {
  return (
    <div className="update-toast" role="status" aria-live="polite">
      <button className="update-toast-body" onClick={onOpen} title="Show update details">
        <ArrowUpCircle size={16} className="update-toast-icon" />
        <span className="update-toast-text">
          <span className="update-toast-title">v{version} is ready</span>
          <span className="update-toast-desc">Installs when you quit.</span>
        </span>
      </button>
      <div className="update-toast-actions">
        <button className="btn small" onClick={onDismiss}>Later</button>
        <button className="btn primary small" onClick={onRestart}>Restart now</button>
      </div>
      <button className="icon-btn update-toast-close" onClick={onDismiss} aria-label="Dismiss update notice">
        <X size={13} />
      </button>
    </div>
  )
}
