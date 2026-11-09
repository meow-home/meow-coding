import { describe, expect, it } from 'vitest'
import { decideBrowserShortcut, matchBrowserShortcut, type InputLike } from '../../../src/main/browser/browser-shortcuts'

function input(overrides: Partial<InputLike>): InputLike {
  return { type: 'keyDown', key: '', ...overrides }
}

const platforms = ['win32', 'linux', 'darwin'] as const

describe('matchBrowserShortcut', () => {
  for (const platform of platforms) {
    const mod = platform === 'darwin' ? { meta: true } : { control: true }

    it(`matches the panel shortcuts on ${platform}`, () => {
      expect(matchBrowserShortcut(input({ ...mod, key: '`', code: 'Backquote' }), platform)).toBe('toggle-terminal')
      expect(matchBrowserShortcut(input({ ...mod, shift: true, key: 'B' }), platform)).toBe('toggle-browser')
      expect(matchBrowserShortcut(input({ ...mod, key: 'l' }), platform)).toBe('focus-url')
      expect(matchBrowserShortcut(input({ ...mod, key: 'r' }), platform)).toBe('reload')
      expect(matchBrowserShortcut(input({ ...mod, key: 'R', shift: true }), platform)).toBe('reload')
      expect(matchBrowserShortcut(input({ key: 'F5' }), platform)).toBe('reload')
    })

    it(`leaves the caret keys to the page on ${platform}`, () => {
      // Ctrl+Left moves by word and Cmd+Left to the line start inside a text field.
      expect(matchBrowserShortcut(input({ ...mod, key: 'ArrowLeft' }), platform)).toBeNull()
      expect(matchBrowserShortcut(input({ ...mod, key: 'ArrowRight' }), platform)).toBeNull()
    })

    it(`ignores keyUp and auto-repeat on ${platform}`, () => {
      expect(matchBrowserShortcut(input({ ...mod, key: 'r', type: 'keyUp' }), platform)).toBeNull()
      expect(matchBrowserShortcut(input({ ...mod, key: 'r', isAutoRepeat: true }), platform)).toBeNull()
    })
  }

  it('uses the layout-independent code for backquote', () => {
    // A French layout reports key "²" for the same physical key.
    expect(matchBrowserShortcut(input({ control: true, key: '²', code: 'Backquote' }), 'win32')).toBe('toggle-terminal')
  })

  it('keeps the primary modifier exact', () => {
    expect(matchBrowserShortcut(input({ control: true, key: 'l' }), 'darwin')).toBeNull()
    expect(matchBrowserShortcut(input({ meta: true, key: 'l' }), 'win32')).toBeNull()
    expect(matchBrowserShortcut(input({ control: true, meta: true, key: 'l' }), 'win32')).toBeNull()
  })

  it('requires exact modifiers', () => {
    expect(matchBrowserShortcut(input({ control: true, shift: true, key: 'l' }), 'win32')).toBeNull()
    expect(matchBrowserShortcut(input({ control: true, alt: true, key: 'ArrowLeft' }), 'win32')).toBeNull()
    expect(matchBrowserShortcut(input({ control: true, key: 'r', shift: false }), 'win32')).toBe('reload')
  })

  it('uses Alt+Left/Right for history off darwin', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(matchBrowserShortcut(input({ alt: true, key: 'ArrowLeft' }), platform)).toBe('back')
      expect(matchBrowserShortcut(input({ alt: true, key: 'ArrowRight' }), platform)).toBe('forward')
    }
    expect(matchBrowserShortcut(input({ alt: true, shift: true, key: 'ArrowLeft' }), 'win32')).toBeNull()
    expect(matchBrowserShortcut(input({ alt: true, key: 'ArrowLeft' }), 'darwin')).toBeNull()
  })

  it('adds the macOS bracket navigation', () => {
    expect(matchBrowserShortcut(input({ meta: true, key: '[' }), 'darwin')).toBe('back')
    expect(matchBrowserShortcut(input({ meta: true, key: ']' }), 'darwin')).toBe('forward')
    expect(matchBrowserShortcut(input({ meta: true, key: '[' }), 'win32')).toBeNull()
  })
})

describe('decideBrowserShortcut', () => {
  it('always forwards app shortcuts and blocks the key', () => {
    for (const shieldVisible of [true, false]) {
      expect(decideBrowserShortcut(input({ control: true, key: '`', code: 'Backquote' }), 'win32', shieldVisible))
        .toEqual({ action: 'toggle-terminal', navigate: null, preventDefault: true })
      expect(decideBrowserShortcut(input({ control: true, shift: true, key: 'b' }), 'win32', shieldVisible))
        .toEqual({ action: 'toggle-browser', navigate: null, preventDefault: true })
      expect(decideBrowserShortcut(input({ control: true, key: 'l' }), 'win32', shieldVisible))
        .toEqual({ action: 'focus-url', navigate: null, preventDefault: true })
    }
  })

  it('runs navigation only while the shield is down, but always prevents the default', () => {
    expect(decideBrowserShortcut(input({ control: true, key: 'r' }), 'win32', false))
      .toEqual({ action: null, navigate: 'reload', preventDefault: true })
    expect(decideBrowserShortcut(input({ control: true, key: 'r' }), 'win32', true))
      .toEqual({ action: null, navigate: null, preventDefault: true })
    expect(decideBrowserShortcut(input({ alt: true, key: 'ArrowLeft' }), 'win32', true))
      .toEqual({ action: null, navigate: null, preventDefault: true })
    expect(decideBrowserShortcut(input({ alt: true, key: 'ArrowLeft' }), 'win32', false))
      .toEqual({ action: null, navigate: 'back', preventDefault: true })
  })

  it('does not swallow caret movement in a page field', () => {
    expect(decideBrowserShortcut(input({ control: true, key: 'ArrowLeft' }), 'win32', false))
      .toEqual({ action: null, navigate: null, preventDefault: false })
  })

  it('blocks Ctrl+W from closing the window', () => {
    expect(decideBrowserShortcut(input({ control: true, key: 'w' }), 'win32', false))
      .toEqual({ action: null, navigate: null, preventDefault: true })
    expect(decideBrowserShortcut(input({ meta: true, key: 'w' }), 'darwin', false))
      .toEqual({ action: null, navigate: null, preventDefault: true })
  })

  it('lets ordinary keys through unless the shield is up', () => {
    expect(decideBrowserShortcut(input({ key: 'a' }), 'win32', false).preventDefault).toBe(false)
    expect(decideBrowserShortcut(input({ key: 'a' }), 'win32', true).preventDefault).toBe(true)
  })
})
