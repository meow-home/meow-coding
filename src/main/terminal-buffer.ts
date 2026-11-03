export class ScrollbackBuffer {
  private chunks: string[] = []
  private totalLength = 0
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = Math.max(0, maxBytes)
  }

  append(s: string): void {
    if (!s || this.maxBytes === 0) return
    this.chunks.push(s)
    this.totalLength += s.length

    while (this.chunks.length > 0 && this.totalLength - this.chunks[0].length >= this.maxBytes) {
      this.totalLength -= this.chunks[0].length
      this.chunks.shift()
    }

    if (this.totalLength > this.maxBytes && this.chunks.length > 0) {
      const oldest = this.chunks[0]
      let dropCount = this.totalLength - this.maxBytes
      if (dropCount < oldest.length) {
        const code = oldest.charCodeAt(dropCount)
        if (code >= 0xdc00 && code <= 0xdfff) {
          dropCount++
        }
      }
      if (dropCount >= oldest.length) {
        this.totalLength -= oldest.length
        this.chunks.shift()
      } else {
        this.chunks[0] = oldest.slice(dropCount)
        this.totalLength -= dropCount
      }
    }
  }

  snapshot(): string {
    return this.chunks.join('')
  }

  clear(): void {
    this.chunks = []
    this.totalLength = 0
  }
}

export interface BatcherTimers {
  setTimeout: (fn: () => void, ms: number) => any
  clearTimeout: (id: any) => void
}

const DEFAULT_TIMERS: BatcherTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id)
}

export class OutputBatcher {
  private readonly flush: (s: string) => void
  private readonly intervalMs: number
  private readonly maxBytes: number
  private readonly timers: BatcherTimers
  private buffer: string[] = []
  private pendingBytes = 0
  private timerId: any = null
  private disposed = false

  constructor(
    flush: (s: string) => void,
    intervalMs: number,
    maxBytes: number,
    timers: BatcherTimers = DEFAULT_TIMERS
  ) {
    this.flush = flush
    this.intervalMs = intervalMs
    this.maxBytes = Math.max(1, maxBytes)
    this.timers = timers
  }

  push(s: string): void {
    if (this.disposed || !s) return
    this.buffer.push(s)
    this.pendingBytes += s.length

    if (this.pendingBytes >= this.maxBytes) {
      this.flushNow()
      return
    }

    if (this.timerId === null) {
      this.timerId = this.timers.setTimeout(() => {
        this.timerId = null
        this.flushNow()
      }, this.intervalMs)
    }
  }

  flushNow(): void {
    if (this.disposed) return
    if (this.timerId !== null) {
      this.timers.clearTimeout(this.timerId)
      this.timerId = null
    }
    if (this.buffer.length === 0) return
    const data = this.buffer.join('')
    this.buffer = []
    this.pendingBytes = 0
    this.flush(data)
  }

  dispose(): void {
    this.disposed = true
    if (this.timerId !== null) {
      this.timers.clearTimeout(this.timerId)
      this.timerId = null
    }
    this.buffer = []
    this.pendingBytes = 0
  }
}
