# Sidebar Icon-Button Geometry — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan
**Refines:** `docs/superpowers/specs/2026-09-12-sessions-in-sidebar-design.md` (Task 8, sidebar visuals)

## Summary

The sidebar's icon-only buttons render as stretched rectangles with an
over-proportional corner radius: the project-row `+` / `...` buttons measure
**34.0 × 25.0** and the session-row `...` measures **19.0 × 20.0**, all with
`border-radius: 6px` — 24–32% of the button's own size. The intent (and the
approved mockup) was a small square icon button.

This spec makes every sidebar icon-only button a fixed **24 × 24 square with a
3px radius**, via one dedicated class, and removes the CSS specificity conflict
that produced the stretched geometry.

## Goals

1. **Square icon buttons.** The project `+`, the project `...`, and the session
   `...` are exactly 24 × 24 regardless of icon size, font size, or row content.
2. **Proportional radius.** 3px on a 24px button (12.5%), down from 6px on a
   19–25px button (24–32%). A square reads as a square, not a rounded blob.
3. **No specificity guessing.** The buttons must not depend on which of several
   competing rules the cascade happens to pick.
4. **One source of truth** for the geometry — the same box everywhere in the
   sidebar, so the three buttons cannot drift apart again.

## Non-goals

- Not touching the expand/collapse chevron (13 × 13, backgroundless by design),
  the sidebar collapse toggle (20 × 20, 4px — already square), the sidebar
  footer `Menu` button (labeled, not icon-only), the title bar, or
  `PaneHeader`'s `...` button.
- No change to hover-reveal behavior, menu contents, or row semantics.
- No change to `.btn` / `.btn.small` — other screens keep their current buttons.

## Root cause

Two independent defects combine into the reported symptom.

**1. A dead override.** `.project-actions .btn { padding: 2px 4px }` (line 323)
is tied on specificity — `(0,2,0)` — with `.btn.small { padding: 4px 10px }`
(line 377). Equal specificity is resolved by source order, and `.btn.small` is
later, so it wins. The intended 4px horizontal padding never applies; the
buttons get 10px on each side of a 14px icon and stretch to 34px wide.

Measured in Chrome against the real `src/renderer/src/styles.css`:

| Element | Size (w × h) | Radius | Applied padding |
|---|---|---|---|
| project `+` | 34.0 × 25.0 | 6px | `4px 10px` (not the authored `2px 4px`) |
| project `...` | 34.0 × 24.2 | 6px | `4px 10px` |
| session `...` | 19.0 × 20.0 | 6px | `2px 3px` |
| expand chevron | 13.0 × 13.0 | 6px | `0` |
| sidebar toggle | 20.0 × 20.0 | 4px | `0` |

**2. Phantom height and no fixed radius.** `.btn` sets `border-radius:
var(--radius)` (6px) and is an inline-block, so an inline `<svg>` sits on the
text baseline and adds descender space — the button box is ~2–3px taller than
its content. Height therefore varies with font metrics, and the radius is never
overridden for these small buttons.

## Approach: a dedicated `.sidebar-icon-btn` class

Give the three icon-only buttons their own self-contained rule instead of
composing `.btn ghost small` and then fighting the cascade.

**Rejected — CSS-only override at matching specificity.** Writing the geometry
into `.project-actions .btn, .session-menu .btn` after line 377 would work
today, but the fix would keep depending on source order. Moving that rule (or
adding another `.btn.small`-shaped rule later) silently re-breaks it — the exact
failure mode being fixed here.

**Rejected — change `.btn.small` globally.** `.btn.small` also styles labeled
buttons ("Add Project", "Check update" with an icon + text). A fixed 24 × 24 box
would squash them.

## Detailed design

### Token

Add to the `:root` "misc" block, next to the existing radii:

```css
--radius-xs: 3px;
```

Geometry only — no `[data-theme="light"]` counterpart is needed, matching how
`--radius-sm` / `--radius` / `--radius-lg` are declared once.

### New class (Buttons & inputs section)

```css
.sidebar-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; flex: 0 0 auto;
  line-height: 0; /* icon-only button: the svg is a flex item, so no baseline gap */
  border: none; background: transparent; color: var(--text-faint);
  border-radius: var(--radius-xs); cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
```

- `inline-flex` + `line-height: 0` remove the baseline descender gap, so the box
  is exactly 24 × 24 for any icon size.
- `flex: 0 0 auto` keeps it square inside the flex rows instead of stretching.
- The global `:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px }`
  (element selector, not `.btn`) still applies, so keyboard focus stays visible.

### Rewired container rules

- `.project-actions .btn` → `.project-actions .sidebar-icon-btn`: keep
  `border: none`, `background: transparent`, `color: var(--text-faint)`; **drop**
  the dead `padding: 2px 4px` (the class owns padding now).
- `.project-actions .btn:hover` → `.project-actions .sidebar-icon-btn:hover`
  (`background: var(--bg-hover); color: var(--text)`), selector unchanged otherwise.
- `.session-menu .btn` → `.session-menu .sidebar-icon-btn`: keep the reveal
  (`opacity: 0` until row hover / row active / `:focus-within`) and the hover
  background `var(--bg-active)`, matching the existing session-row treatment.
  This rule also declares `transition`, so it must list **all three** properties
  — `transition: opacity 120ms ease, background 120ms ease, color 120ms ease` —
  or the cascade drops the base rule's background/color transition and the hover
  background snaps in instantly.
- `.project-row:hover .project-actions, .project-list li.active .project-actions,
  .project-actions:focus-within { opacity: 1 }` is unchanged — it targets the
  container, not the button.

### Component changes (`src/renderer/src/components/Sidebar.tsx`)

Three buttons switch from `className="btn ghost small"` to
`className="sidebar-icon-btn"`: the project `+`, the project `...`, and the
session `...` in `SessionRowMenu`.

The `<span className="btn-icon">` wrapper around `MoreIcon` becomes redundant
once the button itself is the centering flex container, and is dropped — in
`Sidebar.tsx` only. `PaneHeader.tsx` keeps its `btn-icon` wrapper, unchanged.

### Resulting geometry

| | before | after |
|---|---|---|
| project `+` / `...` | 34.0 × 25.0 | 24 × 24 |
| session `...` | 19.0 × 20.0 | 24 × 24 |
| radius | 6px (24–32% of size) | 3px (12.5%) |
| project row height | 35px | 34px |
| session row height | 28px | 32px |
| project action group width | 70px | 50px |

The session row grows 4px because the 24px button now sets the row's minimum
height; rows stay visually consistent (34 vs 32px) and the `...` gets a
comfortable, uniform hit target.

## Testing

- **Visual/geometry check (manual, evidence-based):** serve `src/renderer/src/styles.css`
  with the sidebar markup and assert each button's `getBoundingClientRect()` is
  24 × 24 with a computed `border-radius: 3px`. This is the same harness that
  produced the "before" table above.
- `npm run typecheck` passes.
- `npm test` passes (no unit test covers CSS; the sidebar e2e must keep passing).
- `npm run build && npm run e2e` — the e2e suite clicks sidebar session rows and
  the `...` menu, so it guards against the className change breaking selection.

## Documentation

- `docs/reference/09-ui-guide.md` — sidebar icon-button geometry + the
  `--radius-xs` token.
- `src/renderer/AGENTS.md` — the `--radius-xs` token and the icon-button rule,
  if its CSS section documents tokens/patterns.
- Root `AGENTS.md` needs no change (no new dependency, no structural change).
