// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PanelHeader from '../../src/renderer/src/components/common/PanelHeader'
import SubagentOverlay, { type SubagentOverlayItem } from '../../src/renderer/src/components/chat/SubagentOverlay'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const tabIds = (): string[] => [...container.querySelectorAll('.panel-tab-label')].map(el => el.textContent ?? '')

describe('PanelHeader', () => {
  function render(overrides: Partial<Parameters<typeof PanelHeader>[0]> = {}) {
    const props = {
      ariaLabel: 'Tabs',
      activeId: 'a',
      onSelect: vi.fn(),
      tabs: [
        { id: 'a', label: 'First', closeLabel: 'Close First', onClose: vi.fn() },
        { id: 'b', label: 'Second' }
      ],
      full: false,
      onToggleFull: vi.fn(),
      closeLabel: 'Close Panel',
      onClose: vi.fn(),
      ...overrides
    }
    act(() => root.render(createElement(PanelHeader, props)))
    return props
  }

  it('has tabs and actions, and no title', () => {
    render()
    expect(tabIds()).toEqual(['First', 'Second'])
    expect(container.querySelector('.files-head-title')).toBeNull()
    expect(container.querySelector('.panel-tab.active')?.textContent).toContain('First')
    expect(container.querySelector('[aria-label="Close Panel"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Expand"]')).not.toBeNull()
  })

  it('selects on click and on Enter', () => {
    const props = render()
    const second = container.querySelectorAll<HTMLElement>('.panel-tab')[1]
    act(() => second.click())
    expect(props.onSelect).toHaveBeenLastCalledWith('b')
    props.onSelect.mockClear()
    act(() => { second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })

  it('closing a tab does not select it', () => {
    const props = render({ activeId: 'b' })
    act(() => container.querySelector<HTMLElement>('[aria-label="Close First"]')!.click())
    expect(props.tabs[0].onClose).toHaveBeenCalledOnce()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('shows no tab list when empty, and + only when it can add', () => {
    render({ tabs: [], activeId: null })
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.querySelector('.panel-add')).toBeNull()
    const onAdd = vi.fn()
    render({ tabs: [], activeId: null, onAdd, addLabel: 'New tab' })
    act(() => container.querySelector<HTMLElement>('[aria-label="New tab"]')!.click())
    expect(onAdd).toHaveBeenCalledOnce()
  })
})

describe('SubagentOverlay tabs', () => {
  const items: SubagentOverlayItem[] = [
    { taskId: 'aaaaaa-1', subagentType: 'research', state: 'running', tools: ['grep'], text: 'first output' },
    { taskId: 'bbbbbb-2', state: 'completed', tools: [], text: 'second output', result: 'done' }
  ]

  function render(activeId: string | null) {
    const props = {
      items, activeId, onSelect: vi.fn(), onCloseTab: vi.fn(), full: false, onToggleFull: vi.fn(), onClose: vi.fn()
    }
    act(() => root.render(createElement(SubagentOverlay, props)))
    return props
  }

  it('merges sub-agents into tabs in one panel and shows the active one', () => {
    render('bbbbbb-2')
    expect(container.querySelectorAll('section').length).toBe(1)
    expect(tabIds()).toEqual(['research aaaaaa', 'sub-agent bbbbbb'])
    expect(container.textContent).toContain('second output')
    expect(container.textContent).not.toContain('first output')
  })

  it('falls back to the newest when the active id is gone', () => {
    render('missing')
    expect(container.querySelector('.panel-tab.active')?.textContent).toContain('bbbbbb')
  })

  it('closes one tab, or the whole panel', () => {
    const props = render('aaaaaa-1')
    act(() => container.querySelector<HTMLElement>('[aria-label="Close sub-agent bbbbbb"]')!.click())
    expect(props.onCloseTab).toHaveBeenCalledWith('bbbbbb-2')
    expect(props.onClose).not.toHaveBeenCalled()
    act(() => container.querySelector<HTMLElement>('[aria-label="Close Sub-agent"]')!.click())
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
