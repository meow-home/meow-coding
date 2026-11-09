import type { BrowserBackend, BrowserRouterLike } from './browser-backend'

export type BrowserTarget = 'builtin' | 'chrome'

export interface BrowserRouterDeps {
  backends: { builtin?: BrowserBackend; chrome: BrowserBackend }
  /**
   * Read on every resolution, never cached: a settings save changes the default
   * backend for owners that have not made an explicit choice, without a restart.
   */
  defaultBackend: () => BrowserTarget
}

export class BrowserRouter implements BrowserRouterLike {
  private readonly selections = new Map<string, BrowserTarget>()

  constructor(private readonly deps: BrowserRouterDeps) {}

  backendFor(ownerId: string): BrowserBackend {
    const selected = this.selections.get(ownerId)
    if (selected) {
      const backend = this.deps.backends[selected]
      if (backend) return backend
    }
    return this.default()
  }

  select(ownerId: string, target: BrowserTarget): void {
    if (!this.deps.backends[target]) {
      throw new Error(
        target === 'builtin'
          ? 'built-in browser is not available in this build'
          : 'chrome browser backend is not available'
      )
    }
    this.selections.set(ownerId, target)
  }

  private default(): BrowserBackend {
    // Until the built-in backend is wired in, a `builtin` default still resolves to Chrome.
    return this.deps.backends[this.deps.defaultBackend()] ?? this.deps.backends.chrome
  }
}
