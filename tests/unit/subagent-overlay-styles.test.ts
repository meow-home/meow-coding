import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function stylesheetRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(s => s.trim()),
    body
  }))
}

function ruleBody(selector: string): string {
  const rule = stylesheetRules().find(r => r.selectors.includes(selector))
  expect(rule, `styles.css has no ${selector} rule`).toBeDefined()
  return rule!.body
}

describe('Subagent Overlay CSS', () => {
  it('is a flush surface, like every other right-side panel', () => {
    const body = ruleBody('.subagent-overlay')
    expect(body).toContain('background: var(--bg-chat)')
    expect(body).not.toContain('border-radius')
    expect(body).not.toContain('box-shadow')
  })

  it('defines .subagent-overlay.full rule', () => {
    const body = ruleBody('.subagent-overlay.full')
    expect(body).toContain('position: absolute')
  })

  it('lets .subagent-overlay.full cover the pane area edge to edge', () => {
    // A `.full` panel is a direct child of `.main`, so its absolute insets resolve
    // against the whole pane area. It must sit on every edge (no gap ring), and it is
    // only correct relative to `.main` — inside the positioned
    // `.right-panels-container` these same numbers would confine the panel to the
    // docked column instead. The e2e `right-panels-full.spec.ts` guards that
    // containment; this guards the insets.
    const body = ruleBody('.subagent-overlay.full')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(new RegExp(`${side}:\\s*0;`).test(body), `.subagent-overlay.full has a non-zero ${side} inset`).toBe(true)
    }
  })
})
