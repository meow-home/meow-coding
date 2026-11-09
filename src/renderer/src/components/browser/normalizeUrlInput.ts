const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * Turns the URL field into an http(s) URL. Bare hosts default to https, loopback
 * hosts to http. Anything else (spaces, file:, javascript:, malformed) is null.
 * There is no search-engine fallback.
 */
export function normalizeUrlInput(text: string): string | null {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null

  if (/^https?:\/\//i.test(value)) {
    try {
      new URL(value)
      return value
    } catch {
      return null
    }
  }
  // Any other explicit scheme is not something the panel may navigate to.
  if (value.includes('://')) return null

  const host = value.split(/[/?#]/)[0]
  const bare = host.replace(/:\d+$/, '')
  const plausible = /^localhost$/i.test(bare)
    || /^127(\.\d{1,3}){3}$/.test(bare)
    || /^\[::1\]$/i.test(bare)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare)
  if (!plausible) return null
  return `${LOOPBACK_HOST.test(host) ? 'http' : 'https'}://${value}`
}
