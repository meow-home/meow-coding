import { useEffect, useState } from 'react'
import type { UpdaterStatusEvent } from '@shared/types'
import MarkdownText from './chat/MarkdownText'
import BaseModal from './common/BaseModal'

interface Props {
  status: UpdaterStatusEvent | null
  onClose: () => void
  onInstall: () => void
}

export default function UpdateDialog({ status, onClose, onInstall }: Props) {
  const [meta, setMeta] = useState<{ version: string; currentVersion?: string; releaseNotes?: string } | null>(null)

  useEffect(() => {
    if (status?.type === 'update-available') {
      setMeta({ version: status.version, currentVersion: status.currentVersion, releaseNotes: status.releaseNotes })
    }
  }, [status])

  if (!status || (status.type !== 'update-available' && status.type !== 'downloaded' && status.type !== 'download-progress')) {
    return null
  }

  const downloading = status.type === 'download-progress'
  const ready = status.type === 'downloaded'
  const version = status.type === 'downloaded' ? status.version : status.type === 'update-available' ? status.version : meta?.version
  const currentVersion = status.type === 'update-available' ? status.currentVersion : meta?.currentVersion
  const releaseNotes = status.type === 'update-available' ? status.releaseNotes : meta?.releaseNotes

  const actionsNode = (
    <>
      <button className="btn" onClick={onClose} disabled={downloading}>Later</button>
      <button className="btn primary" onClick={onInstall} disabled={downloading}>
        {ready ? 'Restart now' : 'Update & Restart'}
      </button>
    </>
  )

  return (
    <BaseModal
      title={ready ? 'Update ready' : 'Update available'}
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="update-dialog"
      closeOnBackdropClick={!downloading}
      closeOnEscape={!downloading}
    >
      {version && (
        <p className="update-version">
          {currentVersion ? `v${currentVersion} → v${version}` : `v${version}`}
        </p>
      )}
      {releaseNotes && (
        <div className="update-changelog">
          <MarkdownText text={releaseNotes} />
        </div>
      )}
      {downloading && (
        <>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <div className="update-progress-label">{status.percent}%</div>
        </>
      )}
    </BaseModal>
  )
}
