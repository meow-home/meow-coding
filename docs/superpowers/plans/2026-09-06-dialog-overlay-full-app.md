# Overlay Dialogs Cover the Whole App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirm dialogs (delete tab / delete agent / close terminal) dim the entire app instead of just the chat/pane area.

**Architecture:** Two defensive layers fix the root cause and future-proof it. (A) Stop the `meow-rise` / `meow-pane-in` entrance animations from leaving a lingering `transform` on their containers — a filled `transform` creates a containing block that traps `position: fixed` backdrops inside the pane. (B) Render `ConfirmDialog` through a React portal into `document.body` so `position: fixed` always resolves against the viewport regardless of any ancestor.

**Tech Stack:** React 19 (`createPortal` from `react-dom`), CSS keyframes, TypeScript strict.

## Global Constraints

- CSS: `@keyframes meow-rise` currently ends at `to { transform: translateY(0) }`; `@keyframes meow-pane-in` currently ends at `to { transform: translateY(0) }`. After this change both end at `to { opacity: 1; transform: none; }`.
- `animation-fill-mode: both` keeps the final keyframe applied forever — this is the root-cause mechanism. `transform: none` does NOT establish a containing block for `position: fixed`.
- `ConfirmDialog` must continue to work with zero caller changes (`PaneTabs.tsx`, `PaneHeader.tsx`, `BackgroundPanel.tsx`).
- Keep existing behavior: Escape dismisses; clicking the backdrop dismisses (`onClick={onCancel}`); `aria-modal="true"` stays; danger styling stays.
- Do NOT change the visual appearance of the dialog itself — only where it mounts and the residual transform.
- Existing project convention: other dialogs (`AddAgentDialog.tsx`, `AddProjectDialog.tsx`, `Sidebar.tsx`) already use `createPortal` — follow that pattern.
- `src/renderer/src/styles.css` may be saved as CRLF — before editing it, verify line endings with python (`open(__file__,'rb').read().count(b'\r\n')`); use python replacement if CRLF (the edit tool won't exact-match CRLF content).
- Language: code, UI labels and docs in English. No new dependencies.

---

### Task 1: Remove the lingering transform from the entrance animations

**Files:**
- Modify: `src/renderer/src/styles.css` — `@keyframes meow-rise` and `@keyframes meow-pane-in`

**Interfaces:**
- Consumes: nothing.
- Produces: keyframes whose final computed `transform` is `none`, so `position: fixed` descendants (the `.dialog-backdrop`) resolve against the viewport.

- [ ] **Step 1: Check styles.css line endings**

Run:
```bash
python -c "d=open('src/renderer/src/styles.css','rb').read(); print('CRLF', d.count(b'\r\n'), 'LF', d.count(b'\n'))"
```
Expected: note whether `CRLF` or `LF`. Proceed to use the `edit` tool only if LF; otherwise use python replacement in Step 2/3.

- [ ] **Step 2: Change `@keyframes meow-rise` end state**

Find:
```css
@keyframes meow-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
```
Replace `to { opacity: 1; transform: translateY(0); }` with `to { opacity: 1; transform: none; }`.

- [ ] **Step 3: Change `@keyframes meow-pane-in` end state**

Find:
```css
@keyframes meow-pane-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```
Replace `to { opacity: 1; transform: translateY(0); }` with `to { opacity: 1; transform: none; }`.

- [ ] **Step 4: Verify no keyframe still ends in `translateY(0)`**

Run:
```bash
grep -n "translateY(0)" src/renderer/src/styles.css
```
Expected: no matches (all `translateY(` end states use `none`; any remaining `translateY(...)` must be in `from` blocks only).

- [ ] **Step 5: Typecheck + build**

Run:
```bash
npm run typecheck && npm run build
```
Expected: both pass with no errors. (CSS-only change; this guards that nothing else regressed.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "fix: stop entrance animations trapping fixed dialog backdrops"
```

---

### Task 2: Render `ConfirmDialog` through a portal to document.body

**Files:**
- Modify: `src/renderer/src/components/ConfirmDialog.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` props — unchanged (`title`, `message`, `confirmLabel?`, `cancelLabel?`, `danger?`, `onConfirm`, `onCancel`).
- Produces: `ConfirmDialog` now returns `createPortal(<backdrop/>, document.body)`; the exported component signature is identical, so all three callers (`PaneTabs.tsx`, `PaneHeader.tsx`, `BackgroundPanel.tsx`) keep working unchanged.

- [ ] **Step 1: Add the `createPortal` import**

At the top of `src/renderer/src/components/ConfirmDialog.tsx` (currently imports `useEffect` from `react` and `type ReactNode`):
```tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
```

- [ ] **Step 2: Wrap the returned JSX in createPortal**

Change the `return (...)` so the existing backdrop element becomes the portal child:
```tsx
  return createPortal(
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <button className="dialog-close" aria-label="Close" onClick={onCancel}>✕</button>
        <p className="settings-hint">{message}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
```
Match the existing indentation of the file. Confirm no prop names or handlers changed.

- [ ] **Step 3: Verify the final file**

Read the file; ensure:
- `import { createPortal } from 'react-dom'` is present.
- The `effect` (Escape key handler) is unchanged.
- Return statement is `return createPortal(..., document.body)`.
- No other `return` removed.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes. (Confirms `createPortal`, the JSX types, and that callers still type-check — the `Props` interface is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ConfirmDialog.tsx
git commit -m "refactor: portal confirm dialog to document.body"
```

---

### Task 3: Verify end-to-end (manual + e2e)

**Files:**
- No source changes. Test-only verification.

**Interfaces:**
- Consumes: the finished Task 1 + Task 2 changes.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 2: Run the e2e suite (smoke + dialogs)**

Run: `npm run e2e`
Expected: passes. At minimum the smoke spec launches the app without error; no dialog spec currently asserts the overlay bounds, so a pass here guards against regressions in app boot.

- [ ] **Step 3: Manual verification (if environment allows)**

Launch `npm run dev` (or the built app) and:
1. With ≥2 agents, click a tab's ✕ → Delete agent confirm. Verified: dimmed backdrop covers the **entire window** (title bar, sidebar, status bar), not just the pane.
2. In a pane header menu, delete an agent / close a terminal → confirm covers the whole window.
3. In BackgroundPanel, delete a background agent → confirm covers the whole window.
4. Press Escape and click outside the dialog box each time — both still dismiss.
5. Confirm the dialog box itself looks unchanged (same size/colors).

- [ ] **Step 4: Commit (if any manual tweaks were needed)**

If Step 3 revealed a visual regression, fix it, re-run Step 1, and commit with an explanatory message before handoff. If no changes were needed, skip this step.

---

## Self-Review

**Spec coverage:**
- Remove lingering `transform` from `meow-rise` + `meow-pane-in` → Task 1.
- Portal `ConfirmDialog` to body → Task 2.
- No caller changes required → Task 2 (props unchanged) + confirmed in plan.
- Keep Escape/backdrop/aria-modal/danger behavior → Task 2 writes no behavioral change.
- No new dependencies → Global Constraints.
- Build + typecheck + e2e verification → Task 3.

**Placeholder scan:** No TBD/TODO; each code step shows exact content.

**Type consistency:** `ConfirmDialog` props identical across Task 2 text and the existing file; `createPortal` import source (`react-dom`) matches the codebase's existing usages (`AddAgentDialog.tsx`).
