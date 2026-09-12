import { describe, it, expect, vi } from 'vitest'
import { resetToSingleSession } from '../../src/main/fresh-start'
import type { Workspace } from '../../src/shared/types'

// `load()` hands back a clone, so the helper mutating what it loaded cannot be
// mistaken for a persisted change: only a real `save()` call puts the reset into
// `_data()`. With a shared reference these tests would pass even with `save()`
// deleted.
function fakeStore(initial: Workspace[]) {
  let data = initial
  return { load: () => structuredClone(data), save: (d: Workspace[]) => { data = d }, _data: () => data }
}

describe('resetToSingleSession', () => {
  it('gives each project exactly one native session and clears sessions once', () => {
    const store = fakeStore([
      { projectPath: '/p', name: 'P', agents: [
        { id: 'x', name: 'claude', templateId: 'claude', cwd: '/p', kind: 'pty' },
        { id: 'y', name: 'meow', templateId: 'meow', cwd: '/p', kind: 'native' }
      ] }
    ])
    const clearSessions = vi.fn()
    let n = 0
    const done = resetToSingleSession(store as never, {
      alreadyDone: false,
      clearSessions,
      now: () => ({ id: `n${n++}`, name: 'Session 1', templateId: 'meow', cwd: '/p', kind: 'native' })
    })
    expect(done).toBe(true)
    expect(clearSessions).toHaveBeenCalledOnce()
    const ws = store._data()[0]
    expect(ws.agents).toEqual([{ id: 'n0', name: 'Session 1', templateId: 'meow', cwd: '/p', kind: 'native' }])
  })

  // Production passes no `now` (`src/main/index.ts` boot block), so this is the
  // branch the app actually runs — and the one whose cwd an earlier fix round had
  // to repair. Every project must get its own session rooted at its own path.
  it('falls back to a fresh native session in each project directory when no now() is given', () => {
    const store = fakeStore([
      { projectPath: '/a', name: 'A', agents: [
        { id: 'x', name: 'claude', templateId: 'claude', cwd: '/a', kind: 'pty' }
      ] },
      { projectPath: '/b', name: 'B', agents: [] }
    ])
    const clearSessions = vi.fn()
    const done = resetToSingleSession(store as never, { alreadyDone: false, clearSessions })

    expect(done).toBe(true)
    expect(clearSessions).toHaveBeenCalledOnce()
    const [a, b] = store._data()
    expect(a.agents).toHaveLength(1)
    expect(b.agents).toHaveLength(1)
    expect(a.agents[0]).toMatchObject({ name: 'Session 1', templateId: 'meow', kind: 'native', cwd: '/a' })
    expect(b.agents[0]).toMatchObject({ name: 'Session 1', templateId: 'meow', kind: 'native', cwd: '/b' })
    expect(a.agents[0].id).not.toBe(b.agents[0].id)
  })

  it('is a no-op when already done', () => {
    const store = fakeStore([])
    const clearSessions = vi.fn()
    const done = resetToSingleSession(store as never, { alreadyDone: true, clearSessions, now: () => ({ id: 'z', name: 'Session 1', templateId: 'meow', cwd: '/', kind: 'native' }) })
    expect(done).toBe(false)
    expect(clearSessions).not.toHaveBeenCalled()
  })
})
