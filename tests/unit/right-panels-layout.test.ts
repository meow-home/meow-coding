import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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
    expect(body).toContain('gap: 0.083333rem')
    expect(body).toContain('padding: 0 0 0 0.083333rem')
    expect(body).toContain('background: var(--hairline)')
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
      'components/processes/ProcessesOverlay.tsx',
      'components/chat/SubagentOverlay.tsx'
    ]) {
      expect(source(file), `${file} renders a second resize handle`).not.toContain('files-resizer')
    }
  })
})
