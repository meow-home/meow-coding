# Row-First Multi-Panel Grid Layout Design

## Goal
Change the right-side multi-panel (Files, Processes, Subagents) dynamic grid calculation in `App.tsx` from column-first priority to row-first priority. When 2 panels (e.g. Files and Processes) are open simultaneously, they will stack vertically (top and bottom, 1 column x 2 rows) instead of splitting horizontally (left and right, 2 columns x 1 row), preserving chat pane width while maximizing panel visibility.

## Layout Specification & Grid Math

For $N$ open right-side panels:
- `rows = Math.ceil(Math.sqrt(N))`
- `cols = Math.ceil(N / rows)`

### Grid Dimension Matrix
| Open Panels ($N$) | Rows | Columns | Grid Layout Behavior |
| :--- | :--- | :--- | :--- |
| **1** | 1 | 1 | 1 panel occupying 100% of container |
| **2** | 2 | 1 | 2 panels stacked vertically (Top / Bottom) |
| **3** | 2 | 2 | 2 rows, 2 columns (Top: 2 panels, Bottom: 1 panel) |
| **4** | 2 | 2 | 2x2 grid |
| **5** | 3 | 2 | 3 rows, 2 columns |

## Container Width Calculation
- Container width formula: `containerWidth = Math.max(rightPanelsWidth, cols * 360)`
- When $N = 2$, `cols = 1`, so `containerWidth = rightPanelsWidth` (default 420px), preventing unnecessary horizontal expansion of the side container over the active session chat area.

## Affected Components
- `src/renderer/src/App.tsx`: Update `rows` and `cols` calculation in the right-panels container render block inside `<main>`.
- `docs/reference/09-ui-and-layout.md`: Update layout reference documentation if needed.

## Testing Strategy
- Run `npm run typecheck` to verify TypeScript compliance.
- Run `npm test` to ensure zero regression across unit and integration tests.
