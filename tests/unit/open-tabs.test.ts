import { describe, expect, it } from 'vitest'
import {
  EMPTY_OPEN_TABS, activateTab, closeAllTabs, closeTabs, openTab, promoteTab, togglePinned,
  type OpenTabsState
} from '../../src/renderer/src/components/files/open-tabs'

const file = (name: string, permanent = false) => ({ path: `/proj/${name}`, name, permanent })

function names(state: OpenTabsState): string[] {
  return state.tabs.map(tab => tab.name)
}

function expectValid(state: OpenTabsState): void {
  if (state.activeTab === null) {
    expect(state.tabs).toHaveLength(0)
    return
  }
  expect(state.tabs.some(tab => tab.path === state.activeTab)).toBe(true)
}

describe('openTab', () => {
  it('opens a single click as an active preview', () => {
    const state = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    expect(names(state)).toEqual(['a.ts'])
    expect(state.tabs[0]).toMatchObject({ preview: true, pinned: false })
    expect(state.activeTab).toBe('/proj/a.ts')
    expectValid(state)
  })

  it('replaces the preview instead of adding a tab', () => {
    const first = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    const second = openTab(first, file('b.ts'))
    expect(names(second)).toEqual(['b.ts'])
    expect(second.tabs[0].preview).toBe(true)
    expectValid(second)
  })

  it('only activates an open file, and never demotes a permanent tab', () => {
    const permanent = openTab(EMPTY_OPEN_TABS, file('a.ts', true))
    const again = openTab(permanent, file('a.ts'))
    expect(names(again)).toEqual(['a.ts'])
    expect(again.tabs[0].preview).toBe(false)
    expect(again.activeTab).toBe('/proj/a.ts')
  })

  it('opens a double click as permanent and keeps the preview', () => {
    const preview = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    const both = openTab(preview, file('b.ts', true))
    expect(names(both)).toEqual(['a.ts', 'b.ts'])
    expect(both.tabs[0].preview).toBe(true)
    expect(both.tabs[1].preview).toBe(false)
    expect(both.activeTab).toBe('/proj/b.ts')
    expectValid(both)
  })

  it('promotes a preview that is opened permanently', () => {
    const preview = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    const promoted = openTab(preview, file('a.ts', true))
    expect(names(promoted)).toEqual(['a.ts'])
    expect(promoted.tabs[0].preview).toBe(false)
    expectValid(promoted)
  })

  it('never replaces a pinned tab with a preview', () => {
    const preview = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    const pinned = togglePinned(preview, '/proj/a.ts')
    const next = openTab(pinned, file('b.ts'))
    expect(names(next)).toEqual(['a.ts', 'b.ts'])
    expect(next.tabs[0].pinned).toBe(true)
    expect(next.tabs[1].preview).toBe(true)
    expectValid(next)
  })
})

describe('dirty tabs', () => {
  it('promotes a preview so a replacement can never drop its edits', () => {
    const preview = openTab(EMPTY_OPEN_TABS, file('a.ts'))
    const dirty = promoteTab(preview, '/proj/a.ts')
    expect(dirty.tabs[0].preview).toBe(false)

    const next = openTab(dirty, file('b.ts'))
    expect(names(next)).toEqual(['a.ts', 'b.ts'])
    expect(next.tabs[0].preview).toBe(false)
    expectValid(next)
  })

  it('does not flip back to a preview when the file is saved', () => {
    const dirty = promoteTab(openTab(EMPTY_OPEN_TABS, file('a.ts')), '/proj/a.ts')
    // Saving clears the dirty flag; the tab stays permanent.
    const saved = openTab(dirty, file('a.ts'))
    expect(saved.tabs[0].preview).toBe(false)
    const third = openTab(saved, file('b.ts'))
    expect(names(third)).toEqual(['a.ts', 'b.ts'])
  })

  it('leaves other tabs alone when promoting', () => {
    const state = openTab(openTab(EMPTY_OPEN_TABS, file('a.ts', true)), file('b.ts'))
    const promoted = promoteTab(state, '/proj/b.ts')
    expect(names(promoted)).toEqual(['a.ts', 'b.ts'])
    expect(promoted.tabs.every(tab => !tab.preview)).toBe(true)
  })
})

describe('pinning', () => {
  it('toggles pinned, makes the tab permanent and sorts it first', () => {
    const state = openTab(openTab(EMPTY_OPEN_TABS, file('a.ts', true)), file('b.ts'))
    const pinned = togglePinned(state, '/proj/b.ts')
    expect(names(pinned)).toEqual(['b.ts', 'a.ts'])
    expect(pinned.tabs[0]).toMatchObject({ pinned: true, preview: false })
    expect(pinned.activeTab).toBe('/proj/b.ts')

    const unpinned = togglePinned(pinned, '/proj/b.ts')
    // Unpinning leaves the tab where it is; it only stops sorting first.
    expect(names(unpinned)).toEqual(['b.ts', 'a.ts'])
    expect(unpinned.tabs[0].pinned).toBe(false)
    // Unpinning does not turn a permanent tab back into a preview.
    expect(unpinned.tabs[0].preview).toBe(false)
    expectValid(unpinned)
  })

  it('pins a preview without losing it to the next preview', () => {
    const pinned = togglePinned(openTab(EMPTY_OPEN_TABS, file('a.ts')), '/proj/a.ts')
    expect(pinned.tabs[0]).toMatchObject({ pinned: true, preview: false })
    const next = openTab(pinned, file('b.ts'))
    expect(names(next)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('closing', () => {
  it('keeps the active tab when another one closes', () => {
    const state = openTab(openTab(EMPTY_OPEN_TABS, file('a.ts', true)), file('b.ts', true))
    const closed = closeTabs(state, ['/proj/a.ts'])
    expect(names(closed)).toEqual(['b.ts'])
    expect(closed.activeTab).toBe('/proj/b.ts')
    expectValid(closed)
  })

  it('picks a remaining tab when the active one closes', () => {
    const state = openTab(openTab(EMPTY_OPEN_TABS, file('a.ts', true)), file('b.ts', true))
    const closed = closeTabs(state, ['/proj/b.ts'])
    expect(names(closed)).toEqual(['a.ts'])
    expect(closed.activeTab).toBe('/proj/a.ts')
    expectValid(closed)
  })

  it('empties the state when the last tab closes', () => {
    const closed = closeTabs(openTab(EMPTY_OPEN_TABS, file('a.ts')), ['/proj/a.ts'])
    expect(closed.tabs).toEqual([])
    expect(closed.activeTab).toBeNull()
  })

  it('closes everything except pinned tabs', () => {
    let state = openTab(EMPTY_OPEN_TABS, file('a.ts', true))
    state = openTab(state, file('b.ts', true))
    state = togglePinned(state, '/proj/a.ts')
    state = openTab(state, file('c.ts'))
    const closed = closeAllTabs(state)
    expect(names(closed)).toEqual(['a.ts'])
    expect(closed.tabs[0].pinned).toBe(true)
    expectValid(closed)
  })

  it('keeps the active tab when close-all does not touch it', () => {
    let state = openTab(EMPTY_OPEN_TABS, file('a.ts', true))
    state = openTab(state, file('b.ts', true))
    state = togglePinned(state, '/proj/a.ts')
    state = activateTab(state, '/proj/a.ts')
    const closed = closeAllTabs(state)
    expect(names(closed)).toEqual(['a.ts'])
    expect(closed.activeTab).toBe('/proj/a.ts')
    expectValid(closed)
  })
})

describe('activateTab', () => {
  it('activates an open tab and ignores an unknown one', () => {
    const state = openTab(openTab(EMPTY_OPEN_TABS, file('a.ts', true)), file('b.ts', true))
    expect(activateTab(state, '/proj/a.ts').activeTab).toBe('/proj/a.ts')
    expect(activateTab(state, '/proj/zzz.ts')).toBe(state)
  })
})

describe('every action leaves a valid state', () => {
  it('keeps activeTab pointing at an open tab', () => {
    const actions: Array<(state: OpenTabsState) => OpenTabsState> = [
      state => openTab(state, file('a.ts')),
      state => openTab(state, file('b.ts', true)),
      state => openTab(state, file('c.ts')),
      state => promoteTab(state, '/proj/b.ts'),
      state => togglePinned(state, '/proj/b.ts'),
      state => activateTab(state, '/proj/a.ts'),
      state => closeTabs(state, ['/proj/a.ts']),
      state => closeAllTabs(state)
    ]
    let state = EMPTY_OPEN_TABS
    for (const action of actions) {
      state = action(state)
      expectValid(state)
    }
  })
})
