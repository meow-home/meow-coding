const LOOPBACK_HOST = /^localhost(:\d+)?$|^127(\.\d{1,3}){3}(:\d+)?$|^\[::1\](:\d+)?$/i
const LOOPBACK_BARE = /^localhost$|^127(\.\d{1,3}){3}$|^\[::1\]$/i
const FILE_EXT_REGEX = /\.(html|htm|js|jsx|ts|tsx|css|json|md|txt|pdf|png|jpg|jpeg|svg|gif|xml|yaml|yml|csv|tsv|zip|tar|gz|jsonl|py|ico|woff|woff2|ttf|eot)$/i

/**
 * Turns the URL field into a valid URL or file path.
 * Supports http, https, file, about, data, blob, and local file paths.
 */
export function normalizeUrlInput(text: string): string | null {
  const value = text.trim()
  if (!value) return null

  if (value.includes(' ') && !value.includes('\\') && !value.startsWith('/') && !value.startsWith('./') && !value.startsWith('../') && !/^[a-zA-Z]:[/\\]/.test(value)) {
    return null
  }

  if (/^(https?|file|about|data|blob):\/\//i.test(value) || /^about:/i.test(value)) {
    try {
      new URL(value)
      return value
    } catch {
      return null
    }
  }

  if (value.includes('://')) return null

  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    /^[a-zA-Z]:[/\\]/.test(value) ||
    FILE_EXT_REGEX.test(value)
  ) {
    return value
  }

  const host = value.split(/[/?#]/)[0]
  const bare = host.replace(/:\d+$/, '')
  const plausible = /^localhost$/i.test(bare)
    || /^127(\.\d{1,3}){3}$/.test(bare)
    || /^\[::1\]$/.test(bare)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare)

  if (!plausible) {
    return null
  }

  const isLoopback = LOOPBACK_HOST.test(host) || LOOPBACK_BARE.test(bare)
  return `${isLoopback ? 'http' : 'https'}://${value}`
}
