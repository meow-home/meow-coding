const MAIN_FRAME_PROTOCOLS = new Set(['http:', 'https:', 'file:'])
const SUBFRAME_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:'])

function isAboutBlank(url: string): boolean {
  return url === 'about:blank' || url.startsWith('about:blank#')
}

/**
 * What the built-in browser may navigate to. The main frame allows web,
 * local files (`file:`), and standard document/data protocols.
 */
export function isAllowedNavigation(url: string, isMainFrame: boolean): boolean {
  if (isAboutBlank(url)) return true
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return false
  }
  if (isMainFrame) {
    if (protocol === 'about:') return false
    return MAIN_FRAME_PROTOCOLS.has(protocol)
  }
  if (protocol === 'about:') return url === 'about:srcdoc'
  return SUBFRAME_PROTOCOLS.has(protocol)
}
