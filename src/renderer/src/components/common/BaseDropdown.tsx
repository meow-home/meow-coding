import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'

export type DropdownPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom-center'
  | 'top-start'
  | 'top-end'
  | 'top-center'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end'

export interface BaseDropdownProps {
  trigger: ReactNode | ((props: { open: boolean; toggle: () => void }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: DropdownPlacement
  offset?: number
  menuClassName?: string
  menuStyle?: CSSProperties
  children: ReactNode
  closeOnOutsideClick?: boolean
  closeOnEscape?: boolean
}

export function computeDropdownPosition({
  triggerRect,
  menuRect,
  windowBounds,
  placement = 'bottom-start',
  offset = 4
}: {
  triggerRect: { top: number; bottom: number; left: number; right: number; width: number; height: number }
  menuRect: { width: number; height: number }
  windowBounds: { width: number; height: number }
  placement?: DropdownPlacement
  offset?: number
}): CSSProperties {
  const margin = 8
  const spaceBelow = windowBounds.height - triggerRect.bottom - offset - margin
  const spaceAbove = triggerRect.top - offset - margin

  let verticalDir: 'bottom' | 'top' = placement.startsWith('top') ? 'top' : 'bottom'

  if (verticalDir === 'bottom' && menuRect.height > spaceBelow && spaceAbove > spaceBelow) {
    verticalDir = 'top'
  } else if (verticalDir === 'top' && menuRect.height > spaceAbove && spaceBelow > spaceAbove) {
    verticalDir = 'bottom'
  }

  const resultStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: 'auto',
    bottom: 'auto',
    left: 'auto',
    right: 'auto'
  }

  if (verticalDir === 'top') {
    resultStyle.bottom = windowBounds.height - triggerRect.top + offset
  } else {
    resultStyle.top = triggerRect.bottom + offset
  }

  const maxAvail = verticalDir === 'top' ? spaceAbove : spaceBelow
  if (menuRect.height > maxAvail && maxAvail > 0) {
    resultStyle.maxHeight = Math.max(maxAvail, 120)
    resultStyle.overflowY = 'auto'
  }

  if (placement.endsWith('end')) {
    const calculatedRight = windowBounds.width - triggerRect.right
    const clampRight = Math.max(margin, Math.min(calculatedRight, windowBounds.width - menuRect.width - margin))
    resultStyle.right = clampRight
    resultStyle.left = 'auto'
  } else if (placement.endsWith('center')) {
    const triggerCenter = triggerRect.left + triggerRect.width / 2
    let calculatedLeft = triggerCenter - menuRect.width / 2
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  } else {
    let calculatedLeft = triggerRect.left
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  }

  return resultStyle
}

export default function BaseDropdown({
  trigger,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  offset = 4,
  menuClassName = '',
  menuStyle = {},
  children,
  closeOnOutsideClick = true,
  closeOnEscape = true
}: BaseDropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)

  const toggle = () => {
    const next = !isOpen
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const close = () => {
    if (!isControlled) setUncontrolledOpen(false)
    onOpenChange?.(false)
  }

  useLayoutEffect(() => {
    if (!isOpen) return
    const updatePosition = () => {
      if (!triggerRef.current || !menuRef.current) return
      const tRect = triggerRef.current.getBoundingClientRect()
      const mRect = menuRef.current.getBoundingClientRect()
      const calculated = computeDropdownPosition({
        triggerRect: tRect,
        menuRect: mRect,
        windowBounds: { width: window.innerWidth, height: window.innerHeight },
        placement,
        offset
      })
      setPos(calculated)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, placement, offset])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!closeOnOutsideClick) return
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, closeOnOutsideClick, closeOnEscape])

  return (
    <div className="base-dropdown-container" ref={triggerRef} style={{ display: 'inline-flex' }}>
      {typeof trigger === 'function' ? trigger({ open: isOpen, toggle }) : (
        <div
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          style={{ display: 'inline-flex', cursor: 'pointer' }}
        >
          {trigger}
        </div>
      )}

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className={`base-dropdown-menu ${menuClassName}`}
          style={{ ...pos, ...menuStyle }}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  )
}
