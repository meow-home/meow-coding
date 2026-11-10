import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every floating menu (dropdowns, pickers, context popover, command palette, branch
// switcher) shares ONE rim: `--menu-border`, a step fainter than `--hairline`. The menu
// keeps an edge against the surface behind it without the border reading as a drawn
// outline; the surface itself still sits above the app's surfaces in BOTH themes, which
// is what `--bg-menu` is for.

const MENU_SURFACES = [
  '.context-panel',
  '.dropdown-menu',
  '.model-menu',
  '.command-menu',
  '.sidebar-menu-dropdown',
  '.right-panel-menu',
  '.git-branch-dropdown'
]

function rules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[^;]+;/g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(s => s.trim()),
    body: body.replace(/\s+/g, ' ')
  }))
}

function ruleBody(selector: string): string {
  const rule = rules().find(r => r.selectors.includes(selector))
  expect(rule, `styles.css has no ${selector} rule`).toBeDefined()
  return rule!.body
}

function token(theme: ':root' | '[data-theme="light"]', name: string): string {
  const rule = rules().find(r => r.selectors.includes(theme) && r.body.includes(`${name}:`))
  expect(rule, `styles.css has no ${name} in ${theme}`).toBeDefined()
  return rule!.body.match(new RegExp(`${name}:\\s*([^;]+);`))![1].trim()
}

describe('floating menu surfaces', () => {
  it('paint the menu surface and carry the faint rim', () => {
    for (const selector of MENU_SURFACES) {
      const body = ruleBody(selector)
      expect(body, `${selector} does not use --bg-menu`).toContain('background: var(--bg-menu)')
      expect(body, `${selector} draws no rim`).toContain('border: 0.083333rem solid var(--menu-border)')
    }
  })

  it('keeps the rim fainter than the default hairline in both themes', () => {
    for (const theme of [':root', '[data-theme="light"]'] as const) {
      const alpha = (value: string) => Number(value.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/)![1])
      expect(alpha(token(theme, '--menu-border')), `${theme} --menu-border is not fainter than --hairline`)
        .toBeLessThan(alpha(token(theme, '--hairline')))
    }
  })

  it('steps above the app surfaces in both themes', () => {
    for (const theme of [':root', '[data-theme="light"]'] as const) {
      const menu = token(theme, '--bg-menu')
      expect(menu, `${theme} --bg-menu equals --bg`).not.toBe(token(theme, '--bg'))
      expect(menu, `${theme} --bg-menu equals --bg-chat`).not.toBe(token(theme, '--bg-chat'))
    }
  })
})
