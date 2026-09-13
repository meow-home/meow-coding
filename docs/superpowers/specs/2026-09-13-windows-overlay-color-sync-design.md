# Windows Overlay Color Sync Design Spec

Status: approved

## 1. Overview

The window control cluster (minimize / maximize / close) renders as a differently-colored block against the
rest of the title bar on Windows. Measured on the running app (light theme, 200% display scale, pixels read
from a screen capture): the cluster paints `#f3f3f3` while the title bar next to it paints `#fefefe` (the
`--bg` white plus the app's film grain) — a visible 11/255 step, matching the reported screenshot.

Root cause: on Windows these buttons are **drawn by the OS** (`titleBarOverlay`), so their color comes only
from `TITLE_BAR_COLORS` in `src/main/window-chrome.ts`. That constant still holds the `--bg-panel` values
(`#0f0f11` / `#f3f3f3`) from when the title bar used the panel surface, while `.title-bar-right` moved to
`background: var(--bg)` in commit f865372 (`#0a0a0b` / `#ffffff`). The `.title-bar-controls` / `.title-bar-btn`
rules that earlier attempts edited are never rendered on Windows (`showCustomControls = platform === 'linux'`),
which is why repeated CSS-only "fixes" (f865372, bf21dac) changed nothing on screen.

## 2. Goals & Non-Goals

### Goals
- Make `TITLE_BAR_COLORS` equal the surface the renderer actually paints next to the buttons: `.title-bar-right`
  → `var(--bg)` (`#0a0a0b` dark / `#ffffff` light).
- Keep the two sides from drifting apart again: a unit test reads `styles.css`, resolves the token the
  `.title-bar-right` rule uses, and fails when the overlay constants no longer match it.
- Update the two existing expectations that encoded the stale `#0f0f11` / `#f3f3f3` values.

### Non-Goals
- Changing the title bar surface itself, or the Linux custom-drawn controls.
- Changing `TITLE_BAR_HEIGHT` (32): with the colors equal, the 2px difference to the 34px CSS bar is invisible
  (verified: the band below the strip reads `#fcfcfc` next to a `#ffffff` strip).
- Any new IPC: the renderer keeps sending `'dark' | 'light'`.

## 3. Detailed Component & Styling Design

`src/main/window-chrome.ts`:

```ts
const TITLE_BAR_COLORS: Record<TitleBarTheme, { color: string; symbolColor: string }> = {
  dark: { color: '#0a0a0b', symbolColor: '#ffffff' },
  light: { color: '#ffffff', symbolColor: '#1e1e1e' }
}
```

`tests/unit/window-chrome.test.ts` gains a block that parses `styles.css` (comment-stripped, same technique as
`session-panes.test.ts`), finds the `.title-bar-right` rule holding a `background: var(--token)`, resolves that
token from `:root` and `[data-theme="light"]`, and asserts the overlay color equals each. Reading the token
instead of hardcoding hex keeps the test honest if the palette changes.

## 4. Verification & Testing

- `npm run typecheck` and `npm test` pass.
- Pixel check on a real window (isolated instance, `MEOW_USER_DATA` temp profile, both themes): the caption
  strip's most common color must match the app title bar's within 2/255. Before: `#f3f3f3` vs `#fefefe`
  (diff 11). After: `#ffffff` vs `#fefefe` (diff 1) in light, `#0a0a0b` vs `#0c0c0d` (diff 2) in dark.
