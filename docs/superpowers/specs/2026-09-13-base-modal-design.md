# BaseModal Component & Modal Migration Design Spec

## Overview
Introduce a common, reusable `BaseModal` component under `src/renderer/src/components/common/BaseModal.tsx` following the project's existing common UI component pattern (`BaseDropdown`, `BaseSelect`). Migrate existing modal dialogs across the application to build upon `BaseModal` for uniform styling, accessibility, backdrop management, keyboard accessibility (Escape key), and React Portal rendering into `document.body`.

*Note: Per explicit user decision, `GitViewer.tsx` is excluded from this migration and remains in its current state.*

---

## 1. Component Architecture: `BaseModal`

### Location
- `src/renderer/src/components/common/BaseModal.tsx`

### Interface (`BaseModalProps`)
```typescript
import { ReactNode } from 'react'

export interface BaseModalProps {
  /** Modal header title (optional) */
  title?: ReactNode
  /** Callback triggered on close (via close button, Escape key, or backdrop click) */
  onClose?: () => void
  /** Content rendered inside the modal body */
  children: ReactNode
  /** Footer action buttons or elements (optional) */
  actions?: ReactNode
  /** Whether to show top-right ✕ close button (default: true) */
  showCloseButton?: boolean
  /** Whether clicking the backdrop triggers onClose (default: true) */
  closeOnBackdropClick?: boolean
  /** Whether pressing Escape key triggers onClose (default: true) */
  closeOnEscape?: boolean
  /** Modal width preset (default: 'md') */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** ARIA accessibility role (default: 'dialog') */
  role?: 'dialog' | 'alertdialog'
  /** Additional CSS class for the dialog container */
  className?: string
  /** Additional CSS class for the backdrop wrapper */
  backdropClassName?: string
}
```

### Core Responsibilities & Behavior
1. **Portal Rendering**: Always renders via `createPortal(..., document.body)` so modal overlays are top-level DOM nodes unaffected by overflow or transform styling of ancestor components.
2. **Keyboard Trapping & Listener**: Listens for the `Escape` key while mounted (when `closeOnEscape` is true) and calls `onClose()`.
3. **Backdrop & Outside Click Handling**: Click on `.dialog-backdrop` triggers `onClose()` (when `closeOnBackdropClick` is true). `.dialog` container uses `e.stopPropagation()` to prevent backdrop click trigger when interacting with modal content.
4. **Accessibility (ARIA)**: Applies `role={role}`, `aria-modal="true"`, and `aria-labelledby` linking to the header title element when `title` is provided.

---

## 2. CSS Styling & Modifier Sizes (`src/renderer/src/styles.css`)

Maintain existing modal styling tokens (`var(--bg-chat)`, `var(--hairline)`, `var(--shadow-3)`, `var(--radius-lg)`) and update/add size modifiers:

```css
/* Modifier sizes for .dialog */
.dialog.dialog-sm { width: 28rem; }
.dialog.dialog-md { width: 35rem; }
.dialog.dialog-lg { width: 45rem; }
.dialog.dialog-xl { width: 55rem; }
```

Default size is `md` (35rem), maintaining backward compatibility with existing dialog styles.

---

## 3. Migration Plan (7 Target Modals)

1. **`ConfirmDialog.tsx`**:
   - Refactor to wrap `BaseModal` with `role="alertdialog"` and `size="sm"`.
   - Pass confirm/cancel buttons into `actions` prop.
2. **`settings/Modal.tsx`**:
   - Refactor to wrap `BaseModal` with `title`, `onClose`, and `actions` (Cancel and Submit buttons).
3. **`BrowserDialog.tsx`**:
   - Refactor to wrap `BaseModal` with `size="lg"`, custom header badge inside `title`, and pairing action buttons in `actions` or `children`.
4. **`InstallGuideDialog.tsx`**:
   - Refactor to wrap `BaseModal` with `size="lg"`.
5. **`UpdateDialog.tsx`**:
   - Refactor to wrap `BaseModal` with `size="lg"` (or `className="update-dialog"`).
6. **`App.tsx` (`UpToDateDialog`)**:
   - Refactor `UpToDateDialog` to wrap `BaseModal` with `size="sm"`.
7. **`ChatPanel.tsx` (`subagent-live` popup)**:
   - Refactor the inline subagent live popup to wrap `BaseModal` with `title="sub-agent..."` and `onClose={() => setLiveTaskId(null)}`.

*Excluded*: `GitViewer.tsx` (kept unchanged per user instruction).

---

## 4. Verification & Testing Strategy

- `npm run typecheck`: Ensure zero TypeScript errors across renderer and common components.
- `npm test`: Verify unit/integration tests continue to pass.
- Manual testing / build check to verify all 7 dialogs render properly with portals and handle closing correctly.
