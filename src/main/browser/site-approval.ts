import { isLoopback } from '../../shared/loopback'

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
