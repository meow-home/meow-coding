export type BrowserShortcutAction =
  | 'toggle-terminal'
  | 'toggle-browser'
  | 'focus-url'
  | 'reload'
  | 'back'
  | 'forward'

export interface InputLike {
  type: string
  key: string
  code?: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  isAutoRepeat?: boolean
}

export interface ShortcutDecision {
  /** Forwarded to the renderer. */
  action: BrowserShortcutAction | null
  /** Run on the host (only when the shield is not visible). */
  navigate: BrowserShortcutAction | null
  preventDefault: boolean
}

function isDarwin(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/** The platform's primary modifier is exact: Cmd on darwin, Ctrl elsewhere. */
function primary(input: InputLike, platform: NodeJS.Platform): boolean {
  const cmd = input.meta === true
  const ctrl = input.control === true
  return isDarwin(platform) ? cmd && !ctrl : ctrl && !cmd
}

export function matchBrowserShortcut(
  input: InputLike,
  platform: NodeJS.Platform = process.platform
): BrowserShortcutAction | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null
  const mod = primary(input, platform)
  const shift = input.shift === true
  const alt = input.alt === true
  if (alt || (input.control === true && isDarwin(platform)) || (input.meta === true && !isDarwin(platform))) {
    return null
  }
  const key = input.key.toLowerCase()

  // Layout independent: `key` changes with the keyboard layout, `code` does not.
  if (mod && !shift && (input.code === 'Backquote' || input.key === '`')) return 'toggle-terminal'
  if (mod && shift && key === 'b') return 'toggle-browser'
  if (mod && !shift && key === 'l') return 'focus-url'
  if (mod && !shift && key === 'r') return 'reload'
  if (key === 'f5') return 'reload'
  if (mod && shift && key === 'r') return 'reload'
  if (mod && !shift && !alt && input.key === 'ArrowLeft') return 'back'
  if (mod && !shift && !alt && input.key === 'ArrowRight') return 'forward'
  if (isDarwin(platform) && mod && !shift && input.key === '[') return 'back'
  if (isDarwin(platform) && mod && !shift && input.key === ']') return 'forward'
  return null
}

/** Ctrl+W would close the whole app window from inside a page: block it, do not forward. */
export function isBlockedAppShortcut(input: InputLike, platform: NodeJS.Platform = process.platform): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false
  return primary(input, platform) && input.shift !== true && input.key.toLowerCase() === 'w'
}

/**
 * The order is deliberate: app shortcuts always work; page navigation only while
 * the agent's shield is down; everything else is left to the page.
 */
export function decideBrowserShortcut(
  input: InputLike,
  platform: NodeJS.Platform,
  shieldVisible: boolean
): ShortcutDecision {
  const action = matchBrowserShortcut(input, platform)
  if (action === 'toggle-terminal' || action === 'toggle-browser' || action === 'focus-url') {
    return { action, navigate: null, preventDefault: true }
  }
  if (action === 'reload' || action === 'back' || action === 'forward') {
    return { action: null, navigate: shieldVisible ? null : action, preventDefault: true }
  }
  if (isBlockedAppShortcut(input, platform)) {
    return { action: null, navigate: null, preventDefault: true }
  }
  return { action: null, navigate: null, preventDefault: shieldVisible }
}
