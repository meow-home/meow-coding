# Row-First Multi-Panel Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the dynamic grid layout in `src/renderer/src/App.tsx` from column-first to row-first so multi-panel views (Files, Processes, Subagents) stack vertically (Top/Bottom) when 2 panels are open.

**Architecture:** Modify `rows` and `cols` calculation in `App.tsx` render function to `rows = Math.ceil(Math.sqrt(totalCount))` and `cols = Math.ceil(totalCount / rows)`.

**Tech Stack:** React 19, TypeScript, Vitest.

## Global Constraints

- Must maintain strict TypeScript checking (`npm run typecheck`).
- Must pass unit tests (`npm test`).

---

### Task 1: Update Grid Formula in App.tsx to Row-First Priority

**Files:**
- Modify: `src/renderer/src/App.tsx:750-760`

- [ ] **Step 1: Update grid rows and cols formulas in App.tsx**

Change `cols` and `rows` calculation inside `<main>` render block in `src/renderer/src/App.tsx`:
```tsx
const rows = Math.ceil(Math.sqrt(totalCount))
const cols = Math.ceil(totalCount / (rows || 1))
```

- [ ] **Step 2: Run typecheck to verify TypeScript compilation**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Run unit tests**

Run: `npm test`
Expected: PASS (all tests pass).

- [ ] **Step 4: Commit changes**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(ui): update right-side multi-panel layout to prioritize row-first grid"
```
