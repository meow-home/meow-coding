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
  it('defines .subagent-overlay rule with box-shadow: var(--shadow-panel)', () => {
    const body = ruleBody('.subagent-overlay')
    expect(body).toContain('box-shadow:')
    expect(body).toContain('var(--shadow-panel)')
  })

  it('defines .subagent-overlay.full rule', () => {
    const body = ruleBody('.subagent-overlay.full')
    expect(body).toContain('position: absolute')
  })

  it('insets .subagent-overlay.full by the same gap on every edge', () => {
    // A `.full` panel is a direct child of `.main`, so its absolute insets resolve
    // against the whole pane area. An asymmetric inset (e.g. a wider `right`) would
    // pull it away from the pane edge it must cover, and it is only correct relative
    // to `.main` — inside the positioned `.right-panels-container` these same numbers
    // would confine the panel to the docked column instead. The e2e
    // `right-panels-full.spec.ts` guards that containment; this guards the insets.
    const body = ruleBody('.subagent-overlay.full')
    const insets = ['top', 'right', 'bottom', 'left'].map(side => {
      const match = new RegExp(`${side}:\\s*([\\d.]+rem)`).exec(body)
      expect(match, `.subagent-overlay.full has no ${side} inset`).not.toBeNull()
      return match![1]
    })
    expect(new Set(insets).size).toBe(1)
  })
})
