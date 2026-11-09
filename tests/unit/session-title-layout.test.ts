import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The session title sits in the window title bar next to the panel tools, and the pane
// has no header row. A long session name must ellipsize instead of pushing the `⋮`
// under the tools; the title bar's right side keeps its full width.

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
  return rule!.body.replace(/\s+/g, ' ')
}

describe('session title in the title bar', () => {
  it('takes the free space between the brand and the tools', () => {
    const body = ruleBody('.title-bar-session')
    expect(body).toContain('flex: 1 1 auto')
    expect(body).toContain('min-width: 0')
    expect(body).toContain('-webkit-app-region: drag')
  })

  it('lets the session name shrink and ellipsize instead of overflowing', () => {
    const body = ruleBody('.title-bar-session-name')
    expect(body).toContain('min-width: 0')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('text-overflow: ellipsis')
    expect(body).toContain('white-space: nowrap')
  })

  it('keeps the panel tools at their full size', () => {
    expect(ruleBody('.title-bar-right')).toContain('flex: 0 0 auto')
    expect(ruleBody('.title-bar-session .icon-btn')).toContain('flex: 0 0 auto')
  })

  it('shrinks the brand strip when the sidebar is collapsed so the title moves left', () => {
    const body = ruleBody('.title-bar-brand.collapsed')
    expect(body).toContain('width: auto')
  })

  it('has no pane header row', () => {
    expect(stylesheetRules().some(r => r.selectors.includes('.pane-header'))).toBe(false)
  })
})
