# BaseDropdown Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified, intelligent `BaseDropdown` popover component portaled to `document.body` with auto-flip, auto-shift/clamp, and auto max-height capabilities, and refactor all existing dropdowns and action menus to use it.

**Architecture:** Build `src/renderer/src/components/common/BaseDropdown.tsx` using React DOM portals and viewport geometry measurements (`getBoundingClientRect`). Refactor existing dropdown usages across `PaneHeader`, `FilesOverlay`, `GitBranchSwitcher`, `Sidebar`, and `Dropdown` (chat pickers) to consume `BaseDropdown`.

**Tech Stack:** React 19, TypeScript, ReactDOM (createPortal), Vitest.

## Global Constraints

- **Single responsibility:** `BaseDropdown` handles positioning, event listeners, portal rendering, and visibility state.
- **Portaling:** Always render popover contents to `document.body` fixed layer.
- **No breaking changes:** Keep all existing menu CSS classes (`sidebar-menu-dropdown`, `pane-menu-dropdown`, `git-branch-dropdown`, etc.) working seamlessly.
- **Documentation Sync:** Update `src/renderer/AGENTS.md` and related docs after code changes.

---

### Task 1: Create `BaseDropdown` Component & Styles

**Files:**
- Create: `src/renderer/src/components/common/BaseDropdown.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/unit/base-dropdown.test.ts`

**Interfaces:**
- Produces: `BaseDropdown`, `DropdownPlacement`, `BaseDropdownProps`

- [ ] **Step 1: Write unit tests for layout calculation logic in `BaseDropdown`**

Create `tests/unit/base-dropdown.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { computeDropdownPosition } from '../../src/renderer/src/components/common/BaseDropdown'

describe('computeDropdownPosition', () => {
  const windowBounds = { width: 1000, height: 800 }
  const triggerRect = { top: 700, bottom: 730, left: 500, right: 600, width: 100, height: 30 }
  const menuRect = { width: 200, height: 300 }

  test('flips from bottom to top when space below is insufficient', () => {
    const pos = computeDropdownPosition({
      triggerRect,
      menuRect,
      windowBounds,
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.top).toBeUndefined()
    expect(pos.bottom).toBe(800 - triggerRect.top + 4) // 800 - 700 + 4 = 104
  })

  test('clamps horizontal position within screen margin when overflowing right', () => {
    const edgeTriggerRect = { top: 100, bottom: 130, left: 850, right: 980, width: 130, height: 30 }
    const pos = computeDropdownPosition({
      triggerRect: edgeTriggerRect,
      menuRect,
      windowBounds,
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.left).toBeLessThanOrEqual(windowBounds.width - menuRect.width - 8)
  })

  test('applies maxHeight and overflowY when space is restricted on both sides', () => {
    const tightTriggerRect = { top: 100, bottom: 130, left: 100, right: 200, width: 100, height: 30 }
    const pos = computeDropdownPosition({
      triggerRect: tightTriggerRect,
      menuRect: { width: 200, height: 900 },
      windowBounds: { width: 1000, height: 300 },
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.maxHeight).toBeDefined()
    expect(pos.overflowY).toBe('auto')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test tests/unit/base-dropdown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `BaseDropdown.tsx` and positioning helper function**

Create `src/renderer/src/components/common/BaseDropdown.tsx`:

```typescript
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  trigger: ReactNode | ((props: { open: boolean; toggle: () => void }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: DropdownPlacement
  offset?: number
  menuClassName?: string
  menuStyle?: CSSProperties
  children: ReactNode
  closeOnOutsideClick?: boolean
  closeOnEscape?: boolean
}

export function computeDropdownPosition({
  triggerRect,
  menuRect,
  windowBounds,
  placement = 'bottom-start',
  offset = 4
}: {
  triggerRect: { top: number; bottom: number; left: number; right: number; width: number; height: number }
  menuRect: { width: number; height: number }
  windowBounds: { width: number; height: number }
  placement?: DropdownPlacement
  offset?: number
}): CSSProperties {
  const margin = 8
  const spaceBelow = windowBounds.height - triggerRect.bottom - offset - margin
  const spaceAbove = triggerRect.top - offset - margin

  let verticalDir: 'bottom' | 'top' = placement.startsWith('top') ? 'top' : 'bottom'

  if (verticalDir === 'bottom' && menuRect.height > spaceBelow && spaceAbove > spaceBelow) {
    verticalDir = 'top'
  } else if (verticalDir === 'top' && menuRect.height > spaceAbove && spaceBelow > spaceAbove) {
    verticalDir = 'bottom'
  }

  const resultStyle: CSSProperties = { position: 'fixed', zIndex: 9999 }

  if (verticalDir === 'top') {
    resultStyle.bottom = windowBounds.height - triggerRect.top + offset
  } else {
    resultStyle.top = triggerRect.bottom + offset
  }

  let maxAvail = verticalDir === 'top' ? spaceAbove : spaceBelow
  if (menuRect.height > maxAvail && maxAvail > 0) {
    resultStyle.maxHeight = Math.max(maxAvail, 120)
    resultStyle.overflowY = 'auto'
  }

  if (placement.endsWith('end')) {
    const calculatedRight = windowBounds.width - triggerRect.right
    const clampRight = Math.max(margin, Math.min(calculatedRight, windowBounds.width - menuRect.width - margin))
    resultStyle.right = clampRight
    resultStyle.left = 'auto'
  } else if (placement.endsWith('center')) {
    const triggerCenter = triggerRect.left + triggerRect.width / 2
    let calculatedLeft = triggerCenter - menuRect.width / 2
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  } else {
    let calculatedLeft = triggerRect.left
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  }

  return resultStyle
}

export default function BaseDropdown({
  trigger,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  offset = 4,
  menuClassName = '',
  menuStyle = {},
  children,
  closeOnOutsideClick = true,
  closeOnEscape = true
}: BaseDropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)

  const toggle = () => {
    const next = !isOpen
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const close = () => {
    if (!isControlled) setUncontrolledOpen(false)
    onOpenChange?.(false)
  }

  useLayoutEffect(() => {
    if (!isOpen) return
    const updatePosition = () => {
      if (!triggerRef.current || !menuRef.current) return
      const tRect = triggerRef.current.getBoundingClientRect()
      const mRect = menuRef.current.getBoundingClientRect()
      const calculated = computeDropdownPosition({
        triggerRect: tRect,
        menuRect: mRect,
        windowBounds: { width: window.innerWidth, height: window.innerHeight },
        placement,
        offset
      })
      setPos(calculated)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, placement, offset])

  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!closeOnOutsideClick) return
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, closeOnOutsideClick, closeOnEscape])

  return (
    <div className="base-dropdown-container" ref={triggerRef} style={{ display: 'inline-flex' }}>
      {typeof trigger === 'function' ? trigger({ open: isOpen, toggle }) : (
        <div onClick={toggle} style={{ display: 'inline-flex', cursor: 'pointer' }}>
          {trigger}
        </div>
      )}

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className={`base-dropdown-menu ${menuClassName}`}
          style={{ ...pos, ...menuStyle }}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  )
}
```

Add CSS rule to `src/renderer/src/styles.css`:

```css
.base-dropdown-container {
  position: relative;
  display: inline-flex;
}

.base-dropdown-menu {
  position: fixed;
  z-index: 9999;
  box-sizing: border-box;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/unit/base-dropdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/common/BaseDropdown.tsx src/renderer/src/styles.css tests/unit/base-dropdown.test.ts
git commit -m "feat: add BaseDropdown component with smart positioning"
```

---

### Task 2: Refactor `Dropdown.tsx` (Chat Pickers) to delegate to `BaseDropdown`

**Files:**
- Modify: `src/renderer/src/components/chat/Dropdown.tsx`

**Interfaces:**
- Consumes: `BaseDropdown` from `src/renderer/src/components/common/BaseDropdown.tsx`
- Produces: Backward compatible `Dropdown` component for `ModelPicker`, `VariantPicker`, `ModePicker`, `AddMenu`.

- [ ] **Step 1: Update `src/renderer/src/components/chat/Dropdown.tsx`**

Replace `Dropdown.tsx` implementation to use `BaseDropdown`:

```typescript
import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import BaseDropdown from '../common/BaseDropdown'

interface DropdownProps {
  trigger: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  ariaLabel?: string
  menuClassName?: string
  align?: 'left' | 'right'
  children: ReactNode
}

export default function Dropdown({
  trigger, open, onToggle, onClose, title, ariaLabel, menuClassName = '', align = 'right', children
}: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <BaseDropdown
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) {
          if (nextOpen) onToggle()
          else onClose()
        }
      }}
      placement={align === 'left' ? 'top-start' : 'top-end'}
      menuClassName={`dropdown-menu ${menuClassName}`}
      trigger={(
        <button
          ref={triggerRef}
          className="dropdown-trigger"
          title={title}
          aria-label={ariaLabel ?? title}
          aria-expanded={open}
          onClick={onToggle}
        >
          {trigger}
          <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
        </button>
      )}
    >
      {children}
    </BaseDropdown>
  )
}
```

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/chat/Dropdown.tsx
git commit -m "refactor: delegate chat Dropdown component to BaseDropdown"
```

---

### Task 3: Refactor `PaneHeader` menu to use `BaseDropdown`

**Files:**
- Modify: `src/renderer/src/components/PaneHeader.tsx`

- [ ] **Step 1: Update `PaneHeader.tsx`**

Import `BaseDropdown` and replace inline `.pane-menu-dropdown` logic.

```typescript
import BaseDropdown from './common/BaseDropdown'
```

Replace the `.pane-menu` section:

```typescript
        <BaseDropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
          menuClassName="sidebar-menu-dropdown pane-menu-dropdown"
          trigger={(
            <button
              className="icon-btn"
              title="Pane menu"
              aria-label={`menu ${name}`}
              onClick={() => setMenuOpen(v => !v)}
            >
              <MoreVertical size={14} aria-hidden="true" />
            </button>
          )}
        >
          {background ? (
            <button className="menu-item" onClick={() => { close(); onToggleBackground?.() }}>
              <Layers size={16} aria-hidden="true" />
              Focus window
            </button>
          ) : (
            <button className="menu-item" onClick={() => { close(); onToggleBackground?.() }}>
              <Layers size={16} aria-hidden="true" />
              Send to background
            </button>
          )}
          {onOpenFiles && (
            <button className="menu-item" onClick={() => { close(); onOpenFiles() }}>
              <FolderTree size={16} aria-hidden="true" />
              Files tab
            </button>
          )}
          <button className="menu-item" onClick={() => { close(); setInjecting(v => !v) }}>
            <Play size={16} aria-hidden="true" />
            Inject prompt
          </button>
          <button className="menu-item" onClick={() => { close(); onOpenLog() }}>
            <FileText size={16} aria-hidden="true" />
            View log
          </button>
          <div className="menu-sep" aria-hidden="true" />
          {state.status === 'running' ? (
            <button className="menu-item" onClick={() => { close(); onStop() }}>
              <Square size={16} aria-hidden="true" />
              Stop agent
            </button>
          ) : (
            <button className="menu-item" onClick={() => { close(); onRestart() }}>
              <RotateCw size={16} aria-hidden="true" />
              Restart agent
            </button>
          )}
          <div className="menu-sep" aria-hidden="true" />
          <button className="menu-item danger" onClick={() => { close(); setConfirmRemove(true) }}>
            <Trash2 size={16} aria-hidden="true" />
            {native ? 'Delete agent' : 'Remove pane'}
          </button>
        </BaseDropdown>
```

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/PaneHeader.tsx
git commit -m "refactor: update PaneHeader menu to use BaseDropdown"
```

---

### Task 4: Refactor `FilesOverlay` menu to use `BaseDropdown`

**Files:**
- Modify: `src/renderer/src/components/files/FilesOverlay.tsx`

- [ ] **Step 1: Update `FilesOverlay.tsx`**

Import `BaseDropdown` and replace inline `.files-menu-dropdown` logic.

```typescript
import BaseDropdown from '../common/BaseDropdown'
```

Replace the `.pane-menu` block inside `FilesOverlay`:

```typescript
          <BaseDropdown
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
            menuClassName="sidebar-menu-dropdown pane-menu-dropdown files-menu-dropdown"
            trigger={(
              <button
                className="icon-btn"
                title="Files menu"
                aria-label="Files menu"
                onClick={() => setMenuOpen(v => !v)}
              >
                <EllipsisVertical size={14} aria-hidden="true" />
              </button>
            )}
          >
            <button className="menu-item" onClick={() => { setMenuOpen(false); setReloadToken(v => v + 1) }}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
            <button className="menu-item" onClick={() => { setMenuOpen(false); setCollapseToken(v => v + 1) }}>
              <ListCollapse size={16} aria-hidden="true" />
              Collapse all
            </button>
            <button
              className="menu-item"
              disabled={tabs.length === 0}
              onClick={() => { setMenuOpen(false); setTabs([]); setActiveTab(null) }}
            >
              <CircleX size={16} aria-hidden="true" />
              Close all tabs
            </button>
            <div className="menu-sep" aria-hidden="true" />
            <button
              className="menu-item"
              disabled={!activeTab || activeTab.kind !== 'file'}
              onClick={() => {
                if (activeTab && activeTab.kind === 'file') {
                  setMenuOpen(false)
                  setTabHistory(prev => {
                    const next = prev.filter(t => t.id !== activeTab.id)
                    setActiveTab(next.length > 0 ? next[next.length - 1] : null)
                    return next
                  })
                }
              }}
            >
              <FileCode size={16} aria-hidden="true" />
              Close active tab
            </button>
          </BaseDropdown>
```

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/files/FilesOverlay.tsx
git commit -m "refactor: update FilesOverlay menu to use BaseDropdown"
```

---

### Task 5: Refactor `GitBranchSwitcher` to use `BaseDropdown`

**Files:**
- Modify: `src/renderer/src/components/git/GitBranchSwitcher.tsx`

- [ ] **Step 1: Update `GitBranchSwitcher.tsx`**

Import `BaseDropdown` and replace inline `.git-branch-dropdown` block:

```typescript
import BaseDropdown from '../common/BaseDropdown'
```

Replace render content:

```typescript
  return (
    <div className="git-branch-wrap">
      <BaseDropdown
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        menuClassName="git-branch-dropdown"
        trigger={(
          <button
            className="git-branch-current"
            disabled={busy}
            onClick={() => setOpen(v => !v)}
            title="Switch branch"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <GitBranch size={14} aria-hidden="true" />
            <span>{current ?? '(detached)'}</span>
            <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
          </button>
        )}
      >
        <div className="git-branch-section">Local</div>
        {locals.map(b => (
          <button
            key={b.name}
            className={`git-branch-item ${b.name === current ? 'active' : ''}`}
            disabled={busy}
            onClick={() => { setOpen(false); onSwitch(b.name) }}
          >
            <span className="menu-item-label">{b.name}</span>
            <span className="menu-item-check">
              {b.name === current && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
        <div className="git-branch-section">Remote</div>
        {remotes.length === 0 && <div className="git-branch-empty">No remote branches</div>}
        {remotes.map(b => (
          <button
            key={b.name}
            className={`git-branch-item ${b.name === current ? 'active' : ''}`}
            disabled={busy}
            onClick={() => { setOpen(false); onSwitch(b.name) }}
          >
            <span className="menu-item-label">{b.name}</span>
            <span className="menu-item-check">
              {b.name === current && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
        <div className="git-branch-section">New Branch</div>
        <div className="git-branch-create" onClick={e => e.stopPropagation()}>
          <input
            className="input input-sm git-branch-input"
            placeholder="new-branch-name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void createBranch()
            }}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={!newName.trim() || busy}
            onClick={() => void createBranch()}
          >
            Create
          </button>
        </div>
      </BaseDropdown>
    </div>
  )
```

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/git/GitBranchSwitcher.tsx
git commit -m "refactor: update GitBranchSwitcher dropdown to use BaseDropdown"
```

---

### Task 6: Refactor `Sidebar` menus (Project, Session, Footer) to use `BaseDropdown`

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Step 1: Update `Sidebar.tsx`**

Import `BaseDropdown`. Remove state variables `projectMenuPos`, `footerMenuPos` and manual bounding rect calculations.

Replace Project Menu trigger & portal with:

```typescript
                <BaseDropdown
                  open={openProjectMenu === ws.projectPath}
                  onOpenChange={(open) => setOpenProjectMenu(open ? ws.projectPath : null)}
                  placement="bottom-start"
                  menuClassName="sidebar-menu-dropdown project-menu-dropdown"
                  trigger={(
                    <button
                      className="icon-btn project-menu-btn"
                      title="Project menu"
                      aria-label={`menu ${ws.name}`}
                      onClick={() => setOpenProjectMenu(p => (p === ws.projectPath ? null : ws.projectPath))}
                    >
                      <MoreIcon />
                    </button>
                  )}
                >
                  <span className="menu-head" title={ws.projectPath}>{ws.projectPath}</span>
                  <button className="menu-item" onClick={() => { setOpenProjectMenu(null); onOpen(ws.projectPath) }}>
                    <FolderOpen size={16} aria-hidden="true" />
                    Open
                  </button>
                  <button className="menu-item" onClick={() => { setOpenProjectMenu(null); void window.api.openInEditor(ws.projectPath) }}>
                    <Code size={16} aria-hidden="true" />
                    Open in VS Code
                  </button>
                  <button className="menu-item" onClick={() => { setOpenProjectMenu(null); onOpenGit(ws.projectPath) }}>
                    <GitBranch size={16} aria-hidden="true" />
                    Git
                  </button>
                  <button className="menu-item" onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}>
                    <FolderSymlink size={16} aria-hidden="true" />
                    Open Folder
                  </button>
                  <button className="menu-item" onClick={() => { setOpenProjectMenu(null); void window.api.openSystemTerminal(ws.projectPath) }}>
                    <Terminal size={16} aria-hidden="true" />
                    Open Terminal
                  </button>
                  <div className="menu-sep" aria-hidden="true" />
                  <button className="menu-item danger" onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}>
                    <Trash2 size={16} aria-hidden="true" />
                    Remove from sidebar
                  </button>
                </BaseDropdown>
```

Replace Session Row Menu (`SessionRow` component inside `Sidebar.tsx`) trigger & portal with `BaseDropdown placement="bottom-end"`.

Replace Sidebar Footer Menu trigger & portal with `BaseDropdown placement="top-start"`.

- [ ] **Step 2: Run typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx
git commit -m "refactor: update Sidebar project, session, and footer menus to use BaseDropdown"
```

---

### Task 7: Full System Verification & AGENTS.md Sync

**Files:**
- Modify: `src/renderer/AGENTS.md` (if needed to reflect BaseDropdown in components)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 2: Run test suite**

Run: `npm test`
Expected: All unit + integration tests PASS.

- [ ] **Step 3: Update `src/renderer/AGENTS.md`**

Update `src/renderer/AGENTS.md` according to the documentation sync rule in `AGENTS.md`.

- [ ] **Step 4: Final commit**

```bash
git add src/renderer/AGENTS.md
git commit -m "docs: update renderer AGENTS.md for BaseDropdown component"
```
