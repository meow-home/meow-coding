import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Files panel sits 0.333333rem away from every edge of `.main` (`.docked`'s
// margin, `.full`'s inset), and whatever is outside `.main` — the title bar above,
// the status bar below — is NOT its backdrop. A box-shadow bleeds blur / 2 plus its
// own offset past the element box, so the panel's shadow has to fade out inside that
// clearance; a `--shadow-2`/`--shadow-3`-sized shadow would smear onto the app chrome.
// The values are read from styles.css instead of being duplicated here: the invariant
// is the two numbers agreeing, not a frozen snapshot of one of them.
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

/** Token value, read from the theme block that declares it (dark = `:root`). */
function tokenValue(themeSelector: string, token: string): string {
  const match = ruleBody(themeSelector).match(new RegExp(`${token}:\\s*([^;]+);`))
  expect(match, `${themeSelector} does not declare ${token}`).not.toBeNull()
  return match![1].trim()
}

/** Leading rem lengths of a shadow value, in order (offset-x/offset-y/blur/spread).
 *  Unitless entries are only ever the literal `0`, which needs no scaling — so a
 *  0.5rem blur stays proportional to the rem-based gap at any font size. */
function lengths(value: string): number[] {
  const found: number[] = []
  for (const token of value.trim().split(/\s+/)) {
    const match = /^(-?[\d.]+)(rem)?$/.exec(token)
    if (!match) break
    found.push(match[2] ? Number(match[1]) : 0)
  }
  return found
}

function shadowToken(themeSelector: string): number[] {
  const values = lengths(tokenValue(themeSelector, '--shadow-panel'))
  expect(values.length, '--shadow-panel is not an offset-x/offset-y/blur list').toBe(3)
  return values
}

function gap(): number {
  return lengths(/margin:\s*([\d.]+rem)/.exec(ruleBody('.files-overlay.docked'))![1])[0]
}

describe('Files panel shadow', () => {
  it('keeps the painted blur inside the gap between the panel and .main', () => {
    const [, offsetY, blur] = shadowToken(':root')
    // A shadow's blur radius fades over `blur`, extending blur / 2 outside the box.
    expect(blur / 2 + offsetY).toBeLessThanOrEqual(gap())
  })

  it('declares the shadow token in both themes, or box-shadow resolves to none', () => {
    expect(shadowToken('[data-theme="light"]').length).toBe(3)
  })

  it('lifts the docked panel off the chat surface behind it', () => {
    // The panel and the chat behind it are both `--bg-chat`: the shadow and the
    // hairline border are the only things separating them.
    expect(ruleBody('.files-overlay').replace(/\s+/g, '')).toContain('box-shadow:var(--shadow-panel)')
  })

  it('paints the expanded panel shadow on top of the opaque backdrop ring', () => {
    const body = ruleBody('.files-overlay.full')
    const layers = /box-shadow:\s*([^,]+),\s*(.+?);/.exec(body)
    expect(layers, '.files-overlay.full has no two-layer box-shadow').not.toBeNull()
    // First in the list paints on top: the opaque ring stays behind the shadow, so the
    // pane chrome it hides cannot show through the shadow's faded outer edge.
    expect(layers![1]).toContain('var(--shadow-panel)')
    expect(layers![2]).toContain('var(--bg-chat)')
    // The ring has to cover the whole gap, or the chrome peeks past its edge.
    expect(lengths(layers![2])[3]).toBe(gap())
  })
})
