import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyTitleBarTheme, getWindowChromeOptions } from '../../src/main/window-chrome'

// The Windows caption buttons are drawn by the OS (titleBarOverlay), not by the
// renderer: `.title-bar-controls` / `.title-bar-btn` only exist on Linux
// (`showCustomControls = platform === 'linux'`). So their color lives ONLY in
// TITLE_BAR_COLORS, and it must equal the background the title bar actually
// paints next to them — otherwise the min/max/close cluster shows up as a
// differently-colored block (recoloring the CSS can never fix that).
//
// The invariant is read from styles.css instead of duplicated here: whatever
// `background: var(--x)` the `.title-bar-right` rule uses, the overlay must
// resolve to that same token in both themes.
function stylesheetRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(s => s.trim()),
    body
  }))
}

function titleBarSurfaceToken(): string {
  const rule = stylesheetRules().find(
    r => r.selectors.includes('.title-bar-right') && /background:\s*var\(/.test(r.body)
  )
  expect(rule, 'styles.css has no `.title-bar-right` rule with a background var()').toBeDefined()
  const match = rule!.body.match(/background:\s*var\((--[\w-]+)\)/)
  expect(match, '.title-bar-right background is not a var() token').not.toBeNull()
  return match![1]
}

function tokenValue(selector: string, token: string): string {
  const rule = stylesheetRules().find(r => r.selectors.includes(selector) && r.body.includes(`${token}:`))
  expect(rule, `styles.css has no ${selector} rule declaring ${token}`).toBeDefined()
  return rule!.body.match(new RegExp(`${token}:\\s*([^;]+);`))![1].trim()
}

describe('getWindowChromeOptions', () => {
  it('uses a hidden title bar with a colored overlay on Windows', () => {
    const opts = getWindowChromeOptions('win32')
    expect(opts.titleBarStyle).toBe('hidden')
    expect(opts.titleBarOverlay).toEqual({ color: '#0a0a0b', symbolColor: '#ffffff', height: 32 })
    expect(opts.frame).toBeUndefined()
  })

  it('insets native traffic lights without recoloring them on macOS', () => {
    const opts = getWindowChromeOptions('darwin')
    expect(opts.titleBarStyle).toBe('hiddenInset')
    expect(opts.trafficLightPosition).toEqual({ x: 12, y: 10 })
    expect(opts.titleBarOverlay).toBeUndefined()
  })

  it('removes the native frame entirely on Linux for custom-drawn controls', () => {
    const opts = getWindowChromeOptions('linux')
    expect(opts.frame).toBe(false)
    expect(opts.titleBarStyle).toBeUndefined()
  })

  it('falls back to the default native frame on unrecognized platforms', () => {
    const opts = getWindowChromeOptions('aix')
    expect(opts.frame).toBe(true)
  })
})

describe('applyTitleBarTheme', () => {
  it('sets the overlay to the light palette for light mode', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'light')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({ color: '#ffffff', symbolColor: '#1e1e1e', height: 32 })
  })

  it('sets the overlay to the dark palette for dark mode', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'dark')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({ color: '#0a0a0b', symbolColor: '#ffffff', height: 32 })
  })

  it('does nothing on non-Windows platforms', () => {
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'linux' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'light')
    expect(setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('does nothing when the window is null', () => {
    vi.stubGlobal('process', { platform: 'win32' })
    expect(() => applyTitleBarTheme(null, 'light')).not.toThrow()
  })
})

describe('Windows overlay color tracks the title bar surface', () => {
  it('creates the window with the dark title bar surface as the overlay color', () => {
    const surface = tokenValue(':root', titleBarSurfaceToken())
    expect(getWindowChromeOptions('win32').titleBarOverlay).toMatchObject({ color: surface })
  })

  it('recolors the overlay to the light title bar surface when the theme is light', () => {
    const surface = tokenValue('[data-theme="light"]', titleBarSurfaceToken())
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'light')
    expect(setTitleBarOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ color: surface })
    )
  })

  // The renderer reserves 11.5rem for the caption strip, but the OS paints its
  // strip ~0.5px narrower, so a sliver of the renderer shows through right
  // beside the buttons. `.title-bar` used to be transparent there, which
  // exposed `body`'s radial gradient (#f6f6f6 next to a #ffffff strip) as a 1px
  // line. Painting the bar with the same surface as the strip keeps it invisible.
  it('paints the title bar with the same surface as the reserved caption strip', () => {
    const rule = stylesheetRules().find(r => r.selectors.includes('.title-bar') && /background:/.test(r.body))
    expect(rule, 'styles.css has no `.title-bar` background rule').toBeDefined()
    expect(rule!.body).toMatch(new RegExp(`background:\\s*var\\(${titleBarSurfaceToken()}\\)`))
  })

  it('recolors the overlay to the dark title bar surface when the theme is dark', () => {
    const surface = tokenValue(':root', titleBarSurfaceToken())
    const setTitleBarOverlay = vi.fn()
    vi.stubGlobal('process', { platform: 'win32' })
    applyTitleBarTheme({ setTitleBarOverlay } as never, 'dark')
    expect(setTitleBarOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ color: surface })
    )
  })
})
