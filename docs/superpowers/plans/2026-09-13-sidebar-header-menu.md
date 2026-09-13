# Sidebar Header Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `Sidebar.tsx` top header to render a 2-row vertical menu with "New session" (`Plus` icon) and "Add folder" (`FolderPlus` icon) full-width items.

**Architecture:** Update `Sidebar.tsx` header section structure to `.sidebar-header-menu` and update `styles.css` for `.sidebar-header-menu` and `.sidebar-header-item`.

**Tech Stack:** React 19, TypeScript, CSS, Vitest.

## Global Constraints
- React 19 / TypeScript strict mode.
- `npm run typecheck` and `npm test` must pass after changes.

---

### Task 1: Update Sidebar Header Menu to 2-Row Vertical Menu

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `Sidebar.tsx` header section JSX**

Replace `.sidebar-header-actions` in `Sidebar.tsx` with `.sidebar-header-menu`:
```tsx
      <div className="sidebar-header-menu">
        <button
          type="button"
          className="sidebar-header-item"
          onClick={() => {
            if (workspaces.length > 0) {
              onNewSession(workspaces[0].projectPath)
            } else {
              void handleAddProjectDirect()
            }
          }}
        >
          <Plus size={14} aria-hidden="true" />
          <span>New session</span>
        </button>
        <button
          type="button"
          className="sidebar-header-item"
          onClick={() => void handleAddProjectDirect()}
        >
          <FolderPlus size={14} aria-hidden="true" />
          <span>Add folder</span>
        </button>
      </div>
```

- [ ] **Step 2: Update `styles.css` for `.sidebar-header-menu` and `.sidebar-header-item`**

In `src/renderer/src/styles.css`, replace `.sidebar-header-actions` with:
```css
.sidebar-header-menu {
  display: flex;
  flex-direction: column;
  gap: 0.166667rem;
  padding-bottom: 0.5rem;
  border-bottom: 0.083333rem solid var(--hairline);
}
.sidebar-header-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.333333rem 0.5rem;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  cursor: pointer;
  text-align: left;
  background: transparent;
  border: none;
  font-size: var(--font-size-sm);
  font-weight: 500;
  width: 100%;
}
.sidebar-header-item:hover {
  color: var(--text-strong);
  background: var(--bg-hover);
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): update sidebar header to 2-row vertical menu items"
```

---

### Task 2: Sync Documentation

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update documentation files**

Update `docs/reference/09-ui-guide.md` and `src/renderer/src/components/AGENTS.md` to describe the vertical 2-row header menu with "New session" and "Add folder".

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit documentation**

```bash
git add docs/reference/09-ui-guide.md src/renderer/src/components/AGENTS.md
git commit -m "docs: update UI guide for 2-row vertical sidebar header menu"
```
