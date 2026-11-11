// Grid placement for the docked right-hand panels (Files, Tasks, Browser, Terminal,
// Sub-agents, Git).
//
// The cells are filled column by column and the panels of one column share the rows
// between them, so a column is never left half empty: with three panels the first two
// stack in the left column and the third spans both rows of the right column, instead
// of sitting in the top cell with an empty cell underneath. Columns take the panels
// evenly (earlier columns take the odd one out).

export interface RightPanelPlacement {
  /** 1-based grid column. */
  col: number
  /** 1-based first grid row. */
  row: number
  rowSpan: number
}

export interface RightPanelsLayout {
  cols: number
  rows: number
  /** One placement per panel, in the order the panels are rendered. */
  placements: RightPanelPlacement[]
}

const EMPTY: RightPanelsLayout = { cols: 0, rows: 0, placements: [] }

export function rightPanelsLayout(count: number): RightPanelsLayout {
  if (!Number.isFinite(count) || count < 1) return EMPTY
  const panels = Math.floor(count)
  const rows = Math.ceil(Math.sqrt(panels))
  const cols = Math.ceil(panels / rows)
  const perColumn = Math.floor(panels / cols)
  const tallerColumns = panels % cols
  const placements: RightPanelPlacement[] = []
  for (let col = 1; col <= cols; col++) {
    const items = perColumn + (col <= tallerColumns ? 1 : 0)
    // Spread this column's panels over its rows: the earlier ones take the extra row.
    const spanBase = Math.floor(rows / items)
    const widerPanels = rows % items
    let row = 1
    for (let i = 0; i < items; i++) {
      const rowSpan = spanBase + (i < widerPanels ? 1 : 0)
      placements.push({ col, row, rowSpan })
      row += rowSpan
    }
  }
  return { cols, rows, placements }
}

export function placementStyle(placement: RightPanelPlacement): { gridColumn: string; gridRow: string } {
  return { gridColumn: `${placement.col}`, gridRow: `${placement.row} / span ${placement.rowSpan}` }
}

/** Internal row boundaries, one handle per column that really splits there. */
export function rightPanelsRowSplits(layout: RightPanelsLayout): { row: number; col: number }[] {
  const splits: { row: number; col: number }[] = []
  for (let row = 1; row < layout.rows; row++) {
    for (let col = 1; col <= layout.cols; col++) {
      if (layout.placements.some(p => p.col === col && p.row === row + 1)) splits.push({ row, col })
    }
  }
  return splits
}

/** Equal row fractions, the starting point of a drag-resized column split. */
export function evenRowFractions(rows: number): number[] {
  if (rows < 1) return []
  return Array.from({ length: rows }, () => 1 / rows)
}
