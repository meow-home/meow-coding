# Sidebar Header Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove "Projects" title and "Add Project" button from `Sidebar.tsx`, replacing them with a streamlined action header containing `Plus` (New session for first project) and `FolderPlus` (Add project folder) icon buttons.

**Architecture:** Update `Sidebar.tsx` header section JSX and import `FolderPlus` from `lucide-react`. Update `styles.css` for `.sidebar-header-actions`.

**Tech Stack:** React 19, TypeScript, CSS, Vitest.

## Global Constraints
- React 19 / TypeScript strict mode.
- `npm run typecheck` and `npm test` must pass after changes.

---

### Task 1: Update Sidebar Header Menu in Sidebar & Styles

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `Sidebar.tsx` import and header JSX**

Import `FolderPlus` from `lucide-react`:
```tsx
import { ChevronDown, ChevronRight, FolderPlus, MoreVertical, Plus } from 'lucide-react'
```

Replace `<div className="panel-head sidebar-head">...</div>` with:
```tsx
      <div className="sidebar-header-actions">
        <button
          className="icon-btn"
          title="New session"
          aria-label="New session"
          onClick={() => {
            if (workspaces.length > 0) {
              onNewSession(workspaces[0].projectPath)
            } else {
              void handleAddProjectDirect()
            }
          }}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <button
          className="icon-btn"
          title="Add project folder"
          aria-label="Add project folder"
          onClick={() => void handleAddProjectDirect()}
        >
          <FolderPlus size={14} aria-hidden="true" />
        </button>
      </div>
```

- [ ] **Step 2: Update `styles.css` for `.sidebar-header-actions`**

Add CSS rule for `.sidebar-header-actions`:
```css
.sidebar-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.333333rem;
  padding: 0.333333rem 0;
  border-bottom: 0.083333rem solid var(--hairline);
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): update sidebar header to icon action bar with New session and Add folder"
```

---

### Task 2: Sync Documentation

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update documentation files**

Update `docs/reference/09-ui-guide.md` and `src/renderer/src/components/AGENTS.md` to reflect the updated sidebar header with `Plus` and `FolderPlus` icon buttons.

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit documentation**

```bash
git add docs/reference/09-ui-guide.md src/renderer/src/components/AGENTS.md
git commit -m "docs: update UI guide for sidebar header action bar"
```
