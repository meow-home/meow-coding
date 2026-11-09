/**
 * Local origins never need approval. Compare the parsed hostname, never the raw
 * string: `localhost.example.com`, `127.0.0.1.example.com`, `http://localhost@evil.example`
 * and a trailing-dot `localhost.` must not be mistaken for loopback.
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

/** Session-scoped approvals, keyed by tab owner (a subagent shares its parent's). */
export class SiteApprovals {
  private readonly byOwner = new Map<string, Set<string>>()

  isAllowed(owner: string, origin: string): boolean {
    return this.byOwner.get(owner)?.has(origin) ?? false
  }

  allow(owner: string, origin: string): void {
    const origins = this.byOwner.get(owner) ?? new Set<string>()
    origins.add(origin)
    this.byOwner.set(owner, origins)
  }

  clearOwner(owner: string): void {
    this.byOwner.delete(owner)
  }
}
