# TitleBar Controls Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set the background color of `.title-bar-controls` and `.title-bar-btn` to match the chat pane background (`var(--bg)`).

**Architecture:** Update `styles.css` rules for `.title-bar-controls` and `.title-bar-btn`.

**Tech Stack:** CSS, Vitest.

## Global Constraints
- React 19 / TypeScript strict mode.
- `npm run typecheck` and `npm test` must pass after changes.

---

### Task 1: Update TitleBar Controls CSS Background

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `.title-bar-controls` and `.title-bar-btn` in `styles.css`**

Set `background: var(--bg);` on `.title-bar-controls` and `.title-bar-btn` in `src/renderer/src/styles.css`:
```css
.title-bar-controls { display: flex; height: 100%; background: var(--bg); -webkit-app-region: no-drag; }
.title-bar-btn {
  width: 3.833333rem; height: 100%; display: flex; align-items: center; justify-content: center;
  background: var(--bg); border: none; color: var(--text); cursor: pointer; padding: 0;
  transition: background 120ms ease, color 120ms ease;
}
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): set window control buttons background to match chat pane"
```
