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
})
