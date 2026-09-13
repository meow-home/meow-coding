# BaseSelect Component Design

## Context & Motivation
Currently, selection controls (e.g. `ModePicker` for selecting agent mode `build`/`plan`, and `VariantPicker` for selecting model effort levels) use `BaseDropdown` / `Dropdown` wrappers.
However, `BaseDropdown` is conceptually tailored for **action menus** (e.g., project context menu, session menu, pane menu, file actions).

To establish clear component responsibilities and proper ARIA semantics in the UI:
1. **Action Menus** use `BaseDropdown` / `Dropdown` (for triggering actions).
2. **Selectors** use a dedicated `BaseSelect` component (for picking values from a list).

## Architecture & Component Design

### 1. `BaseSelect` (`src/renderer/src/components/common/BaseSelect.tsx`)
A reusable selector wrapper positioned in `src/renderer/src/components/common/BaseSelect.tsx`.

#### Interface
```typescript
import type { ReactNode } from 'react'

export interface BaseSelectProps {
  /** Selected value or current visual trigger content */
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
```

#### Key Characteristics
- Wraps `BaseDropdown` under the hood for positioning (`computeDropdownPosition`), auto-flipping, auto-clamping, and portal rendering.
- Trigger rendered with `role="combobox"`, `aria-haspopup="listbox"`, and `aria-expanded={open}`.
- Dropdown menu container rendered with `role="listbox"`.
- Chevron down caret included automatically alongside custom `trigger` content.

### 2. Component Refactoring

#### `ModePicker.tsx` (`src/renderer/src/components/chat/ModePicker.tsx`)
- Refactored from `Dropdown` to `BaseSelect`.
- Renders `BaseSelect` with mode choices (`build` / `plan`).

#### `VariantPicker.tsx` (`src/renderer/src/components/chat/VariantPicker.tsx`)
- Refactored from `Dropdown` to `BaseSelect`.
- Renders `BaseSelect` with model effort variants (`Default`, `High`, `Low`, etc.).

#### `AddMenu.tsx` (`src/renderer/src/components/chat/AddMenu.tsx`)
- Remains an action menu (attaching files / adding folders).
- Uses `BaseDropdown` directly or `Dropdown` for action menus.

## Testing Strategy
1. **Unit / Integration Tests**: Add `tests/unit/base-select.test.ts` to verify `BaseSelect` props, accessibility attributes, and export.
2. **Type Checking & Full Test Suite**: Run `npm run typecheck` and `npm test`.

## Documentation Sync
- Update `src/renderer/src/components/common/AGENTS.md` to document `BaseSelect.tsx`.
- Update `src/renderer/src/components/chat/AGENTS.md` for `ModePicker` and `VariantPicker` updates.
- Update `docs/reference/` if component architecture reference pages describe common UI components.
