# Meow desktop pet — design preview

A mascot derived from `meow-coding-logo.svg`: the same rounded-square cat head with the two ear
notches, the same blue prompt chevron and orange cursor. Nothing is redrawn by hand — the head path
is the logo's own path with the ear tips softened and the ears nudged out toward the sides (the razor
point and the tucked-in ears both disappear at 36px), scaled by the SVG `viewBox`, so the pet cannot
drift from the icon.

Open `index.html` in a browser (any static server; the page also works from `file://`).

## Files

| File | Purpose |
|---|---|
| `index.html` | Preview page: three shapes, eleven moods, and a playground on a mock app window. |
| `meow-pet.js` | Standalone component (`window.MeowPet.create(host, opts)`), no dependencies. |
| `meow-pet.css` | All pet styles. Motion is driven by `data-mood` / `data-variant` on the root. |

## Shapes

- **A · Prompt face** — the logo verbatim: the blue chevron is the eye, the orange cursor is the mouth.
  Strongest brand read, but a one-eyed face.
- **B · Round eyes** — two blue eyes with a highlight and an orange smile. Reads as a pet first.
- **C · Terminal head** — a mini window with traffic lights on the head, prompt inside the screen.

**Shipped: B in Calico**, 36px, perched on the input card's top border, 7.5rem in from the right edge
(`src/renderer/src/components/chat/MeowPet.tsx`) — the feet land on the hairline and the shadow falls
on the card. The inset is not cosmetic: the queued-messages card sits right above the input card, and
its send-now / edit / remove block is ~6.2rem wide at the row's trailing edge, so a pet over that
block swallows the clicks. The React component is the implementation; this
folder is the design reference and keeps A and C for comparison. The shipped head gradient is one
step lighter than the preview's, because the composer card (`#1f2123`) is lighter than the stage used
here — the logo's flat `#1b1e23` disappears into it.

## Moods

`idle` · `look` · `walk` · `run` · `type` · `think` · `sleep` · `happy` · `error` · `drag` · `notify`

The composer uses nine of them: `idle` at rest, `look` on hover, `think` while a turn waits for its
first token, `type` while it streams, `sleep` after 45 s without activity, `happy` when a turn
finishes or the pet is clicked, `notify` when a prompt arrives or a turn lands while the window is in
the background, `error` when a turn fails, and `drag` while the pointer is down. Only `walk` / `run`
stay unused — a 30px pet on a border has nowhere to walk.

## Motion rules

- Only the host element translates; moods animate the body box.
- Squash and stretch pivot on a fixed floor point (`transform-origin: 50% 88%`).
- Blink is `scaleY(0.1)` on the eye group for 130 ms, every 2.2–6 s.
- The ear notch is a flat triangle, so a rotate around its base reads as a twitch.
- One-shots (`happy`, `error`, `notify`) revert to the resting mood, so the pet cannot get stuck.
- Everything stops under `prefers-reduced-motion: reduce`.

## If it ever becomes a real desktop pet

- Second `BrowserWindow`: `transparent: true`, `frame: false`, `alwaysOnTop`, `skipTaskbar`,
  `hasShadow: false`, `resizable: false`; position persisted per display under `userData`.
- Click-through outside the silhouette: `setIgnoreMouseEvents(true, { forward: true })`, flipped off
  while the pointer is over the body.
- It must never steal focus from the main window.
