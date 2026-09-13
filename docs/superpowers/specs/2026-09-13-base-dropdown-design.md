# BaseDropdown Component & Universal Popover Positioning Design

## Overview
Currently, action menus and dropdown pickers across the application (such as `PaneHeader` menu, `FilesOverlay` menu, `GitBranchSwitcher`, and `Sidebar` menus) either render inline inside overflow-clipped containers or use manual position calculations. This leads to menus getting clipped at window edges or truncated when screen height is constrained.

This design introduces a reusable `BaseDropdown` component with intelligent popover positioning (Auto Flip, Auto Shift/Clamp, and Auto Max-Height with scrolling), portaled to `document.body`, and refactors all existing action menus and dropdown pickers to use it.

## Key Goals
1. **Universal Overlay**: Always portal dropdown menus to `document.body` so they are never clipped by parent container `overflow: hidden` or stacking context issues.
2. **Smart Positioning Algorithm**:
   - **Auto-Flip**: Flip vertical orientation (bottom $\leftrightarrow$ top) if there is insufficient space below the trigger element.
   - **Auto-Shift/Clamp**: Adjust horizontal placement (`left` / `right`) to stay strictly within viewport boundaries with a safe margin (8px).
   - **Auto Max-Height**: Set `maxHeight` and `overflowY: 'auto'` dynamically when both top and bottom spaces are insufficient for full menu height.
3. **Comprehensive Refactoring**: Replace existing ad-hoc and inline dropdown components (`PaneHeader`, `FilesOverlay`, `GitBranchSwitcher`, `Sidebar` menus, `Dropdown.tsx` / Chat Pickers) with `BaseDropdown`.

## Component Specification

### File Location
`src/renderer/src/components/common/BaseDropdown.tsx`

### Interface Definition
```typescript
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
  /** Trigger element or render function */
  trigger: ReactNode | ((props: { open: boolean; toggle: () => void }) => ReactNode)
  /** Controlled open state (optional) */
  open?: boolean
  /** Controlled open change callback (optional) */
  onOpenChange?: (open: boolean) => void
  /** Preferred placement before collision detection (default: 'bottom-start') */
  placement?: DropdownPlacement
  /** Distance in pixels between trigger and menu (default: 4) */
  offset?: number
  /** Additional CSS class for the menu container */
  menuClassName?: string
  /** Additional inline styles for the menu container */
  menuStyle?: CSSProperties
  /** Menu content */
  children: ReactNode
  /** Close on outside click (default: true) */
  closeOnOutsideClick?: boolean
  /** Close on Escape key press (default: true) */
  closeOnEscape?: boolean
}
```

### Positioning Logic
1. **Measurement**:
   - Trigger element rect obtained via `triggerRef.current.getBoundingClientRect()`.
   - Menu element dimensions measured on open / render via `menuRef.current.getBoundingClientRect()`.
2. **Vertical Axis**:
   - Calculate available height below: `spaceBelow = window.innerHeight - triggerRect.bottom - offset - margin`.
   - Calculate available height above: `spaceAbove = triggerRect.top - offset - margin`.
   - If preferred placement starts with `bottom` and `menuHeight > spaceBelow` while `spaceAbove > spaceBelow`, flip to `top`.
   - If preferred placement starts with `top` and `menuHeight > spaceAbove` while `spaceBelow > spaceAbove`, flip to `bottom`.
   - If neither side has enough height for full `menuHeight`, set `maxHeight = Math.max(spaceBelow, spaceAbove, 120)` and enable `overflowY: 'auto'`.
3. **Horizontal Axis**:
   - Align menu `left` or `right` relative to trigger edge according to placement variant (`start`, `end`, `center`).
   - Clamp position: Ensure `left >= 8px` and `left + menuWidth <= window.innerWidth - 8px`.
4. **Events & Sync**:
   - Recalculate position on `window.addEventListener('resize')` and `window.addEventListener('scroll', ..., true)`.
   - Close dropdown on outside `mousedown` (checking both trigger and portaled menu) and `keydown` (`Escape`).

## Refactoring Plan by Module

1. **`PaneHeader.tsx`**:
   - Wrap the pane menu trigger button in `<BaseDropdown placement="bottom-end">`.
   - Remove inline `.pane-menu-dropdown` div conditional rendering.

2. **`FilesOverlay.tsx`**:
   - Wrap files menu button in `<BaseDropdown placement="bottom-end">`.

3. **`GitBranchSwitcher.tsx`**:
   - Wrap branch selection button in `<BaseDropdown placement="bottom-start">`.
   - Remove inline `.git-branch-dropdown`.

4. **`Sidebar.tsx`**:
   - Refactor Project Menu, Session Row Menu, and Footer Menu to use `BaseDropdown`.
   - Remove manual bounding rect math (`setProjectMenuPos`, `setFooterMenuPos`, `setMenuPos`).

5. **`components/chat/Dropdown.tsx` & Pickers**:
   - Refactor `Dropdown.tsx` to delegate positioning and portaling to `BaseDropdown` while maintaining existing prop signatures (`open`, `onToggle`, `onClose`, `align`, `children`).
   - Ensures `ModelPicker`, `VariantPicker`, `ModePicker`, and `AddMenu` work seamlessly without changes to their internal business logic.

## Styles & CSS
- Add base styling class `.base-dropdown-menu` to `src/renderer/src/styles.css`:
  - `position: fixed;`
  - `z-index: 9999;`
  - `box-sizing: border-box;`
- Keep all existing menu styling classes (`sidebar-menu-dropdown`, `pane-menu-dropdown`, `git-branch-dropdown`, etc.) intact for visual consistency.

## Verification Strategy
- **Unit/Integration Tests**: Run `npm test` to ensure existing tests pass.
- **Type Checking**: Run `npm run typecheck` to verify TypeScript compilation for both Node and Web targets.
- **Build**: Run `npm run build` to ensure production Vite build completes without errors.
