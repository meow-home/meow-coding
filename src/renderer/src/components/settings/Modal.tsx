import type { ReactNode } from 'react'
import BaseModal from '../common/BaseModal'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
  submitLabel?: string
  onSubmit?(): void
  submitDisabled?: boolean
}

export default function Modal({
  title, onClose, children, submitLabel = 'Save', onSubmit, submitDisabled = false
}: Props) {
  const actions = (
    <>
      <button className="btn" onClick={onClose}>Cancel</button>
      {onSubmit && (
        <button className="btn primary submit" disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </button>
      )}
    </>
  )

  return (
    <BaseModal
      title={title}
      onClose={onClose}
      actions={actions}
    >
      {children}
    </BaseModal>
  )
}
