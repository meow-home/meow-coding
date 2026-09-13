import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import BaseDropdown from '../common/BaseDropdown'

interface DropdownProps {
  trigger: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  ariaLabel?: string
  menuClassName?: string
  /**
   * Which menu edge lines up with the trigger. Defaults to 'right' — the sidebar
   * and the composer's right-hand pickers anchor on their trigger's right edge.
   * A trigger sitting at the *left* edge of its container needs 'left': anchoring
   * its right edge there pushes the menu (which is wider than the 24px button)
   * out to the left, clear of the container it belongs to.
   */
  align?: 'left' | 'right'
  children: ReactNode
}

// Reusable popup dropdown wrapping BaseDropdown for backward compatibility.
export default function Dropdown({
  trigger, open, onToggle, onClose, title, ariaLabel, menuClassName = '', align = 'right', children
}: DropdownProps) {
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
      menuClassName={`dropdown-menu ${menuClassName}`.trim()}
      trigger={(
        <button
          ref={triggerRef}
          className="dropdown-trigger"
          title={title}
          aria-label={ariaLabel ?? title}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {trigger}
          <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
        </button>
      )}
    >
      {children}
    </BaseDropdown>
  )
}
