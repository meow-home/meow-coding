# Menu Visual Language — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan
**Follows:** `docs/superpowers/specs/2026-09-12-sidebar-icon-button-geometry-design.md`

## Summary

The app's dropdowns disagree with each other — four different item paddings, two
font sizes, two container paddings, two gaps — so they read as unrelated
controls rather than one system. Reported symptom: rows feel far apart.

Adopt the visual language of the reference menu (ChatGPT's profile menu): a
rounded container, **contiguous** rows, one uniform row height, a left icon
column, hairline dividers between groups, and a muted context header — scaled to
this app's 14px base font.

## Goals

1. **One metric set** for every menu row and menu container. No more per-menu
   padding drift.
2. **Rows read as a list, not as stacked pills** — contiguous (`gap: 0`), one
   uniform height, wider menus.
3. **The reference's structure**: icon column, dividers between groups, a muted
   non-interactive header row where a menu has real context to show.
4. **Tighter than the reference, not looser** — the user's original complaint was
   over-generous item padding, so the row height goes *below* the reference's
   ratio rather than copying it.

## Non-goals

- No change to selection affordances in the pickers (the accent `border-left`
  bar, the `.variant-check`). The reference has no equivalent — it is an action
  menu, not a picker.
- No icons or dividers in the pickers (see Approach).
- No change to `.command-item` (the slash-command palette's two-line rows).
- No keyboard shortcuts or submenu chevrons (see "Dropped: trailing hints").
- No restyling of menu *triggers* (`.dropdown-trigger`, `.model-trigger`).

## Measured current state

Read from the running app (Playwright, real `styles.css`, default 14px font):

| surface | container pad | container radius | container gap | item padding | item font | item height |
|---|---|---|---|---|---|---|
| project / session / footer menu | 4px | 6px | 2px | **8px 12px** | 14px | **34.5px** |
| mode + variant pickers | 4px | 6px | 2px | **7px 12px** | 13.07px | 31.5px |
| model picker | **6px** | 6px | **4px** | **7px 12px** | 13.07px | — |
| git branch picker | 4px | 6px | — | **5px 8px** | ~12.1px | — |

The project menu is 6 rows × 34.5px + 5 × 2px gaps inside a **150px-wide**
container → 227px tall. Each row is 140 × 34.5 (aspect ≈ 4.1), against the
reference's ≈ 9.5 — squat rows stacked in a narrow column is a large part of the
"far apart" impression.

## Approach: split the surfaces into action menus and pickers

The reference is an **action menu**. Applying its full language everywhere would
mean icons and dividers in the model picker, which lists hundreds of models
inside a searchable, sectioned, scrollable list — there, an icon column is noise
and per-item dividers destroy scanability, and those pickers already have a
selection affordance the reference lacks.

So:

- **Full treatment** (icons + dividers + header) — the 5 action menus:
  project, session row, sidebar footer, pane header, right-panel file context.
- **Metrics only** — the 4 picker surfaces: mode, variant, model, git branch.
  They inherit the shared row height, padding, radius, font and container
  metrics, and keep their own structure.

**Rejected — full treatment on every surface.** Ships icons into a 300-row model
list and dividers into the git branch list, which already groups by section
header. Worse UI for the sake of literal consistency.

**Rejected — metrics only, everywhere.** Ignores the explicit request for the
reference's look (a previous option the user declined in favour of this one).

## Detailed design

### Tokens (`:root`, misc block)

```css
--menu-radius: 10px;      /* container corner */
--menu-pad: 6px;          /* container inner padding */
--menu-item-h: 32px;      /* uniform row height */
--menu-item-pad-x: 10px;  /* item horizontal padding */
--menu-icon: 16px;        /* icon column, fixed so labels align */
```

### Containers

One metric set applied to `.sidebar-menu-dropdown`, `.dropdown-menu`,
`.model-menu`, `.git-branch-dropdown`, `.right-panel-menu` and `.command-menu`:

- `border-radius: var(--radius)` (6px) → `var(--menu-radius)` (10px)
- `padding` → `var(--menu-pad)` (6px) — from 4px, and 6px for `.model-menu`
- **`gap: 2px`/`4px` → `gap: 0`** — rows become contiguous. This is the
  reference's strongest structural signal and the main fix for "far apart".
- keep `border: 1px solid var(--hairline)` and `box-shadow: var(--shadow-3)`

Inner item lists (`.variant-list`, `.mode-list`, `.model-list`, `.model-group`)
also go to `gap: 0` so the contiguity holds inside scrollable pickers.

### Items

One metric set for the item family — `.menu-item`, `.mode-item`,
`.variant-item`, `.model-item`:

```css
min-height: var(--menu-item-h);      /* 32px, was 31.5-34.5px */
padding: 0 var(--menu-item-pad-x);   /* was 8px 12px / 7px 12px / 5px 8px */
display: flex; align-items: center; gap: 8px;
border-radius: var(--radius);        /* 6px, was 4px */
font-size: var(--fs-md);             /* 14px — pickers were 13.07px */
```

Icons: rendered at `--menu-icon` (16px), `color: var(--text-dim)`,
`flex: 0 0 auto`. Labels stay **bare text nodes** — every item label is a short
fixed string, so no wrapper span is needed and none is added.

Rows with the accent bar (`.mode-item`, `.variant-item`, `.model-item`) keep
`border-left: 2px solid transparent`; with `box-sizing: border-box` their content
insets by the border, which is the existing behaviour.

`font-family` is deliberately **not** unified: the pickers set
`var(--font-mono)` on their rows because they render identifiers (`gpt-4o`,
branch names), and that is correct for the content. Only the *metrics* are shared.

**Row-height rationale.** 32px at a 14px font is 2.29×, below the reference's
~2.4×. The reference is *more* airy than what we have, so copying its ratio
would contradict the reported problem; 32px keeps the reference's structure while
reducing the actual spacing.

`.command-item` is **not** in the family — it stacks a name and a description and
would clip at 32px.

### New parts

```css
.menu-sep { height: 1px; background: var(--hairline); margin: 4px 6px; }
.menu-head {
  padding: 4px 10px 6px; color: var(--text-faint); font-size: var(--fs-base);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
```

`.menu-sep` is an inset hairline (the reference's dividers do not run edge to
edge). `.menu-head` is a non-interactive muted context row.

**Dropped — trailing hints.** The reference's right-aligned `Ctrl ,` and `>`
exist because it has shortcuts and submenus. This app has neither, so a
`.menu-hint` class would ship unused. Omitted until there is a real consumer.

### Per-menu composition

| Menu | Header | Icons (16px, before the label) | Divider |
|---|---|---|---|
| Project (`.project-menu-dropdown`) | project path, muted | `FolderOpen` (Open), `Code` (Open in VS Code), `GitBranch` (Git), `FolderSymlink` (Open Folder), `Terminal` (Open Terminal), `X` (Remove) | 1, before Remove |
| Session (`.session-menu-dropdown`) | — | `Pencil` (Rename), `Square` (Stop), `Trash2` (Delete) | 1, before Delete |
| Footer (`.sidebar-footer-dropdown`) | — | `Settings`, `Server`, `Sun`/`Moon` — already present | existing `border-top` on the update block |
| Pane header (`.pane-menu-dropdown`) | — | `Play` (Inject), `FileText` (Log), `Square` (Stop), `RotateCw` (Restart), `Layers` (Run in background / Open pane), `Trash2` (Delete session) | 1, before Delete session |
| File context (`.right-panel-menu`) | — | `Code` (Open in VS Code), `ArrowUpRight` (Reveal in Folder) | — |

All 15 icon names were verified present in the installed `lucide-react@1.33.0`.

The project header shows the **path**, not the name: the name is already visible
in the row this menu opens from, while the path currently exists only in the
row's `title` tooltip. The header carries `title={<path>}` for the full value.

### Widths

Widening is what stops the rows reading as squat pills:

| surface | before | after |
|---|---|---|
| `.project-menu-dropdown` | 150px | 200px |
| `.sidebar-menu-dropdown` (session base) | 120px | 170px |
| `.sidebar-footer-dropdown` | none — falls back to the base 120px, and its real width was only ever the `160` positioning constant | 200px (`min-width` added) |
| `.pane-menu-dropdown` | 130px | 180px |
| `.right-panel-menu` | 170px | 210px |

**Coupling — must change together.** `Sidebar.tsx` hardcodes `const width = 160`
at two sites (the project menu's and the footer menu's right-edge clamping math).
Those constants must match the new menu widths or the menus mis-position. Extract
a single module-scope `const MENU_WIDTH = 200` used by both sites, with a comment
tying it to the CSS `min-width`, removing the duplicated literal.

## Testing

- **New e2e spec `tests/e2e/menus.spec.ts`** (Playwright launches the real app):
  - project menu: container `border-radius` 10px; every `.menu-item` 32px tall
    with `padding: 0px 10px` and `border-radius` 6px; one `.menu-sep`; a
    `.menu-head` showing the project path; every item contains exactly one `svg`.
  - session menu: rows 32px, one `.menu-sep`, icons present.
  - mode picker (metrics-only surface): rows 32px, container radius 10px, and
    **no** icons and **no** separator — pinning the scope split.
- `npm run build && npm run e2e` — the existing `sidebar-sessions.spec.ts`
  clicks project/session menu items by role and name; the added icons are
  `aria-hidden`, so those accessible names must not change.
- `npm run typecheck`, `npm test`.

## Documentation

- `docs/reference/09-ui-guide.md` — §9.5 Styling: the `--menu-*` tokens, the
  action-menu vs picker split, and the rule that new menus use the shared metrics.
- `src/renderer/AGENTS.md` — the CSS section: the menu metric set, the
  `MENU_WIDTH` ↔ CSS `min-width` coupling.
- `tests/e2e/AGENTS.md` — register `menus.spec.ts`.
- Root `AGENTS.md` — no change (no new dependency, no structural change).
