const MAIN_FRAME_PROTOCOLS = new Set(['http:', 'https:'])
const SUBFRAME_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:'])

function isAboutBlank(url: string): boolean {
  return url === 'about:blank' || url.startsWith('about:blank#')
}

/**
 * What the built-in browser may navigate to. The main frame is limited to the
 * web; subframes additionally allow the inline documents ordinary sites use
 * (`about:srcdoc`, `blob:`, `data:`) — they still run in the page's sandboxed
 * renderer. `file:` and custom schemes are blocked for both.
 */
export function isAllowedNavigation(url: string, isMainFrame: boolean): boolean {
  if (isAboutBlank(url)) return true
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return false
  }
  if (isMainFrame) return MAIN_FRAME_PROTOCOLS.has(protocol)
  if (protocol === 'about:') return url === 'about:srcdoc'
  return SUBFRAME_PROTOCOLS.has(protocol)
}
