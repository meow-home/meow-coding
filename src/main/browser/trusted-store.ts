import type { TrustedExtension } from '../../shared/browser-types'
import type { JsonStore } from '../json-store'

export class TrustedExtensionStore {
  private items: TrustedExtension[] | null = null

  constructor(private store?: JsonStore<TrustedExtension>) {}

  list(): TrustedExtension[] {
    if (!this.items) this.items = this.store?.load() ?? []
    return this.items
  }

  has(id: string): boolean {
    return this.list().some(e => e.id === id)
  }

  approve(id: string, version?: string): TrustedExtension[] {
    const next = this.list().filter(e => e.id !== id)
    next.push({ id, ...(version ? { version } : {}), approvedAt: Date.now() })
    this.items = next
    this.store?.save(next)
    return next
  }

  revoke(id: string): TrustedExtension[] {
    const next = this.list().filter(e => e.id !== id)
    this.items = next
    this.store?.save(next)
    return next
  }
}
