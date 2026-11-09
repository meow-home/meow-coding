import { describe, expect, it } from 'vitest'
import {
  BrowserOcclusionController,
  type FreezeResult,
  type OcclusionDeps
} from '../../../src/renderer/src/components/common/useBrowserOcclusion'

function setup() {
  const calls: string[] = []
  const frames: Array<() => void> = []
  const published: Array<string | null> = []
  let resolveFreeze: ((r: FreezeResult | null) => void) | null = null
  let rejectFreeze: ((e: Error) => void) | null = null
  let freezeCount = 0
  const deps: OcclusionDeps = {
    freeze: () => {
      freezeCount++
      calls.push('freeze')
      return new Promise<FreezeResult | null>((resolve, reject) => {
        resolveFreeze = resolve
        rejectFreeze = reject
      })
    },
    hide: async () => {
      calls.push('hide')
    },
    hideFrozen: async generation => {
      calls.push(`hideFrozen:${generation}`)
    },
    unfreeze: async () => {
      calls.push('unfreeze')
    },
    schedule: cb => {
      frames.push(cb)
      return frames.length
    },
    cancel: () => {},
    publish: image => published.push(image)
  }
  const controller = new BrowserOcclusionController(deps)
  return {
    controller,
    calls,
    published,
    freezeCount: () => freezeCount,
    resolveFreeze: (r: FreezeResult | null) => resolveFreeze?.(r),
    rejectFreeze: (e: Error) => rejectFreeze?.(e),
    flushFrame: () => {
      const cb = frames.shift()
      cb?.()
    }
  }
}

describe('BrowserOcclusionController', () => {
  it('does nothing while no panel is attached', () => {
    const t = setup()
    t.controller.add('menu', 'overlay')
    expect(t.calls).toEqual([])
    expect(t.controller.reasonCount).toBe(1)
    t.controller.setAttached(true)
    expect(t.calls).toEqual(['freeze'])
  })

  it('is order-independent for overlay and cover reasons', async () => {
    const a = setup()
    a.controller.setAttached(true)
    a.controller.add('menu', 'overlay')
    a.controller.add('cover', 'cover')
    expect(a.calls).toEqual(['freeze'])
    a.resolveFreeze({ generation: 3, image: 'data:image/png;base64,xx' })
    await Promise.resolve()
    expect(a.published).toEqual(['data:image/png;base64,xx'])
    a.controller.imagePainted()
    expect(a.calls).toContain('hideFrozen:3')
    a.controller.remove('cover')
    a.controller.remove('menu')
    expect(a.calls).toContain('unfreeze')
    expect(a.controller.reasonCount).toBe(0)
    expect(a.controller.isHidden()).toBe(false)

    const b = setup()
    b.controller.setAttached(true)
    b.controller.add('cover', 'cover')
    b.controller.add('menu', 'overlay')
    b.controller.remove('menu')
    expect(b.calls).not.toContain('unfreeze')
    b.controller.remove('cover')
    expect(b.calls).toContain('unfreeze')
    expect(b.controller.reasonCount).toBe(0)
    expect(b.controller.isHidden()).toBe(false)
  })

  it('hides without a capture for cover reasons only', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('expanded', 'cover')
    expect(t.calls).toEqual(['hide'])
    return Promise.resolve().then(() => {
      expect(t.controller.isHidden()).toBe(true)
      t.controller.remove('expanded')
      expect(t.calls).toEqual(['hide', 'unfreeze'])
    })
  })

  it('drops a result that arrives after the release', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.controller.remove('menu')
    t.resolveFreeze({ generation: 4, image: 'late' })
    return Promise.resolve().then(() => {
      expect(t.published).not.toContain('late')
      expect(t.calls).not.toContain('hideFrozen:4')
    })
  })

  it('keeps the view visible when the freeze rejects', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.rejectFreeze(new Error('boom'))
    return Promise.resolve().then(() => {
      expect(t.controller.isHidden()).toBe(false)
      expect(t.controller.reasonCount).toBe(1)
      t.controller.remove('menu')
      expect(t.calls).not.toContain('unfreeze')
      expect(t.controller.reasonCount).toBe(0)
    })
  })

  it('hides when the freeze returns no image', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.resolveFreeze({ generation: 5, image: null })
    return Promise.resolve().then(() => {
      expect(t.calls).toContain('hideFrozen:5')
    })
  })

  it('does nothing when there is no tab on screen', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.resolveFreeze(null)
    return Promise.resolve().then(() => {
      expect(t.published).toEqual([])
      expect(t.calls).toEqual(['freeze'])
    })
  })

  it('returns to visible after many open/close cycles', () => {
    const t = setup()
    t.controller.setAttached(true)
    for (let i = 0; i < 50; i++) {
      t.controller.add('menu', 'overlay')
      t.controller.remove('menu')
    }
    expect(t.controller.reasonCount).toBe(0)
    expect(t.controller.isHidden()).toBe(false)
  })

  it('decrements once on a double unmount', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.resolveFreeze({ generation: 6, image: 'img' })
    return Promise.resolve().then(() => {
      t.controller.imagePainted()
      t.controller.remove('menu')
      t.controller.remove('menu')
      expect(t.calls.filter(c => c === 'unfreeze')).toHaveLength(1)
      expect(t.controller.reasonCount).toBe(0)
    })
  })

  it('drops the frozen image when the last overlay leaves and a cover remains', async () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.resolveFreeze({ generation: 11, image: 'page' })
    await Promise.resolve()
    t.controller.imagePainted()
    await Promise.resolve()
    t.controller.add('crash', 'cover')
    t.controller.remove('menu')
    expect(t.published[t.published.length - 1]).toBeNull()
    expect(t.controller.isHidden()).toBe(true)
    expect(t.calls).not.toContain('unfreeze')
  })

  it('resets when the viewport unmounts while frozen', () => {
    const t = setup()
    t.controller.setAttached(true)
    t.controller.add('menu', 'overlay')
    t.resolveFreeze({ generation: 8, image: 'img' })
    return Promise.resolve().then(() => {
      t.controller.setAttached(false)
      expect(t.controller.isHidden()).toBe(false)
      expect(t.published[t.published.length - 1]).toBeNull()
    })
  })
})
