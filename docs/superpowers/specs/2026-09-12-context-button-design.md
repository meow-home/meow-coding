# Context Readout as an Icon Button — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan
**Refines:** `docs/superpowers/specs/2026-08-06-context-usage-footer-design.md` (the ring readout),
`docs/superpowers/specs/2026-09-12-sidebar-icon-button-geometry-design.md` (icon-button geometry)

## Summary

The chat composer's context readout renders as a bare 30 × 30 progress ring sitting at the right
end of `.chat-footer-controls`, next to three selectors that are 34px-tall pill-shaped triggers. It
reads as an unlabeled decoration rather than as one of the row's controls.

This spec gives it the shape of the sidebar's icon buttons — a **24 × 24 box with a 3px radius and a
hover background** (`--bg-hover`), holding a 20px ring — while keeping the readout non-interactive
(hover only, no click) and widening its hover popover so its rows no longer wrap.

## Goals

1. **Icon-button silhouette.** The ring sits in a 24 × 24 box with `border-radius: var(--radius-xs)`
   (3px), transparent at rest and `var(--bg-hover)` on hover — visually a sibling of the sidebar's
   project `+` / `...` buttons.
2. **Proportional ring.** The SVG shrinks 30px → 20px and the stroke 3 → 2.5 so the arc keeps the same
   clearance ratio inside its box (1.5px margin in 30px → 1.25px in 20px) instead of touching the
   rounded corners.
3. **A wider, never-breaking popover.** The hover popover's floor grows 200px → 216px (comfortable
   line lengths for the `context` / `tokens` / `cost` rows), its width is declared content-driven
   (`width: max-content`) rather than left to shrink-to-fit resolution, and its rows are `nowrap` so
   no value can ever break the layout.
4. **No behavior change.** Still a readout, not a button: no click target, no menu, no keyboard
   affordance added or removed; the aria-label and the warn/danger color escalation are unchanged.

## Non-goals

- **No click-to-pin / focus behavior.** The user chose to keep the popover hover-driven. Adding
  `aria-expanded`, Escape and outside-click handling (the `Dropdown.tsx` pattern the neighboring
  pickers use) is explicitly out of scope; the ring stays non-focusable, as today.
- No change to the popover's information design: still `context` (+ `% left`), the `compacting soon`
  note at danger level, `tokens <in> in / <out> out`, `cost`. No new fields.
- No change to the neighboring `ModePicker` / `ModelPicker` / `VariantPicker` triggers, to
  `.context-footer-wrap`'s position in the flex row, or to `--radius` / `.btn`.
- No change to `.sidebar-icon-btn`. The two contexts now share a *look*, not a class — see below.

## Why not reuse `.sidebar-icon-btn`

`.sidebar-icon-btn` is the sidebar's class and is named for that scope; only its geometry is common.
Its hover background lives in a container rule (`.project-actions .sidebar-icon-btn:hover`), so the
chat footer would need a new rule anyway, and the class block is currently being edited by a parallel
session on this working tree (the sidebar sessions refactor). Sharing it now would buy a DRY win at
the cost of coupling two unrelated surfaces and colliding with in-flight work.

**Rejected for the same reason:** extracting a generic `.icon-btn` and rebasing the sidebar buttons on
it. That is a reasonable follow-up once the sidebar branch is quiet, not part of this change.

## Findings: the popover's real behaviour (measured)

The design brief reported the popover's rows wrapping. Instrumented against the built app (a temp
`MEOW_USER_DATA`, one mock turn, the popover forced visible so its width is stable), that could **not**
be reproduced — and it falsified the first hypothesis, that the box was shrink-to-fit inside the 24px
trigger and therefore decided by its `min-width`:

| content (the `tokens` row) | window width | popover `offsetWidth` | lines per row |
|---|---|---|---|
| real-session counts, `145,503 in / 431 out` | 1399 / 499 / 319 px | **200px** (the floor) | 1 |
| 9-digit counts | 1399 px | **227px** (content-driven) | 1 |
| 13-digit counts | 1399 / 499 px | **264px** (content-driven) | 1 |
| 13-digit counts | 319 px | 264px — overflows past the left edge | 1 |

So `width: auto` on this absolutely positioned box already resolves to `max-content`: the `min-width`
floor only decides the result when the text is **shorter** than it. Consequences for the change:

- **The widening is the real change.** With realistic counts the box renders exactly 200px — the old
  floor — so `min-width: 216px` is what makes the readout roomier. That is also the assertion the e2e
  test can genuinely gate (200 → 216).
- **`width: max-content` makes the intent explicit** instead of depending on how Chromium resolves
  shrink-to-fit for `position: absolute; right: 0; left: auto`.
- **`white-space: nowrap` is a guard, not a fix.** No row wraps today, at any width or value size we
  could produce; the rule keeps that true if an ancestor ever clamps the box.
- **Open question for the user:** the reported wrap is unaccounted for. The one behaviour that *does*
  degrade at small window widths is the box overflowing off-screen (measured `popoverLeft: -42` at a
  319px window), which a `max-width` + wrap would trade for wrapped rows — deliberately not done here,
  pending the user's confirmation of what they saw.

## Detailed design

### Component (`src/renderer/src/components/chat/ContextFooter.tsx`)

Only the ring geometry constants change:

```ts
const SIZE = 20
const STROKE = 2.5
const R = (SIZE - STROKE) / 2  // 8.75
const C = 2 * Math.PI * R      // ≈ 54.98
```

`R`/`C` are already derived, and `viewBox`/`cx`/`cy`/`rotate()` all read `SIZE`, so nothing else in
the file moves. The DOM (`.context-footer-wrap` > `.context-ring` > `svg` + `.context-footer-popover`)
and the `role="img"` + `aria-label` on the ring are unchanged.

Clamping note: `strokeLinecap="round"` adds `STROKE / 2` at each end of the arc, and the arc is a full
circle at `remaining === 100`. At `SIZE 30 / STROKE 3` the circle spans 27px in a 30px box (1.5px
margin); at `SIZE 20 / STROKE 2.5` it spans 17.5px in 20px (1.25px margin). The proportion holds — the
ring never clips, and inside the 24px button it leaves 3.25px to each box edge.

### CSS (`src/renderer/src/styles.css`)

`.context-ring` takes the icon-button box (geometry only; the ring's own colors and stroke stay):

```css
.context-ring {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; cursor: default; color: var(--accent-strong);
  border-radius: var(--radius-xs); background: transparent;
  transition: background 120ms ease;
}
```

- `cursor: default` is deliberate: hover changes the background, but the element is not clickable.
  (`.sidebar-icon-btn` uses `cursor: pointer` because those buttons act on click.)
- The global `:focus-visible` outline is irrelevant here — the element has no tabindex.
- `.context-ring svg { transform: rotate(0deg) }`, the track/arc stroke rules, and
  `.context-ring.warn` / `.context-ring.danger` are unchanged.

New hover rule, next to the existing `:hover` reveal for the popover:

```css
.context-footer-wrap:hover .context-ring { background: var(--bg-hover); }
```

`.context-footer-wrap` itself keeps `position: relative; display: inline-flex` — unchanged.

The popover, with the wrapping fix:

```css
.context-footer-popover {
  position: absolute; bottom: calc(100% + 6px); right: 0; left: auto; z-index: 100;
  display: none; width: max-content; min-width: 216px; padding: 8px 10px;
  flex-direction: column; gap: 6px;
  background: var(--bg-raised); border: 1px solid var(--hairline); border-radius: var(--radius);
  box-shadow: var(--shadow-3); font-family: var(--font-mono); font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}
.context-popover-row { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
```

- `min-width: 216px` is the visible change (see Findings); `width: max-content` states the
  content-driven intent outright and `white-space: nowrap` guarantees no row can break.
- No `max-width`: a clamp would either re-wrap or clip nowrap text. Growth is leftward (the popover is
  `right: 0`, anchored at the composer's right edge), so even a 13-digit token count stays on screen at
  normal window widths — measured, and it overflows only in a very narrow window (see Findings).
- `.context-popover-label` keeps its fixed `min-width: 56px` so the `context` / `tokens` / `cost`
  labels stay column-aligned across rows.

### Resulting geometry

| | before | after |
|---|---|---|
| `.context-ring` box | 30 × 30 | 24 × 24 |
| ring SVG | 30 (stroke 3) | 20 (stroke 2.5) |
| ring radius | 6px | 3px |
| rest background | transparent | transparent |
| hover background | none | `var(--bg-hover)` |
| popover width | 200px floor (content-driven above it) | `max-content`, floor 216px, rows cannot wrap |
| popover offset above trigger | 6px | 6px (unchanged) |

The readout now matches the 24px icon buttons of the sidebar and stops competing with the 34px-tall
picker triggers beside it.

## Testing

Extend `tests/e2e/context-footer.spec.ts` (its existing selectors, `.context-footer-wrap` and
`.context-ring`, survive this change, so the other three tests keep passing as-is) with two tests.

**Test A — the readout's geometry** (fixture: the file's existing mock provider; no message needed):

1. Launch, open the seeded session, take the ring's `boundingBox()`.
2. It is 24 × 24, `border-radius` computes to `3px`, and the inner `svg` is 20 × 20.
3. Rest background is `rgba(0, 0, 0, 0)`; `cursor` computes to `default`. Move the pointer onto the
   ring (`window.mouse.move` to the box centre — `locator.hover()` retargets to the element's own
   centre and raced the pane mount, which made the assertion flaky under `--repeat-each`), then poll
   the computed `background-color` until it equals a runtime-resolved `--bg-hover`.

**Test B — the popover's box** (fixture: one mock turn, realistic counts — `145,503` prompt /
`431` completion tokens, i.e. a real session's numbers; `maxContextTokens` above them so nothing
compacts). With short content the box is exactly its floor, which is what makes the width assertion
meaningful:

1. Send a message so the `tokens` row exists, then move the pointer onto `.context-footer-wrap`.
2. `.context-footer-popover` becomes visible; its `offsetWidth` is ≥ 216 (**the gate**: measured
   exactly 200px before the change) and `scrollWidth <= clientWidth + 1`.
3. Guard: every `.context-popover-row` reports exactly one line box, and computes
   `white-space: nowrap`. Line count is measured over the row's **text nodes** (`Range.getClientRects`
   per text node, fragments grouped into a line while their vertical spans overlap) — a range over the
   row itself is useless, because a flex row blockifies its spans and reports one rect per span, which
   is why a first version of this assertion passed even with wrapping.

Then the usual gates: `npm run typecheck`, `npm test`, and `npm run build && npx playwright test
tests/e2e/context-footer.spec.ts`.

**Verification hazards:** this branch's working tree is being edited by a parallel session, and `out/`
is rebuilt by that process — check `out/` mtime before trusting an e2e result, as recorded in the
project memory `concurrent-session-edits`. Independently, the file's **first** test fails against the
current tree for a reason unrelated to this change: `SessionPanes` keeps every session mounted (a
`hidden` attribute, never an unmount), so after the `+` creates a second session the DOM holds two
`.context-footer-wrap` elements and that test's `toContainText` hits a Playwright strict-mode
violation. Fixing it is out of scope here (scope the locator to the active pane) — it is reported, not
silently patched.

## Documentation

- `src/renderer/src/components/chat/AGENTS.md` — the `ContextFooter.tsx` row: it is an icon-button
  readout (24 × 24, hover popover, hover-only, no click), and the popover is content-width (`max-content`).
- `docs/reference/09-ui-guide.md` — §9.5 Styling: the context readout uses the sidebar icon-button
  geometry; note that the shared *look* is not a shared class (`.sidebar-icon-btn` is sidebar-only).
- `tests/e2e/AGENTS.md` — extend the `context-footer.spec.ts` row with the geometry/no-wrap assertion.
- Root `AGENTS.md` needs no change: no new dependency, IPC channel, setting, or storage format.
