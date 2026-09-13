import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
}

export default function BaseModal({
  title,
  onClose,
  children,
  actions,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  size = 'md',
  role = 'dialog',
  className = '',
  backdropClassName = ''
}: BaseModalProps) {
  useEffect(() => {
    if (!closeOnEscape || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeOnEscape, onClose])

  const handleBackdropClick = () => {
    if (closeOnBackdropClick && onClose) {
      onClose()
    }
  }

  const dialogClasses = ['dialog', `dialog-${size}`, className].filter(Boolean).join(' ')
  const backdropClasses = ['dialog-backdrop', backdropClassName].filter(Boolean).join(' ')
  const titleId = title ? 'base-modal-title' : undefined

  const modalContent = (
    <div className={backdropClasses} onClick={handleBackdropClick}>
      <div
        className={dialogClasses}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <h3 id={titleId}>{title}</h3>
        )}
        {showCloseButton && onClose && (
          <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        )}
        {children}
        {actions && (
          <div className="dialog-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return modalContent
  }

  return createPortal(modalContent, document.body)
}
