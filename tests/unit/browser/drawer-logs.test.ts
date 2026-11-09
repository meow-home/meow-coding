import { describe, expect, it, vi } from 'vitest'
import { LogPoller, logsChanged } from '../../../src/renderer/src/components/browser/drawer-logs'

describe('logsChanged', () => {
  it('compares the length and the newest entry', () => {
    expect(logsChanged([], [])).toBe(false)
    expect(logsChanged([{ a: 1 }], [{ a: 1 }])).toBe(false)
    expect(logsChanged([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toBe(true)
    expect(logsChanged([{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 3 }])).toBe(true)
  })
})

describe('LogPoller', () => {
  it('does not overlap requests', async () => {
    let release: () => void = () => {}
    let calls = 0
    const fetch = vi.fn(() => {
      calls++
      return calls === 1 ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve()
    })
    const poller = new LogPoller({ fetch })
    const first = poller.tick()
    await poller.tick()
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    await first
    await poller.tick()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('pauses while the document is hidden', async () => {
    const fetch = vi.fn(async () => {})
    const poller = new LogPoller({ fetch, isHidden: () => true })
    await poller.tick()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('runs one timer and stops it', () => {
    const ids: Array<ReturnType<typeof setInterval>> = []
    const cleared: Array<ReturnType<typeof setInterval>> = []
    const fetch = vi.fn(async () => {})
    const poller = new LogPoller({
      fetch,
      intervalMs: 100,
      setInterval: cb => {
        const id = setInterval(cb, 100_000)
        ids.push(id)
        return id
      },
      clearInterval: id => {
        cleared.push(id)
        clearInterval(id)
      }
    })
    poller.start()
    poller.start()
    expect(ids).toHaveLength(1)
    poller.stop()
    expect(cleared).toHaveLength(1)
    poller.stop()
    expect(cleared).toHaveLength(1)
  })
})
