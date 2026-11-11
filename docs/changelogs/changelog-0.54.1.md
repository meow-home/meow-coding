# Changelog — Meow Coding v0.54.0 → v0.54.1

## 🚀 New Features

### Right-hand panels fill the grid
- Docking three panels no longer leaves an empty cell: the grid now fills column by column and each column spreads its panels over the rows, so a short column's panel stretches over the rows the others left (two stacked on the left, the third spanning the right column).
- A new row splitter appears wherever a column holds two or more panels — one per column that really splits, so a spanning panel has none. Dragging it trades height between the two neighbours, each keeping at least 6rem, and the split resets to equal heights when the number of rows changes.

## 🧹 Internal & Docs
- New `src/renderer/src/right-panels-layout.ts` (pure placement math: `rightPanelsLayout`, `placementStyle`, `rightPanelsRowSplits`, `evenRowFractions`), unit-tested in `tests/unit/right-panels-layout.test.ts`.
- `tests/e2e/right-panels-full.spec.ts` now pins the three-panel layout (no empty cell, spanning panel, splitter drag); the reference UI guide and the renderer `AGENTS.md` describe the new grid.
