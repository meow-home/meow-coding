export const DEFAULT_FONT_SIZE = 14
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 40
export const FONT_SIZE_STORAGE_KEY = 'meow.fontSize'

/** Round to an integer and clamp to the allowed range (8–40px). */
export function clampFontSize(size: number): number {
  if (Number.isNaN(size)) return DEFAULT_FONT_SIZE
  const rounded = Math.round(size)
  if (rounded < MIN_FONT_SIZE) return MIN_FONT_SIZE
  if (rounded > MAX_FONT_SIZE) return MAX_FONT_SIZE
  return rounded
}

/** Parse a raw localStorage string; fall back to the default when invalid. */
export function parseFontSize(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_FONT_SIZE
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE
  return clampFontSize(n)
}

/** Read the current size from localStorage (default 14). */
export function getFontSize(): number {
  return parseFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
}

/**
 * Apply the size to <html> (and force <body> to follow the root). Every
 * surviving consumer reflows off the root font-size, so no change event is
 * needed; `watchFontSize` covers the cross-window case via `storage`.
 */
export function applyFontSize(size?: number): number {
  const resolved = clampFontSize(size ?? getFontSize())
  document.documentElement.style.fontSize = `${resolved}px`
  document.body.style.fontSize = '1rem'
  return resolved
}

/** Persist to localStorage and apply. Returns the resolved (clamped) size. */
export function setFontSize(size: number): number {
  const resolved = clampFontSize(size)
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(resolved))
  return applyFontSize(resolved)
}

/** Re-apply on `storage` events (other renderers/popups). */
export function watchFontSize(onChange?: (size: number) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== FONT_SIZE_STORAGE_KEY) return
    const size = applyFontSize()
    onChange?.(size)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
