# Overlay Dialog Covers the Whole App — Design

**Date:** 2026-09-06
**Status:** Approved design, awaiting spec review

## Problem

The confirm dialogs (delete agent tab, delete agent / close terminal in the pane
header, delete a background agent) only cover the chat/pane area instead of the
entire app. The dimmed backdrop stops at the pane bounds, so the popup feels
scoped to the chat panel rather than modal over the whole window.

## Root Cause

`ConfirmDialog` renders `.dialog-backdrop { position: fixed; inset: 0; z-index:
100 }`, which is designed to cover the viewport. However, each dialog is
rendered inside a pane container that carries an entrance animation:

- `PaneTabs.tsx` → `.agent-tabs-view` has
  `animation: meow-rise 300ms 120ms ease-out both`.
- `PaneHeader.tsx` and `BackgroundPanel.tsx` sit in the same transformed-tree
  region (pane / background panel also inside animated containers).

`@keyframes meow-rise` ends at `to { transform: translateY(0) }`, and
`animation-fill-mode: both` keeps that final frame applied forever. A `transform`
on an ancestor creates a **containing block for `position: fixed` descendants**,
so the backdrop's `fixed; inset:0` is trapped to the pane container instead of
the viewport — which is exactly why the overlay only covers the chat/pane area.

## Fix

Two complementary changes.

### A. Remove the lingering transform from `meow-rise`

The entrance animation only needs a fade + a small upward slide. After it
finishes it should leave **no layout-affecting property**. Change the keyframe
end state so the final computed `transform` is neutral:

```css
@keyframes meow-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }        /* was translateY(0) */
}
```

`transform: none` does not establish a containing block for `position: fixed`,
so backdrops inside these containers resolve against the real viewport again.

Affected rules (all use `meow-rise`): `.title-bar`, `.sidebar`, `.status-bar`,
`.pane:nth-child(1/2)` (via `meow-pane-in`), `.agent-tabs-view`, and the rule at
line ~1896. `meow-pane-in` already animates to `translateY(0)` too — update its
end state to `transform: none` for the same reason.

### B. Render `ConfirmDialog` through a portal

Defense in depth against the trap recurring with any future ancestor
(`transform`, `filter`, `perspective`, `will-change`). Render the dialog into a
portal whose host lives at the root of the document body, so `position: fixed`
always covers the viewport regardless of where it is composed.

- `ConfirmDialog.tsx` wraps its returned element in
  `createPortal(..., document.body)`.
- Import `createPortal` from `react-dom`, not `react-dom/client`.
- `document.body` is guaranteed present in the renderer; the dialog mounts in
  app UI flow, not during SSR.

No caller changes (`PaneTabs`, `PaneHeader`, `BackgroundPanel`) are required —
they keep composing `<ConfirmDialog>` where they are today; only the final mount
point moves to body.

Both changes are additive/isolated; existing keyboard (Escape), click-to-dismiss
(backdrop), and `aria-modal` behavior are unchanged.

## Files

- `src/renderer/src/styles.css` — `meow-rise` / `meow-pane-in` end state
  `transform: none`.
- `src/renderer/src/components/ConfirmDialog.tsx` — wrap in `createPortal` to
  `document.body`.

## Testing

- `npm run typecheck` passes.
- `npm run build` passes.
- Manual / e2e: open the delete-tab confirm, delete-agent confirm (header) and
  delete-background confirm; verify the dimmed backdrop covers the full window,
  not just the pane. Escape and outside-click dismiss still work.
