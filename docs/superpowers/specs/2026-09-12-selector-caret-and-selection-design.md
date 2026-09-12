# Selector Caret & Selection Indicator — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan
**Follows:** `docs/superpowers/specs/2026-09-12-menu-visual-language-design.md`

## Summary

The four selectors (Mode, Variant, Model, Git branch) mark the selected row with a
**blue 2px left border** and a `✓` text glyph sitting on the **left**. Two of them
disagree with the other two, the glyph renders differently per font, and the left
border insets every row's content 2px off-grid.

Replace the `▾` glyph with one shared lucide caret that rotates while the menu is
open, and move selection to a **tick pinned to the right in a reserved column** so
labels stay put.

## Goals

1. **One caret implementation.** A lucide `ChevronDown`, rendered by the shared
   `Dropdown` base, rotating 180° while open — driven by CSS from `aria-expanded`.
2. **Selections read as an end-of-row tick**, not a left accent bar.
3. **All four selectors identical** in how a selected row looks and where the tick
   sits, including the two that differ today.
4. **Labels never shift** when selection moves: the tick column is reserved on
   every row, selected or not.
5. **Row content back on the menu grid** — 10px inset, matching the action menus.

## Non-goals

- No change to which selectors exist, their options, or their onSelect behaviour.
- No change to the action menus' leading 16px icon column (`--menu-icon` is
  *reused* for the trailing tick width, not repurposed).
- No restyle of `.dropdown-menu` / `.mode-menu` / `.model-menu` / `.git-branch-dropdown`
  containers — their metrics were settled in the menu spec.
- **Out of scope, still using the blue-left-bar idiom:** `.command-item.selected`
  (slash-command palette) and `.settings-nav-item` (settings nav). They are not
  selectors; unifying them is a separate change.

## Current state

Read from the source (`styles.css` line references at time of writing):

| Selector | Trigger arrow | Active row | Tick |
|---|---|---|---|
| `ModePicker` | `▾` glyph in `.mode-caret` (1328/1374) | `.mode-item.active` → `bg-active` + `border-left-color: var(--accent)` (1370) | `✓` glyph, left, `.mode-check` |
| `VariantPicker` | `▾` glyph in `.variant-caret` (1328) | `.variant-item.active` → `bg-active` + accent text + accent border (1325) | `✓` glyph, left, `.variant-check` |
| `ModelPicker` | `▾` glyph in `.model-caret` (1330) | `.model-item.active` → `bg-active` + accent text + accent border (1355) | **none** |
| `GitBranchSwitcher` | lucide `ChevronDown size={13}` | `.git-branch-item.active` → accent text only, **no background** (1740) | lucide `Check size={13}`, left, `.git-branch-check` width 14px |

Two structural findings:

**Only `Dropdown.tsx` sets `aria-expanded`.** `ModelPicker` and
`GitBranchSwitcher` render their own `<button>` triggers without it, so there is
no hook for an open state today. They are disclosure toggles, so the attribute is
also an accessibility fix, not merely a styling hook.

**Every selector item carries `border-left: 2px solid transparent` *and*
`padding: 0 var(--menu-item-pad-x)`.** Content therefore starts at 12px while the
action menus' items start at 10px. Removing the border both drops the accent bar
and realigns the family.

## Approach: one caret in the base, one trailing tick column

Put the caret in `Dropdown.tsx` — the shared base that `ModePicker` and
`VariantPicker` are built on — and drive its rotation from `aria-expanded` in
CSS, so no component holds open-state for the caret. Move selection to a shared
trailing column.

**Rejected — keep the caret in each component.** Three near-identical `▾` spans
(and one lucide icon) stay duplicated, and each component needs its own rotation
markup. The user explicitly asked for the shared base to be included.

**Rejected — rotate via a JS-driven class (`.open`) on the trigger.** `Dropdown`
already exposes `aria-expanded`, which is both the accessibility signal and a
valid CSS hook. A parallel class would be a second source of truth for the same
fact.

**Rejected — place the tick absolutely so no column is reserved.** Rows would
then not need an extra element, but the tick would overlap a long model name
instead of it ellipsizing, and labels would not align with each other.

**Rejected — drop the left border but keep the tick on the left.** The user's
request was explicit: the tick moves to the right.

## Detailed design

### Caret (shared)

`Dropdown.tsx` renders the caret itself, as the **last child of the trigger
button**, after `{trigger}`:

```tsx
<button ref={triggerRef} className="dropdown-trigger" …>
  {trigger}
  <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
</button>
```

`ModePicker` and `VariantPicker` therefore **delete** their
`<span className="…-caret">▾</span>` children; `ModelPicker` replaces its `▾`
span with the same element; `GitBranchSwitcher` changes `ChevronDown size={13}`
to `size={14} className="dropdown-caret"`.

`ModelPicker`'s and `GitBranchSwitcher`'s triggers gain
`aria-expanded={open}` and `aria-haspopup="listbox"`, matching `Dropdown.tsx`.

```css
.dropdown-caret { color: var(--text-dim); flex: 0 0 auto; transition: transform 120ms ease; }
[aria-expanded="true"] .dropdown-caret { transform: rotate(180deg); }
```

`.mode-caret`, `.variant-caret` and `.model-caret` are deleted.

The rotation rule is intentionally descendant-scoped on `[aria-expanded="true"]`
rather than listing the three trigger classes: any future trigger that sets
`aria-expanded` gets the behaviour for free, and `.dropdown-caret` is this
codebase's own class, so the blast radius is limited to elements that opt in.

`size={14}` is a fixed pixel value: the icon no longer scales with the
user-selectable base font size (8–40px, `src/font.ts`) the way the glyph did.
That is accepted — a 14px caret is correct at the default 14px base, and the
alternative (an `em`-sized icon) would balloon at large font sizes.

### Selection indicator (all four selectors)

**Removed:** `border-left: 2px solid transparent` from `.mode-item`,
`.variant-item`, `.model-item`; `border-left-color: var(--accent)` from all three
`.active` rules. `.git-branch-item` had no left border.

**Added — two shared classes, named for the `--menu-*` family:**

```css
.menu-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-item-check {
  flex: 0 0 var(--menu-icon); display: inline-flex; align-items: center;
  justify-content: center; color: var(--accent);
}
```

`--menu-icon` (16px) is reused as the tick column width so the trailing column
matches the action menus' leading icon column.

**Row shape** changes from `[check][label]` to `[label][check]`:

```tsx
<button className={`…-item ${active ? 'active' : ''}`}>
  <span className="menu-item-label">{label}</span>
  <span className="menu-item-check">{active && <Check size={16} aria-hidden="true" />}</span>
</button>
```

The `.menu-item-check` span is rendered on **every** row, empty when unselected,
so the reserved `flex: 0 0 16px` keeps all labels aligned.

**The `✓` glyph becomes a lucide `Check`** (16px), matching the caret change and
`GitBranchSwitcher`'s existing icon. `.mode-check` and `.variant-check` are
deleted.

**Ellipsis moves to the label.** `.variant-item` and `.model-item` currently set
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on the button
itself; once the button is a flex container with two children, ellipsis on the
container clips the tick instead of the text. Those three declarations move to
`.menu-item-label`, and are dropped from the item rules. `.mode-item` has only
`white-space: nowrap`, treated the same way.

**GitBranchSwitcher** loses its bespoke `.git-branch-check` (14px) in favour of
the shared `.menu-item-check`, and `.git-branch-item.active` gains
`background: var(--bg-active)` so all four selectors mark selection identically.
Remote rows render an empty `.menu-item-check` to keep the column reserved, as
they do today with `.git-branch-check`.

Item rules keep their content-driven `font-family: var(--font-mono)` (models and
branch names are identifiers) — per the menu spec, only metrics are shared.

### Result

| | before | after |
|---|---|---|
| trigger arrow | `▾` glyph, font-dependent, no open feedback | lucide `ChevronDown` 14px, rotates 180° while open |
| active row | `bg-active` + accent 2px left bar (git: no background) | `bg-active` + accent label, no left bar |
| tick | `✓` glyph left, 14–16px column; absent in Model | lucide `Check` 16px, **right**, 16px column on every row |
| tick column reserved | only where a tick existed | always — labels never shift |
| item content inset | 12px (2px border + 10px padding) | 10px, matching the action menus |

## Testing

New `tests/e2e/selectors.spec.ts` (Playwright, real built app), covering:

- **Caret:** the Mode trigger contains `svg.dropdown-caret`; `aria-expanded` is
  `false` then `true` after opening; the caret's computed `transform` is not
  `none` while open, and is `none` again after closing.
- **Rotation is real, not just a class:** assert the computed transform matrix
  flips (a `rotate(180deg)` on a 14px icon yields `matrix(-1, 0, 0, -1, 0, 0)`).
- **Selected row:** the active `.mode-item` / `.variant-item` / `.model-item` /
  `.git-branch-item` has `border-left-width: 0px` (the bar is gone) and a
  non-transparent `background-color`. To avoid hardcoding a hex value (the
  palette has a light variant), compare it against a probe element created in
  the test with `style.background = 'var(--bg-active)'` and resolved via
  `getComputedStyle`.
- **Tick position:** the active row's `.menu-item-check` is its **last** child,
  contains an `svg`, and its right edge sits at `rowRight - 10px` (the padding),
  i.e. it is right-aligned rather than left.
- **Column reserved:** in a row that is *not* selected, `.menu-item-check` still
  exists and is 16px wide — this is the regression guard for labels shifting.
- **ModelPicker gap closed:** its active row now contains an `svg` (it had none).
- **GitBranchSwitcher gap closed:** its active row has a non-transparent
  background (it had none).

Then `npm run build && npm run e2e`, `npm run typecheck`, `npm test`.

**A deliberate change to an existing assertion.** `menus.spec.ts` pins the
action-menu/picker split with `await expect(modeMenu.locator('svg')).toHaveCount(0)`
— "pickers are icon-free". This change adds a `Check` svg to the active mode row,
so that assertion **must be narrowed, not deleted**: the split was always about
*leading* action icons, and the row now legitimately contains a *trailing* tick.

Replace it with an assertion of the actual intent — no row's first child is an
icon:

```ts
const firstChildIsLabel = await modeMenu.locator('.mode-item').evaluateAll(
  els => els.every(e => e.firstElementChild?.classList.contains('menu-item-label'))
)
expect(firstChildIsLabel).toBe(true)
```

The Mode *trigger*'s caret is outside `.mode-menu` (the menu is portaled to
`document.body`), so it never enters this count either way.

## Documentation

- `docs/reference/09-ui-guide.md` — §9.5 Styling: the shared `.dropdown-caret`
  (rotation driven by `aria-expanded`), and the `.menu-item-label` /
  `.menu-item-check` pair with the rule that a selector's selected row is
  `bg-active` + accent label + trailing tick.
- `src/renderer/AGENTS.md` — the CSS section: the same two classes, and that new
  selectors must set `aria-expanded` to get caret rotation.
- `tests/e2e/AGENTS.md` — register `selectors.spec.ts`.
- Root `AGENTS.md` — no change (no new dependency, no structural change).
