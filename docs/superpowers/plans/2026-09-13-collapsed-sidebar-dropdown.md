# Collapsed Sidebar Popover Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the sidebar completely when `sidebarCollapsed` is true, and show a floating full sidebar popover dropdown attached to the TitleBar brand toggle area when hovered.

**Architecture:** Update `App.tsx` to conditionally hide inline `<Sidebar>` when `sidebarCollapsed` is true, and render a floating popover overlay when hovered. Update `TitleBar.tsx` mouse handlers to drive hover popover visibility with buffer timing. Update `styles.css` for `.sidebar-popover` positioning and shadow.

**Tech Stack:** React 19, TypeScript, CSS, Vitest.

## Global Constraints
- React 19 / TypeScript strict mode.
- `-webkit-app-region: no-drag` on title bar hover triggers.
- `npm run typecheck` and `npm test` must pass after changes.

---

### Task 1: Implement Collapsed Sidebar Popover Dropdown in App & TitleBar

**Files:**
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `TitleBar.tsx` to add mouse hover handlers on brand area**

Add `onMouseEnterBrand?: () => void` and `onMouseLeaveBrand?: () => void` to `TitleBar` Props.

```tsx
interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onMouseEnterBrand?: () => void
  onMouseLeaveBrand?: () => void
}

export default function TitleBar({
  panelOpen, onTogglePanel, sidebarCollapsed, onToggleSidebar,
  onMouseEnterBrand, onMouseLeaveBrand
}: Props) {
  return (
    <div className={`title-bar title-bar-${platform}`}>
      <div
        className={`title-bar-brand ${sidebarCollapsed ? 'collapsed' : ''}`}
        onMouseEnter={onMouseEnterBrand}
        onMouseLeave={onMouseLeaveBrand}
      >
        <img src={logoMark} className="title-bar-logo" alt="" />
        {onToggleSidebar && (
          <button
            className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} aria-hidden="true" />
          </button>
        )}
      </div>
```

- [ ] **Step 2: Update `App.tsx` to handle hover popover state and render floating `<Sidebar>`**

Add state `sidebarHovered` and timeout ref to handle smooth enter/leave buffer:

```tsx
const [sidebarHovered, setSidebarHovered] = useState(false)
const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const handleMouseEnterBrand = useCallback(() => {
  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  setSidebarHovered(true)
}, [])

const handleMouseLeaveBrand = useCallback(() => {
  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  hoverTimerRef.current = setTimeout(() => {
    setSidebarHovered(false)
  }, 200)
}, [])
```

Conditionally render inline `<Sidebar>` only when `!sidebarCollapsed`.
When `sidebarCollapsed && sidebarHovered`, render floating `<div className="sidebar-popover">` on top of main content.

- [ ] **Step 3: Update `styles.css` for popover dropdown styling**

Add styles for `.sidebar-popover`:

```css
.sidebar-popover {
  position: fixed;
  top: 2.833333rem;
  left: 0.833333rem;
  z-index: 1000;
  width: 22.333333rem;
  max-height: calc(100vh - 4rem);
  background: var(--bg-sidebar);
  border: 0.083333rem solid var(--hairline);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.4);
  border-radius: var(--radius-sm);
  display: flex; flex-direction: column;
  overflow: hidden;
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ui): hide sidebar when collapsed and show popover dropdown on titlebar hover"
```

---

### Task 2: Sync Documentation

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update documentation files**

Update `docs/reference/09-ui-guide.md` and `src/renderer/src/components/AGENTS.md` to reflect that collapsed sidebar is completely hidden from standard layout, and hovered from title bar brand region as a floating popover.

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit documentation**

```bash
git add docs/reference/09-ui-guide.md src/renderer/src/components/AGENTS.md
git commit -m "docs: update UI guide for collapsed sidebar popover dropdown"
```
