import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every floating menu (dropdowns, pickers, context popover, command palette, branch
// switcher) carries no outline any more: a 1px hairline read as a hard border against
// the panels. Without it the menu's own surface has to sit above the app's surfaces in
// BOTH themes, which is what `--bg-menu` is for.

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
  it('paint the menu surface and carry no outline', () => {
    for (const selector of MENU_SURFACES) {
      const body = ruleBody(selector)
      expect(body, `${selector} does not use --bg-menu`).toContain('background: var(--bg-menu)')
      expect(body, `${selector} still draws a border`).not.toMatch(/border:\s*0\.083333rem/)
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
