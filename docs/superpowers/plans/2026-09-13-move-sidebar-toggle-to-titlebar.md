# Move Sidebar Toggle to TitleBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the app label in the title bar and move the left sidebar expand/collapse button (`PanelLeft`) up into the title bar next to the app logo icon.

**Architecture:** Lift `sidebarCollapsed` state control to `App.tsx` (persisted in `localStorage`), pass state and toggle callback to `TitleBar.tsx`, place the `<button className="sidebar-toggle">` inside `.title-bar-brand` (with `-webkit-app-region: no-drag`), and remove the old toggle button from `Sidebar.tsx`.

**Tech Stack:** React 19, TypeScript, CSS

## Global Constraints

- Hide text label `Meow Coding` from title bar.
- Move sidebar expand/collapse toggle button into `TitleBar` left brand region next to logo icon.
- Ensure title bar button has `-webkit-app-region: no-drag` so clicking works in Electron window header.
- All unit tests (`npm test`) and typechecks (`npm run typecheck`) must pass.

---

### Task 1: Lift `sidebarCollapsed` state to `App.tsx`, update `TitleBar.tsx`, `Sidebar.tsx`, and `styles.css`

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `src/renderer/src/App.tsx`**

In `src/renderer/src/App.tsx`:
- Add state: `const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('meow.sidebar.collapsed') === '1')`
- Add effect:
```typescript
  useEffect(() => {
    localStorage.setItem('meow.sidebar.collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])
```
- Pass to `<TitleBar>`: `sidebarCollapsed={sidebarCollapsed}` and `onToggleSidebar={() => setSidebarCollapsed(v => !v)}`.
- Pass to `<Sidebar>`: `collapsed={sidebarCollapsed}` (remove internal `collapsed` state in Sidebar).

- [ ] **Step 2: Update `src/renderer/src/components/TitleBar.tsx`**

In `src/renderer/src/components/TitleBar.tsx`:
- Import `PanelLeft` from `'lucide-react'`.
- Update `Props` interface to include `sidebarCollapsed: boolean` and `onToggleSidebar: () => void`.
- Remove `<span className="title-bar-title">Meow Coding</span>`.
- In `.title-bar-brand`, render:
```tsx
      <div className="title-bar-brand">
        <img src={logoMark} className="title-bar-logo" alt="" />
        <button
          className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={14} aria-hidden="true" />
        </button>
      </div>
```

- [ ] **Step 3: Update `src/renderer/src/components/Sidebar.tsx`**

In `src/renderer/src/components/Sidebar.tsx`:
- Add `collapsed: boolean` to `Props` interface.
- Remove internal `collapsed` state and its `useEffect` saving to `localStorage`.
- Remove `<button className="sidebar-toggle ...">` from `.sidebar-head`.

- [ ] **Step 4: Update `src/renderer/src/styles.css`**

In `src/renderer/src/styles.css`:
- Ensure `.title-bar-brand .sidebar-toggle` has `-webkit-app-region: no-drag` so it receives mouse click events inside Electron title bar.

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TitleBar.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): move left sidebar toggle to title bar and hide title label"
```
