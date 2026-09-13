# Seamless TitleBar & Sidebar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seamlessly integrate the app's `TitleBar` with the `Sidebar` by giving `.title-bar-brand` the exact width, background color, and right border of the `Sidebar`.

**Architecture:** Update `TitleBar.tsx` to apply `.collapsed` class to `.title-bar-brand` when `sidebarCollapsed` is true. Update `styles.css` to set `.title-bar-brand` background to `var(--bg-sidebar)` with a right border matching `.sidebar`, while giving `.title-bar-right` the horizontal bottom border across the main content area.

**Tech Stack:** React 19, TypeScript, CSS (VSCode Dark+ design system), Vitest.

## Global Constraints
- React 19 / TypeScript strict mode.
- Non-drag exceptions (`-webkit-app-region: no-drag`) on clickable TitleBar elements.
- `npm run typecheck` and `npm test` must pass after changes.

---

### Task 1: Update TitleBar component and CSS layout for seamless sidebar connection

**Files:**
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `sidebarCollapsed` prop in `TitleBar.tsx`.
- Produces: Seamless top-left sidebar brand section in `TitleBar`.

- [ ] **Step 1: Modify `TitleBar.tsx` to pass `.collapsed` class to `.title-bar-brand`**

```tsx
<div className={`title-bar-brand ${sidebarCollapsed ? 'collapsed' : ''}`}>
```

- [ ] **Step 2: Update `styles.css` to format `.title-bar-brand` and `.title-bar-right`**

```css
.title-bar {
  height: 2.833333rem; flex: 0 0 2.833333rem; display: flex; align-items: center; justify-content: space-between;
  background: transparent;
  border-radius: 0;
  -webkit-app-region: drag; user-select: none;
}
.title-bar-brand {
  display: flex; align-items: center; gap: 0.666667rem; padding-left: 1rem; min-width: 0;
  height: 100%; width: 22.333333rem; flex: 0 0 auto;
  background: var(--bg-sidebar); border-right: 0.083333rem solid var(--hairline);
  box-sizing: border-border;
}
.title-bar-brand.collapsed {
  width: 4.333333rem; padding-left: 0.833333rem;
}
.title-bar-right {
  display: flex; align-items: center; justify-content: flex-end; height: 100%; flex: 1; min-width: 0;
  background: var(--bg-panel); border-bottom: 0.083333rem solid var(--hairline);
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/styles.css
git commit -m "feat(ui): seamlessly connect titlebar brand section with sidebar"
```

---

### Task 2: Sync Documentation

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update documentation files to record the seamless title bar layout changes**

Update `docs/reference/09-ui-guide.md` and `src/renderer/src/components/AGENTS.md` to note that `.title-bar-brand` dynamically matches `.sidebar`'s width and background color to form a unified left column.

- [ ] **Step 2: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit documentation**

```bash
git add docs/reference/09-ui-guide.md src/renderer/src/components/AGENTS.md
git commit -m "docs: update UI guide and AGENTS.md for seamless titlebar-sidebar layout"
```
