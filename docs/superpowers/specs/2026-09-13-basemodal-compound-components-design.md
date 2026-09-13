# BaseModal Compound Components Design Spec

## Overview
This specification details the refactoring of `BaseModal` into a structured, compound-component modal system consisting of three distinct sections: **Header**, **Body**, and **Footer**, with hairline borders separating each section.

`BaseModal` supports both a **Compound Component API** (`BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`) and a **Legacy Compatibility Wrapper** (automatically wrapping `title`, `children`, and `actions` props) so existing modal implementations continue to render cleanly.

---

## Component Architecture & API

### 1. `BaseModal` Root Component
- **Props**:
  - `onClose?: () => void`
  - `closeOnBackdropClick?: boolean` (default `true`)
  - `closeOnEscape?: boolean` (default `true`)
  - `size?: 'sm' | 'md' | 'lg' | 'xl'` (default `'md'`)
  - `role?: 'dialog' | 'alertdialog'` (default `'dialog'`)
  - `className?: string`
  - `backdropClassName?: string`
  - *Legacy props (for backward compatibility)*: `title?: ReactNode`, `showCloseButton?: boolean`, `actions?: ReactNode`

- **Behavior**:
  - Portals to `document.body`.
  - Captures `Escape` key and backdrop click events.
  - Inspects `children`: if `BaseModal.Header` or `BaseModal.Body` or `BaseModal.Footer` is detected, renders children directly. Otherwise, automatically wraps legacy `title` in `<BaseModal.Header>`, `children` in `<BaseModal.Body>`, and `actions` in `<BaseModal.Footer>`.

### 2. Sub-components

#### `BaseModal.Header`
- **Props**:
  - `title?: ReactNode`
  - `onClose?: () => void`
  - `showCloseButton?: boolean` (default `true`)
  - `className?: string`
  - `children?: ReactNode`
- **DOM Output**:
  - `<header className="dialog-header">`
  - Renders `<h3>` title or custom `children`.
  - Renders close button `✕` (`.dialog-close`) when `showCloseButton` is true and `onClose` is provided.
  - Border: `border-bottom: 0.083333rem solid var(--hairline)`.

#### `BaseModal.Body`
- **Props**:
  - `noPadding?: boolean` (default `false`)
  - `className?: string`
  - `children: ReactNode`
- **DOM Output**:
  - `<div className="dialog-body [no-padding]">`
  - Standard padding: `1rem 1.25rem`. When `noPadding={true}`, padding is set to `0` for custom full-bleed elements (e.g. sidebar grid in `SettingsDialog`).

#### `BaseModal.Footer`
- **Props**:
  - `className?: string`
  - `children: ReactNode`
- **DOM Output**:
  - `<footer className="dialog-footer">`
  - Layout: `display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem`.
  - Border: `border-top: 0.083333rem solid var(--hairline)`.

---

## CSS Architecture (`styles.css`)

```css
/* Dialog Base Shell */
.dialog {
  background: var(--bg-chat);
  border: 0.083333rem solid var(--hairline);
  box-shadow: var(--shadow-3);
  border-radius: var(--radius-lg);
  padding: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* Header */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.833333rem 1.25rem;
  border-bottom: 0.083333rem solid var(--hairline);
}
.dialog-header h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-family: var(--font-display);
  font-weight: var(--fw-semibold);
}

/* Body */
.dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}
.dialog-body.no-padding {
  padding: 0;
}

/* Footer */
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.833333rem 1.25rem;
  border-top: 0.083333rem solid var(--hairline);
}
```

---

## Verification Plan

1. **Unit Testing (`tests/unit/base-modal.test.ts`)**:
   - Verify rendering of `<BaseModal.Header>`, `<BaseModal.Body>`, and `<BaseModal.Footer>`.
   - Verify `noPadding` prop applies `.no-padding` class to body.
   - Verify legacy prop fallback auto-wraps content into header/body/footer structure.
2. **Typecheck & Global Test Suite**:
   - Run `npm run typecheck` and `npm test` to ensure 100% pass across unit and integration tests.
