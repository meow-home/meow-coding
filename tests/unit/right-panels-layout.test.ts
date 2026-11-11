import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evenRowFractions, placementStyle, rightPanelsLayout, rightPanelsRowSplits } from '../../src/renderer/src/right-panels-layout'

// The right-hand panels are one flush surface, not floating cards: the docked grid
// has no padding/gap and draws its hairlines with its own background showing through
// 1px gaps, and a maximized panel covers the pane area edge to edge. A native page
// view (the Browser panel) cannot be clipped by a CSS radius, so a rounded card was
// never consistent across panels. These assertions read styles.css instead of
// freezing a screenshot, so the invariant is "square and flush", not one exact value.

function stylesheetRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[^;]+;/g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(s => s.trim()),
    body
  }))
}

function ruleBody(selector: string): string {
  const rule = stylesheetRules().find(r => r.selectors.includes(selector))
  expect(rule, `styles.css has no ${selector} rule`).toBeDefined()
  return rule!.body.replace(/\s+/g, ' ')
}

function source(file: string): string {
  return readFileSync(resolve(__dirname, '../../src/renderer/src', file), 'utf8')
}

describe('right-side panel layout', () => {
  it('paints a docked panel as a square, borderless, shadowless surface', () => {
    const body = ruleBody('.files-overlay')
    expect(body).not.toContain('border-radius')
    expect(body).not.toContain('border:')
    expect(body).not.toContain('box-shadow')
  })

  it('joins grid cells with a hairline instead of a gutter', () => {
    const body = ruleBody('.right-panels-grid')
    // The grid's own surface shows through the gaps and the left padding: one line
    // between neighbours, one against the chat, nothing at the outer edges.
    expect(body).toContain('gap: var(--panels-gap)')
    expect(body).toContain('padding: 0 0 0 0.083333rem')
    expect(body).toContain('background: var(--hairline)')
    // The gap is one hairline, shared with the row splitter's offset.
    expect(ruleBody('.right-panels-container')).toContain('--panels-gap: 0.083333rem')
  })

  it('lets a maximized panel cover the whole pane area', () => {
    for (const selector of ['.files-overlay.full', '.subagent-overlay.full']) {
      const body = ruleBody(selector)
      for (const side of ['top', 'right', 'bottom', 'left']) {
        expect(body, `${selector} must have a zero ${side} inset`).toContain(`${side}: 0;`)
      }
    }
  })

  it('keeps a single width handle: the column splitter', () => {
    expect(stylesheetRules().some(r => r.selectors.includes('.files-resizer'))).toBe(false)
    for (const file of [
      'components/files/FilesOverlay.tsx',
      'components/processes/TasksPanel.tsx',
      'components/chat/SubagentOverlay.tsx'
    ]) {
      expect(source(file), `${file} renders a second resize handle`).not.toContain('files-resizer')
    }
  })
})

describe('right-side panel grid placement', () => {
  const cells = (count: number): string[] =>
    rightPanelsLayout(count).placements.map(p => `${p.col}:${p.row}+${p.rowSpan}`)

  it('stacks two panels in one column', () => {
    const layout = rightPanelsLayout(2)
    expect([layout.cols, layout.rows]).toEqual([1, 2])
    expect(cells(2)).toEqual(['1:1+1', '1:2+1'])
  })

  it('lets the third panel span both rows of the right column', () => {
    const layout = rightPanelsLayout(3)
    expect([layout.cols, layout.rows]).toEqual([2, 2])
    // No empty cell: the short column's panel stretches over the rows it left.
    expect(cells(3)).toEqual(['1:1+1', '1:2+1', '2:1+2'])
    expect(rightPanelsRowSplits(layout)).toEqual([{ row: 1, col: 1 }])
  })

  it('fills a 2x2 grid with four panels, one cell each', () => {
    expect(cells(4)).toEqual(['1:1+1', '1:2+1', '2:1+1', '2:2+1'])
    expect(rightPanelsRowSplits(rightPanelsLayout(4))).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 }
    ])
  })

  it('never leaves a hole, whatever the count', () => {
    for (let count = 1; count <= 12; count++) {
      const layout = rightPanelsLayout(count)
      expect(layout.placements).toHaveLength(count)
      for (let col = 1; col <= layout.cols; col++) {
        const spans = layout.placements.filter(p => p.col === col)
        // The panels of a column start at row 1 and cover every row exactly once.
        let row = 1
        for (const p of spans) {
          expect(p.row).toBe(row)
          row += p.rowSpan
        }
        expect(row - 1, `${count} panels, column ${col}`).toBe(layout.rows)
      }
    }
  })

  it('places a cell with grid lines and its row span', () => {
    expect(placementStyle({ col: 2, row: 1, rowSpan: 2 })).toEqual({ gridColumn: '2', gridRow: '1 / span 2' })
  })

  it('starts a drag from equal row fractions', () => {
    expect(evenRowFractions(0)).toEqual([])
    expect(evenRowFractions(2)).toEqual([0.5, 0.5])
    expect(evenRowFractions(3).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })
})
