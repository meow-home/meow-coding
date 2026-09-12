import { describe, it, expect, vi } from 'vitest'
import { resetToSingleSession } from '../../src/main/fresh-start'
import type { Workspace } from '../../src/shared/types'

function fakeStore(initial: Workspace[]) {
  let data = initial
  return { load: () => data, save: (d: Workspace[]) => { data = d }, _data: () => data }
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

  it('is a no-op when already done', () => {
    const store = fakeStore([])
    const clearSessions = vi.fn()
    const done = resetToSingleSession(store as never, { alreadyDone: true, clearSessions, now: () => ({ id: 'z', name: 'Session 1', templateId: 'meow', cwd: '/', kind: 'native' }) })
    expect(done).toBe(false)
    expect(clearSessions).not.toHaveBeenCalled()
  })
})
