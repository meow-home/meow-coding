# Seamless TitleBar & Sidebar Integration Design Spec

Status: approved

## 1. Overview
This specification details the visual and structural integration connecting the app's top `TitleBar` with the `Sidebar` and main content layout. The top-left region of the `TitleBar` (`.title-bar-brand`, which houses the logo mark and sidebar collapse/expand toggle button) will match the exact width, background color, and right border of the `Sidebar`, creating a continuous vertical column from the top edge of the window down to the status bar.

## 2. Goals & Non-Goals
### Goals
- Unify the top-left title bar region (`.title-bar-brand`) with `.sidebar` so they form a single seamless visual panel.
- Ensure the right border (`border-right`) of `.title-bar-brand` extends continuously into `.sidebar`'s `border-right`.
- Dynamically match `.title-bar-brand`'s width with the collapsed (`4.333333rem`) and expanded (`22.333333rem`) states of the sidebar.
- Maintain window dragging (`-webkit-app-region: drag`) across title bar drag regions while keeping interactive controls (`-webkit-app-region: no-drag`) responsive.

### Non-Goals
- Altering title bar window control icons (minimize, maximize, close on Linux/Windows).
- Modifying session list, chat panels, or right panel layout behavior.

## 3. Detailed Architecture & Design
1. **TitleBar Component (`TitleBar.tsx`)**:
   - Accepts `sidebarCollapsed: boolean` prop.
   - Applies `.collapsed` CSS class to `.title-bar-brand` when `sidebarCollapsed` is true.

2. **CSS Layout (`styles.css`)**:
   - Remove global `border-bottom` from `.title-bar`.
   - Apply `background: var(--bg-sidebar)` and `border-right: 0.083333rem solid var(--hairline)` to `.title-bar-brand`.
   - Set `.title-bar-brand` width to `22.333333rem` (expanded) and `4.333333rem` (when `.title-bar-brand.collapsed`).
   - Add horizontal `border-bottom: 0.083333rem solid var(--hairline)` to `.title-bar-right` so the main content region retains its header boundary.

## 4. Verification & Testing
- Run `npm run typecheck` to verify TypeScript contracts.
- Run `npm test` to ensure existing unit tests pass without regressions.
