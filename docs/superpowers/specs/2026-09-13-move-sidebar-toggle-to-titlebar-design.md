# Move Sidebar Toggle to TitleBar Design

## Context & Motivation
In the desktop application UI, the window title bar (`TitleBar.tsx`) currently displays an app logo icon and a text label ("Meow Coding") on the left, while the left sidebar expand/collapse button (`PanelLeft` icon) is located inside the sidebar header (`Sidebar.tsx`).
To make the top window bar more compact and provide easy access to sidebar toggling, the text label will be hidden, leaving only the logo icon, and the sidebar toggle button will be moved into the title bar next to the logo icon.

## Goal
1. Remove the "Meow Coding" text label from the left side of `TitleBar.tsx`.
2. Move the left sidebar expand/collapse button (`PanelLeft` icon) into `TitleBar.tsx` next to the logo icon.
3. Remove the collapse button from `Sidebar.tsx` header.
4. Lift `sidebarCollapsed` state control to `App.tsx` so both `TitleBar` and `Sidebar` share it.

## Changes

### 1. `src/renderer/src/App.tsx`
- Add `sidebarCollapsed` state: `const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')`.
- Save `sidebarCollapsed` to `localStorage` on change.
- Pass `sidebarCollapsed` and `onToggleSidebar={() => setSidebarCollapsed(v => !v)}` to `<TitleBar>`.
- Pass `collapsed={sidebarCollapsed}` prop to `<Sidebar>`.

### 2. `src/renderer/src/components/TitleBar.tsx`
- Accept `sidebarCollapsed: boolean` and `onToggleSidebar: () => void` in props.
- Remove `<span className="title-bar-title">Meow Coding</span>`.
- Add `<button className="sidebar-toggle ...">` inside `.title-bar-brand` next to `<img className="title-bar-logo">`.

### 3. `src/renderer/src/components/Sidebar.tsx`
- Receive `collapsed: boolean` as prop from `App.tsx` (remove internal `collapsed` state).
- Remove the `sidebar-toggle` button from `.sidebar-head`.

### 4. `src/renderer/src/styles.css`
- Ensure `.title-bar-brand .sidebar-toggle` has `-webkit-app-region: no-drag` and proper spacing.
