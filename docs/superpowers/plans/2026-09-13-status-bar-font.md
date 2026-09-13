# Status Bar Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change status bar font stack to match the sidebar's UI font stack (`var(--font-ui)`).

**Architecture:** Update `.status-bar .sb-mono` class in `src/renderer/src/styles.css` to use `font-family: var(--font-ui);` while keeping `font-variant-numeric: tabular-nums;`. Update AGENTS.md / docs as per documentation sync rules.

**Tech Stack:** React 19, CSS, Electron Vite, TypeScript.

## Global Constraints

- Source code, comments, documentation, specs and plan files must be in English.
- No `Co-Authored-By` trailer in git commit messages.
- Must run `npm run typecheck` and `npm test` after changes.

---

### Task 1: Update Status Bar Font in CSS and Verify UI

**Files:**
- Modify: `src/renderer/src/styles.css:587`
- Modify: `src/renderer/AGENTS.md`
- Modify: `docs/reference/10-ui-and-layout.md` (if reference docs describe status bar fonts)

**Interfaces:**
- Consumes: `var(--font-ui)` defined in `src/renderer/src/styles.css`
- Produces: Updated status bar font styling

- [ ] **Step 1: Edit `src/renderer/src/styles.css` to change `.status-bar .sb-mono` font family**

In `src/renderer/src/styles.css`, locate line 587:
```css
.status-bar .sb-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: #ffffff; }
```
Change `var(--font-mono)` to `var(--font-ui)`:
```css
.status-bar .sb-mono { font-family: var(--font-ui); font-variant-numeric: tabular-nums; color: #ffffff; }
```

- [ ] **Step 2: Run typecheck to verify typescript passes**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Run unit and integration tests to verify tests pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Update Documentation sync (src/renderer/AGENTS.md and docs/reference if needed)**

Check if `src/renderer/AGENTS.md` or `docs/reference/10-ui-and-layout.md` mentions status bar font family and update accordingly.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/styles.css src/renderer/AGENTS.md docs/reference/
git commit -m "style: change status bar font family to UI font stack"
```
