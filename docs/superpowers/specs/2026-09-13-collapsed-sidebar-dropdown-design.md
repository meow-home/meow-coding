# Collapsed Sidebar Popover Dropdown Design Spec

Status: approved

## 1. Overview
When the sidebar is collapsed (`sidebarCollapsed === true`), the main fixed left sidebar is hidden completely from the layout, granting 100% horizontal width to the active session workspace area. Rê chuột (hovering) over the title bar's brand area / sidebar toggle button reveals a floating full-featured sidebar popover dropdown menu directly beneath the title bar.

## 2. Goals & Non-Goals
### Goals
- Hide `.sidebar` completely (`display: none`) in main layout when collapsed.
- Display a floating full `<Sidebar>` popover dropdown attached to the top-left toggle area on hover when collapsed.
- Provide a small hover buffer delay (~150ms) so moving mouse from toggle button into popover dropdown is seamless.
- Auto-close hover popover when selecting a session or clicking outside.
- Clicking the toggle button pins/unpins the sidebar back to standard fixed layout mode.

### Non-Goals
- Changing session management, execution engines, or main chat panel rendering logic.

## 3. Detailed Architecture & Design
1. **Layout & State (`App.tsx`)**:
   - Manages `sidebarCollapsed` state.
   - When `sidebarCollapsed === true`, hides inline `<Sidebar>` in `.app-body`.
   - Renders a floating `<div className="sidebar-popover">` containing `<Sidebar collapsed={false} ... />` when hover popover is active.

2. **TitleBar Hover Interaction (`TitleBar.tsx` / `App.tsx`)**:
   - Exposes `onMouseEnterSidebarToggle` and `onMouseLeaveSidebarToggle` handlers.
   - Popover dropdown container monitors mouse enter/leave to prevent premature closing.

3. **Styling (`styles.css`)**:
   - `.sidebar.collapsed-hidden { display: none; }`
   - `.sidebar-popover`: `position: fixed; top: 2.833333rem; left: 0.833333rem; z-index: 1000; width: 22.333333rem; max-height: calc(100vh - 3.5rem); box-shadow: var(--shadow-lg); border: 0.083333rem solid var(--hairline); background: var(--bg-sidebar); border-radius: var(--radius-md); overflow: hidden;`

## 4. Verification & Testing
- Typecheck: `npm run typecheck` passes.
- Tests: `npm test` passes.
