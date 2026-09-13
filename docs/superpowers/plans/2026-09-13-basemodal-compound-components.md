# BaseModal Compound Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `BaseModal` to support compound components (`BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`) with distinct borders while maintaining full backward compatibility with legacy props (`title`, `actions`, `children`).

**Architecture:** Add sub-components `Header`, `Body`, and `Footer` attached directly to `BaseModal`. In `BaseModal`, inspect children to render compound components directly or auto-wrap legacy props. Update `styles.css` to add border separators (`border-bottom` on header, `border-top` on footer) and padding options (`.no-padding`).

**Tech Stack:** React 19, TypeScript, Vitest, CSS.

## Global Constraints

- Preserve all existing `BaseModalProps` (`title`, `actions`, `onClose`, `closeOnBackdropClick`, `closeOnEscape`, `size`, `role`, `className`, `backdropClassName`).
- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Update CSS for BaseModal Header, Body, Footer in styles.css

**Files:**
- Modify: `src/renderer/src/styles.css:585-625`

**Interfaces:**
- Produces: CSS classes `.dialog-header`, `.dialog-body`, `.dialog-body.no-padding`, `.dialog-footer`.

- [ ] **Step 1: Edit styles.css to add Header, Body, Footer styles**

Edit `src/renderer/src/styles.css` around line 587 to update `.dialog` and add `.dialog-header`, `.dialog-body`, `.dialog-footer`:

```css
.dialog {
  background: var(--bg-chat);
  border: 0.083333rem solid var(--hairline);
  box-shadow: var(--shadow-3);
  border-radius: var(--radius-lg);
  padding: 0;
  display: flex; flex-direction: column;
  position: relative;
  overflow: hidden;
}
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.833333rem 1.25rem;
  border-bottom: 0.083333rem solid var(--hairline);
}
.dialog-header h3 { margin: 0; font-size: var(--fs-lg); font-family: var(--font-display); font-weight: var(--fw-semibold); }
.dialog-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 1rem 1.25rem;
}
.dialog-body.no-padding { padding: 0; }
.dialog-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;
  padding: 0.833333rem 1.25rem;
  border-top: 0.083333rem solid var(--hairline);
}
```

- [ ] **Step 2: Commit CSS changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): add header, body, and footer border styles for BaseModal"
```

---

### Task 2: Implement BaseModal Compound Components & Legacy Fallback

**Files:**
- Modify: `src/renderer/src/components/common/BaseModal.tsx`

**Interfaces:**
- Produces: `BaseModal` with attached `BaseModal.Header`, `BaseModal.Body`, and `BaseModal.Footer`.

- [ ] **Step 1: Refactor BaseModal.tsx with Compound Components**

Update `src/renderer/src/components/common/BaseModal.tsx`:

```tsx
import React, { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children?: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
}

export interface HeaderProps {
  title?: ReactNode
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
  children?: ReactNode
}

export interface BodyProps {
  noPadding?: boolean
  className?: string
  children: ReactNode
}

export interface FooterProps {
  className?: string
  children: ReactNode
}

function ModalHeader({
  title,
  onClose,
  showCloseButton = true,
  className = '',
  children
}: HeaderProps) {
  const titleId = title ? 'base-modal-title' : undefined
  return (
    <header className={`dialog-header ${className}`.trim()}>
      {title && <h3 id={titleId}>{title}</h3>}
      {children}
      {showCloseButton && onClose && (
        <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
      )}
    </header>
  )
}

function ModalBody({
  noPadding = false,
  className = '',
  children
}: BodyProps) {
  const classes = ['dialog-body', noPadding ? 'no-padding' : '', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {children}
    </div>
  )
}

function ModalFooter({
  className = '',
  children
}: FooterProps) {
  return (
    <footer className={`dialog-footer ${className}`.trim()}>
      {children}
    </footer>
  )
}

function BaseModalRoot({
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

  const childArray = React.Children.toArray(children)
  const isCompound = childArray.some(
    child => React.isValidElement(child) && (
      child.type === ModalHeader ||
      child.type === ModalBody ||
      child.type === ModalFooter
    )
  )

  const content = isCompound ? (
    children
  ) : (
    <>
      {(title || (showCloseButton && onClose)) && (
        <ModalHeader title={title} onClose={onClose} showCloseButton={showCloseButton} />
      )}
      {children && <ModalBody>{children}</ModalBody>}
      {actions && <ModalFooter>{actions}</ModalFooter>}
    </>
  )

  const modalContent = (
    <div className={backdropClasses} onClick={handleBackdropClick}>
      <div
        className={dialogClasses}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return modalContent
  }

  return createPortal(modalContent, document.body)
}

export const BaseModal = Object.assign(BaseModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter
})

export default BaseModal
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit implementation**

```bash
git add src/renderer/src/components/common/BaseModal.tsx
git commit -m "feat(ui): implement BaseModal compound sub-components with legacy fallback"
```

---

### Task 3: Unit Tests & Documentation Sync

**Files:**
- Modify: `tests/unit/base-modal.test.ts`
- Modify: `src/renderer/src/components/common/AGENTS.md`

- [ ] **Step 1: Update base-modal.test.ts**

Update `tests/unit/base-modal.test.ts` to test both Compound Components and legacy prop fallbacks:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseModal from '../../src/renderer/src/components/common/BaseModal'

describe('BaseModal', () => {
  it('renders title, content, actions, and portal dialog wrapper with legacy props', () => {
    const markup = renderToStaticMarkup(createElement(BaseModal, {
      title: 'Modal Title Test',
      onClose: () => {},
      actions: createElement('button', { className: 'btn' }, 'Save'),
      size: 'lg',
      role: 'dialog'
    }, createElement('p', null, 'Modal Body Content')))

    expect(markup).toContain('dialog-backdrop')
    expect(markup).toContain('dialog dialog-lg')
    expect(markup).toContain('dialog-header')
    expect(markup).toContain('dialog-body')
    expect(markup).toContain('dialog-footer')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Modal Title Test')
    expect(markup).toContain('Modal Body Content')
    expect(markup).toContain('Save')
    expect(markup).toContain('dialog-close')
  })

  it('renders correctly with Compound Components (BaseModal.Header, BaseModal.Body, BaseModal.Footer)', () => {
    const markup = renderToStaticMarkup(
      createElement(BaseModal, { size: 'xl' },
        createElement(BaseModal.Header, { title: 'Compound Title' }),
        createElement(BaseModal.Body, { noPadding: true }, createElement('div', null, 'Full Bleed Body')),
        createElement(BaseModal.Footer, null, createElement('button', null, 'Confirm'))
      )
    )

    expect(markup).toContain('dialog-header')
    expect(markup).toContain('Compound Title')
    expect(markup).toContain('dialog-body no-padding')
    expect(markup).toContain('Full Bleed Body')
    expect(markup).toContain('dialog-footer')
    expect(markup).toContain('Confirm')
  })

  it('omits close button when showCloseButton is false or onClose is absent', () => {
    const markup = renderToStaticMarkup(createElement(BaseModal, {
      title: 'No Close Button',
      showCloseButton: false
    }, createElement('p', null, 'Content')))

    expect(markup).not.toContain('dialog-close')
  })

  it('defines dialog modifier and section rules in styles.css', () => {
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    expect(css).toContain('.dialog.dialog-sm { width: 28rem; }')
    expect(css).toContain('.dialog.dialog-md { width: 35rem; }')
    expect(css).toContain('.dialog.dialog-lg { width: 45rem; }')
    expect(css).toContain('.dialog.dialog-xl { width: 72rem; max-width: 90vw; }')
    expect(css).toContain('.dialog-header')
    expect(css).toContain('.dialog-body')
    expect(css).toContain('.dialog-footer')
  })
})
```

- [ ] **Step 2: Run Vitest test suite**

Run: `npm test tests/unit/base-modal.test.ts`
Expected: PASS

- [ ] **Step 3: Update AGENTS.md**

Update `src/renderer/src/components/common/AGENTS.md` to reflect the Compound Components API and sub-components.

- [ ] **Step 4: Run full test suite & typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit tests and documentation**

```bash
git add tests/unit/base-modal.test.ts src/renderer/src/components/common/AGENTS.md
git commit -m "test(ui): add compound component tests for BaseModal and update AGENTS.md"
```
