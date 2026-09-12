# Pane Header Trim + One Shared Icon Button — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan
**Supersedes one non-goal of:** `docs/superpowers/specs/2026-09-12-sidebar-icon-button-geometry-design.md`

## Summary

Two changes to the pane header:

1. **Trim it to the dot and the name.** It currently reads `● meow idle ⎇ --`,
   repeating the status word and a git readout that the status bar already owns.
   The coloured dot keeps carrying the status; the words go away.
2. **Make its `...` button the same button as the sidebar's.** It is currently
   `31 × 21` with a 6px radius and three horizontal dots, built as `.btn ghost
   small` + a container override — the exact construction the sidebar spec
   removed for being order-dependent. It becomes a `24 × 24` / 3px button with
   three vertical dots, sharing **one class** with the project-row `...`.

The sidebar spec deliberately scoped PaneHeader out ("Not touching ... PaneHeader's
`...` button"). This spec reverses that one non-goal, and the class is therefore
renamed `.sidebar-icon-btn` → `.icon-btn` so it is no longer named after a place
it is not confined to.

## Goals

1. **No repeated status text.** The header shows the status dot and the session
   name, nothing else.
2. **No git readout in the header.** The status bar already shows
   `⎇ branch ● n` and opens the git viewer on click; the header showed `⎇ --`
   whenever git was unavailable, which is information-free.
3. **One icon-button class.** The pane header's `...` and the sidebar's `+` / `...`
   render from the same rule, so they cannot drift apart again.
4. **No status information lost to accessibility.** Dropping the visible status
   word must not drop the status for assistive tech.

## Non-goals

- Not changing status *colours* or their meaning — `.status-dot.status-*` stays
  exactly as it is, including the error animation (that ring pulse is an
  attention signal, independent of the text).
- Not changing `alert-*` on `.pane-header`, the pane-title styling, or the
  header height (32px).
- Not changing hover-reveal behaviour: the sidebar's `...` appears on row hover,
  the pane header's `...` is always visible. The two share *geometry*, not
  *reveal policy* — a single-button header that hides its only button would hide
  the affordance itself.
- Not touching the composer's `+` button (a separate in-flight change owns it),
  `.context-ring`, the title bar, or `StatusBar`.
- Not touching the menu *contents* of the pane header.

## Root cause

**1. The button is built from the pattern the codebase removed.** Measured in
the running app against the current `styles.css`:

| Element | Size (w × h) | Radius | Applied padding | Border |
|---|---|---|---|---|
| pane header `...` | 31.0 × 21.0 | 6px | `2px 8px` | `solid transparent` |
| project `...` (`.icon-btn`) | 24.0 × 24.0 | 3px | `0` | `none` |

`.pane-actions .btn` (line 496) and `.btn.small` (line 366) are both
specificity `(0,2,0)`, so source order decides — `.pane-actions .btn` is later
and wins the padding, while `border-radius` is never declared for it at all, so
`.btn`'s 6px survives. This is precisely the failure mode
`sidebar-icon-button-geometry-design.md` documents and fixed for the sidebar by
introducing a standalone class instead of composing `.btn`. `PaneHeader` was
left out of that fix and still has it.

**2. Redundant header content.** The header's text run measures
`meowidle--` — the name, the status word, and a git field that renders `--`
when git is unavailable. The name is the only part that is unique to this
session: the status word duplicates the dot beside it, and git is already in the
status bar (`StatusBar.tsx` renders the same `branch` + `● dirtyCount` idiom from
`activeRuntime.git`, with a click target that opens the viewer).

## Approach: share one class, renamed for its real scope

Rename `.sidebar-icon-btn` → `.icon-btn` and use it for the pane header button
too.

**Rejected — a new `.pane-icon-btn` class copying the metrics.** Lowest conflict
risk, but it makes the shared geometry a *third* copy (sidebar, context ring,
pane header). That is the drift that produced the off-centre composer `+` bug
(a hand-copied class missing `justify-content`), and it is the drift this request
("make it like the project-item `...`") is trying to eliminate. Two classes that
must stay identical will not.

**Rejected — keep `.btn ghost small` and raise specificity for the pane.**
Smallest diff, but it preserves the exact order-dependent construction the
sidebar spec removed on purpose, so the next `.btn`-shaped rule silently breaks
it again.

## Detailed design

### Class rename

`.sidebar-icon-btn` → `.icon-btn`, definition unchanged (`width: 2rem`,
`height: 2rem`, `padding: 0`, `border: none`, `background: transparent`,
`color: var(--text-faint)`, `border-radius: var(--radius-xs)`,
`line-height: 0`, `flex: 0 0 auto`, `display: inline-flex` with centring, and the
120ms background/color transition). Its comment is updated: the class is no
longer sidebar-scoped, and the `.btn.small` specificity note stays because it
explains *why* the class is standalone.

Container rules updated to match, selectors otherwise unchanged:

- `.project-actions .sidebar-icon-btn` → `.project-actions .icon-btn` (hover rule too)
- `.session-menu .sidebar-icon-btn` → `.session-menu .icon-btn` (the `opacity: 0`
  reveal, the reveal triggers, and the hover rule — all three, keeping the
  three-property `transition` the existing rule documents)

### Sidebar (`src/renderer/src/components/Sidebar.tsx`)

Three `className="sidebar-icon-btn"` occurrences (project `+`, project `...`,
session-row `...`) become `className="icon-btn"`. No other change.

### Pane header (`src/renderer/src/components/PaneHeader.tsx`)

- `<button className="btn ghost small" ...>` → `<button className="icon-btn" ...>`.
- Drop the `<span className="btn-icon">` wrapper: the button is itself the
  centring flex container, so the wrapper is redundant (as it already is in
  `Sidebar.tsx`).
- `Ellipsis` (horizontal) → `MoreVertical` (vertical, 14px) to match the
  project-row button. The `Ellipsis` import goes away.
- Delete the `<span className="pane-status">` and `<span className="pane-git">`
  elements.
- The status dot gains the status as an accessible name:
  `<span className={...} role="img" aria-label={label} />`, where `label` is
  `STATUS_LABEL[state.status]`, plus `` ` (${state.exitCode})` `` when
  `exitCode !== null`. `role="img"` is required for the label to be exposed: a
  bare `aria-label` on a roleless `<span>` is not reliable (the sidebar's
  `.session-dot` does the bare form; this one is done correctly). Keeping
  `exitCode` inside the label preserves the one fact the deleted text carried
  that the dot alone cannot express.
- `STATUS_LABEL` stays — it now feeds the label instead of the text.

### Dead code removal

`git` existed on the header only to render `.pane-git`, so the prop and its data
path go with it. Verified by grep that nothing else reads it:

- `PaneHeaderProps.git` and the `GitStatus` import.
- `PaneModel.git` (`App.tsx`) and `Pane.tsx`'s `git={pane.git}`.
- `App.tsx`'s `git: runtime.git` in the `PaneModel` builder.

`PaneModel` consumers (`Pane`, `SessionPanes`, `BackgroundPanel`) never read
`.git`. `Runtime.git` itself stays — `StatusBar` and the git viewer use it.

### CSS removal

`.pane-status`, `.pane-git`, and `.pane-git::before` are deleted. `.pane-actions`
keeps its flex/`margin-left: auto` layout but loses its `.btn` overrides
(`.pane-actions .btn`, `.pane-actions .btn:hover`), which are replaced by:

```css
.pane-actions .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
```

**`.btn-icon` becomes dead CSS and is deleted.** Verified by grep, the wrapper
existed only in `PaneHeader.tsx`; with it gone nothing else uses the rule.
`font-family: var(--font-display)` and the rest are already available on
`.icon-btn` via the global `button { font-family: inherit }`.

**One deliberate visual loss.** Hovering the pane menu previously revealed a
1px `--accent-dim` border (`.btn`'s `solid` border with its colour swapped),
which `.icon-btn` cannot reproduce — it is `border: none`. The hover state
becomes a `--bg-hover` background, matching the sidebar buttons. This is the
point of the change (same button, not a lookalike), not a regression to fix.

### Resulting geometry

| | before | after |
|---|---|---|
| pane header `...` | 31.0 × 21.0 | 24 × 24 |
| its radius | 6px | 3px |
| its icon | `Ellipsis` (horizontal), 14px | `MoreVertical` (vertical), 14px |
| header text | `meowidle--` | `meow` |
| header height | 32px | 32px (unchanged) |

## Testing

An e2e test in `tests/e2e/sidebar-sessions.spec.ts` (existing fixture and
`openProject` helper), written before the change and observed failing:

1. The pane header has exactly one action button, `24 × 24` with computed
   `border-radius: 3px` — the same assertion idiom as the existing
   "sidebar icon buttons are 24x24 squares with a 3px radius" test.
2. **The pane button and the project-row `...` carry the same class.** This is
   the assertion that locks the actual requirement: not "two buttons that look
   alike" but "one button definition".
3. The icon is `lucide-more-vertical`.
4. `.pane-status` and `.pane-git` have count 0 — asserting the removed elements
   directly, so the test reads as the change it guards and does not break when a
   session name changes.
5. The status dot exposes the status as its accessible name.

Then: `npm run typecheck`, `npm test`, and the full `npm run build && npm run e2e`.

## Documentation

The rename reaches more prose than the class itself, all of it now stale:

- `docs/reference/09-ui-guide.md`
  - the `PaneHeader.tsx` row — "Status dot, git info, menu (...)" no longer
    describes a header with no git field;
  - the action-menu list that names "pane header";
  - the radii line (~153) — "`--radius-xs` 3px (sidebar icon buttons, chat
    context readout)" gains the pane header;
  - the "**Icon-only buttons**" paragraph (~208) — the class name, and "the
    sidebar's icon-only buttons" as its scope;
  - the context-readout bullet (~184) — it asserts "`.sidebar-icon-btn` is
    sidebar-scoped", which the rename makes wrong; the sentence is rewritten
    around the readout sharing the *look* but not the class.
- `src/renderer/AGENTS.md` line 70 — the bullet names `.sidebar-icon-btn` as the
  one class for icon-only buttons; it becomes `.icon-btn` and states the real
  scope (sidebar rows + pane header).
- Root `AGENTS.md` — no change (no new dependency, no structural change).
- This spec's `supersedes` note resolves the contradiction with the sidebar
  spec's non-goal rather than leaving two specs disagreeing.
