import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

const TITLE_BAR_HEIGHT = 32
// The OS draws the caption buttons (min/max/close) inside this strip on
// Windows, so its color must equal what the renderer paints next to them:
// `.title-bar-right`'s `background: var(--bg)` (NOT --bg-panel — a leftover
// from when the title bar used the panel surface, which made the button
// cluster visible as a differently-colored block). `window-chrome.test.ts`
// reads styles.css and fails if these two drift apart. WindowChrome only reads
// these when a window is created; they are re-applied live via applyTitleBarTheme.
export type TitleBarTheme = 'dark' | 'light'
const TITLE_BAR_COLORS: Record<TitleBarTheme, { color: string; symbolColor: string }> = {
  dark: { color: '#0a0a0b', symbolColor: '#ffffff' },
  light: { color: '#ffffff', symbolColor: '#1e1e1e' }
}

export function getTitleBarOverlay(theme: TitleBarTheme): { color: string; symbolColor: string } {
  return TITLE_BAR_COLORS[theme]
}

export function applyTitleBarTheme(win: BrowserWindow | null, theme: TitleBarTheme): void {
  if (!win || process.platform !== 'win32') return
  const overlay = getTitleBarOverlay(theme)
  win.setTitleBarOverlay({ ...overlay, height: TITLE_BAR_HEIGHT })
}

export function getWindowChromeOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'win32') {
    const overlay = getTitleBarOverlay('dark')
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...overlay, height: TITLE_BAR_HEIGHT }
    }
  }
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    }
  }
  if (platform === 'linux') {
    return { frame: false }
  }
  return { frame: true }
}
