/** True when the newest entry or the count changed; an idle drawer must not re-render. */
export function logsChanged<T>(prev: readonly T[], next: readonly T[]): boolean {
  if (prev.length !== next.length) return true
  if (next.length === 0) return false
  return JSON.stringify(prev[prev.length - 1]) !== JSON.stringify(next[next.length - 1])
}

export interface LogPollerDeps {
  fetch: () => Promise<void>
  intervalMs?: number
  isHidden?: () => boolean
  setInterval?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (id: ReturnType<typeof setInterval>) => void
}

/** One timer, no overlapping requests, paused while the document is hidden. */
export class LogPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight = false
  private readonly intervalMs: number
  private readonly setIntervalFn: (cb: () => void, ms: number) => ReturnType<typeof setInterval>
  private readonly clearIntervalFn: (id: ReturnType<typeof setInterval>) => void

  constructor(private readonly deps: LogPollerDeps) {
    this.intervalMs = deps.intervalMs ?? 1500
    // Wrap the globals: calling them as properties of this class loses their receiver.
    this.setIntervalFn = deps.setInterval ?? ((cb, ms) => setInterval(cb, ms))
    this.clearIntervalFn = deps.clearInterval ?? (id => clearInterval(id))
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = this.setIntervalFn(() => void this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) this.clearIntervalFn(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.inFlight || this.deps.isHidden?.()) return
    this.inFlight = true
    try {
      await this.deps.fetch()
    } finally {
      this.inFlight = false
    }
  }
}
