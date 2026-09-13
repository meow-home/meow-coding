# Windows Overlay Color Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OS-drawn Windows caption buttons (`titleBarOverlay`) use the same color as the title bar
surface the renderer paints next to them, and guard against the two drifting apart again.

**Architecture:** `TITLE_BAR_COLORS` in `src/main/window-chrome.ts` is aligned to `.title-bar-right`'s
`var(--bg)`; a unit test parses `styles.css` and asserts the invariant.

**Tech Stack:** TypeScript, Vitest, CSS.

## Global Constraints
- React 19 / TypeScript strict mode.
- `npm run typecheck` and `npm test` must pass after changes.
- The CSS rules that style the caption buttons are Linux-only — never try to fix this in `styles.css`.

---

### Task 1: Guard test for the overlay/surface invariant (RED)

**Files:**
- Modify: `tests/unit/window-chrome.test.ts`

- [ ] **Step 1: Add the invariant test**

Parse `src/renderer/src/styles.css` (strip comments, match `selector { body }`), find the `.title-bar-right`
rule whose body has `background: var(--token)`, resolve that token in `:root` and in `[data-theme="light"]`,
and assert the Windows overlay color equals each (via `getWindowChromeOptions('win32')` for the creation-time
color and `applyTitleBarTheme` for the toggle).

- [ ] **Step 2: Watch it fail**

Run: `npx vitest run tests/unit/window-chrome.test.ts`
Expected: FAIL — the test resolves `#0a0a0b` / `#ffffff` from the stylesheet, the overlay reports `#0f0f11` /
`#f3f3f3`.

### Task 2: Align the constants (GREEN)

**Files:**
- Modify: `src/main/window-chrome.ts`
- Modify: `tests/unit/window-chrome.test.ts` (the two expectations holding the stale hexes)

- [ ] **Step 1: Update `TITLE_BAR_COLORS`**

`dark: { color: '#0a0a0b', symbolColor: '#ffffff' }`, `light: { color: '#ffffff', symbolColor: '#1e1e1e' }`,
and replace the stale `--bg-panel` comment with the `--bg` invariant.

- [ ] **Step 2: Run the suite**

Run: `npx vitest run tests/unit/window-chrome.test.ts && npm run typecheck && npm test`
Expected: PASS.

### Task 3: Verify on a real window and document

- [ ] **Step 1: Pixel check (both themes)**

Run an isolated instance (`env -u ELECTRON_RENDERER_URL MEOW_USER_DATA=<temp> electron . --remote-debugging-port=9223`),
switch the theme through CDP, and compare the caption strip's most common color with the app title bar's in a
screen capture. Expected: max channel difference ≤ 2 in both themes (was 11 in light).

- [ ] **Step 2: Docs**

Update `docs/reference/11-conventions-and-pitfalls.md` (the Windows title-bar overlay pitfall row) and
`src/main/AGENTS.md` (`window-chrome.ts` bullet).

- [ ] **Step 3: Commit**

```bash
git add src/main/window-chrome.ts tests/unit/window-chrome.test.ts src/main/AGENTS.md \
  docs/reference/11-conventions-and-pitfalls.md docs/superpowers/specs/2026-09-13-windows-overlay-color-sync-design.md \
  docs/superpowers/plans/2026-09-13-windows-overlay-color-sync.md
git commit -m "fix(ui): sync Windows caption-button overlay color with the title bar surface"
```
