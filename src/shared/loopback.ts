/**
 * Local origins never need approval and their links are safe to open in the panel.
 * Compare the parsed hostname, never the raw string: `localhost.example.com`,
 * `127.0.0.1.example.com`, `http://localhost@evil.example` and a trailing-dot
 * `localhost.` must not be mistaken for loopback.
 */
export function isLoopback(origin: string): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true
  return hostname.length > '.localhost'.length && hostname.endsWith('.localhost')
}
