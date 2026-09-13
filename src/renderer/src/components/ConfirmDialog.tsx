import type { ReactNode } from 'react'
import BaseModal from './common/BaseModal'

interface Props {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm(): void
  onCancel(): void
}

export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true, onConfirm, onCancel
}: Props) {
  const actions = (
    <>
      <button className="btn" onClick={onCancel}>{cancelLabel}</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={onConfirm}>
        {confirmLabel}
      </button>
    </>
  )

  return (
    <BaseModal
      title={title}
      onClose={onCancel}
      actions={actions}
      role="alertdialog"
      size="sm"
    >
      <p className="settings-hint">{message}</p>
    </BaseModal>
  )
}
