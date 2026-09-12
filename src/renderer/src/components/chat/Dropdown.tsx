import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

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

// Reusable popup dropdown: button trigger + menu portaled to <body> so it
// overlays the whole app and is never clipped by an ancestor's overflow or
// stacking context. The menu opens upward, right-aligned to the trigger.
// Closes on outside mousedown (checks both trigger and portaled menu) and Escape.
export default function Dropdown({
  trigger, open, onToggle, onClose, title, ariaLabel, menuClassName = '', align = 'right', children
}: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)

  // Position the portaled menu from the trigger's viewport rect; keep it in
  // sync while open as the layout scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({
        position: 'fixed',
        bottom: window.innerHeight - r.top + 4,
        ...(align === 'left' ? { left: r.left } : { right: window.innerWidth - r.right })
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return (
    <div className="dropdown">
      <button
        ref={triggerRef}
        className="dropdown-trigger"
        title={title}
        aria-label={ariaLabel ?? title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        {trigger}
        <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className={`dropdown-menu ${menuClassName}`.trim()} style={pos}>
          {children}
        </div>,
        document.body
      )}
    </div>
  )
}
