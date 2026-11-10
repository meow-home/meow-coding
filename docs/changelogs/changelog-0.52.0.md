# Changelog — Meow Coding v0.51.0 → v0.52.0

## 🚀 New Features

### A mascot that lives on the composer
- The logo's cat head now sits on the chat input card: 36px, perched on the top border at the right end, with two round eyes and a small swaying tail. It is decoration only — `aria-hidden`, never focusable, and it never gets between you and the field.
- Nine moods follow the turn and the keyboard: **idle** (breathe, blink, ear twitch), **look** on hover, **think** while a turn waits for its first token, **type** while it streams, **sleep** after 45 s without activity, **happy** when a turn finishes or you click it (a small burst of hearts), **notify** when a prompt arrives or a turn lands while the window is in the background, **error** when a turn fails, and a squash while you hold it.
- **Calico** colourway: cream body, a charcoal patch over the left ear, an orange one over the right, blue eyes and an orange-brown mouth. It reads on both themes — the dark patch holds the silhouette on the light card, the warm one keeps it alive on the dark one.
- Every colour is a custom property on `.meow-pet` (shell stops, rim, eyes, mouth, patches, feet/tail), so another colourway is a single CSS block and the light theme can override the rim without touching the SVG.

### Design gallery for the mascot
- `docs/design/desktop-pet/` keeps the exploration: three head shapes, eleven looping moods on a mock desktop, and a colourway page that renders eight palettes on both composer surfaces with a measured contrast readout.

### Floating menus keep a faint rim
- Menus draw a 1px `--menu-border` rim, a step fainter than `--hairline`, so their edge stays defined over the chat surface without reading as an outline.

## 🐛 Bug Fixes
- Agent: the todo list is now kept up to date per item. `todowrite` refuses items that only wait on the user, restates the per-item rule and flags several items completed in one update, the stale-list nudge names the open items, and a list left open by an earlier turn is restated in the turn context — so turns no longer end with a single "wait for review" item hanging in progress.

## 🧹 Internal & Docs
- New `MeowPet` component (the logo path with softened ear tips, a CSS-variable palette, moods driven by `data-mood`) with `tests/unit/meow-pet.test.tsx` covering blink, sleep/wake, one-shot revert and pick-up vs click.
- `ChatPanel` owns the mascot's one-shot `petEvent` and the per-turn `turnOutput` flag — one state flip per turn, not per delta, so streaming never re-renders the panel for the pet.
- Reference docs (§9.5 and the component tables), the chat `AGENTS.md`, and the desktop-pet design README updated alongside.
