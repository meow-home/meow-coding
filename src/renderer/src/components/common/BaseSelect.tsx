import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import BaseDropdown from './BaseDropdown'

export interface BaseSelectProps {
  trigger?: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  ariaLabel?: string
  menuClassName?: string
  align?: 'left' | 'right'
  children: ReactNode
}

export default function BaseSelect({
  trigger,
  open,
  onToggle,
  onClose,
  title,
  ariaLabel,
  menuClassName = '',
  align = 'right',
  children
}: BaseSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <BaseDropdown
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) {
          if (nextOpen) onToggle()
          else onClose()
        }
      }}
      placement={align === 'left' ? 'top-start' : 'top-end'}
      menuClassName={`dropdown-menu select-menu ${menuClassName}`.trim()}
      trigger={(
        <button
          ref={triggerRef}
          className="dropdown-trigger select-trigger"
          title={title}
          aria-label={ariaLabel ?? title}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {trigger}
          <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
        </button>
      )}
    >
      <div role="listbox">{children}</div>
    </BaseDropdown>
  )
}
