// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PanelHeader from '../../src/renderer/src/components/common/PanelHeader'
import ProcessesOverlay from '../../src/renderer/src/components/processes/ProcessesOverlay'
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

describe('ProcessesOverlay tabs', () => {
  const kill = vi.fn(async () => {})

  async function render(shells: unknown[], monitors: unknown[]) {
    ;(window as unknown as { api: unknown }).api = {
      backgroundProcsList: vi.fn(async () => shells),
      monitorsList: vi.fn(async () => monitors),
      backgroundProcSubscribe: vi.fn(async () => ({ backlog: 'output of shell', status: 'running' })),
      backgroundProcUnsubscribe: vi.fn(async () => {}),
      backgroundProcKill: kill,
      onBackgroundProcData: () => () => {},
      onBackgroundProcExit: () => () => {}
    }
    await act(async () => {
      root.render(createElement(ProcessesOverlay, { agentId: 'a', full: false, onToggleFull: vi.fn(), onClose: vi.fn() }))
    })
  }

  beforeEach(() => kill.mockClear())

  it('shows a tab per shell and a monitors tab', async () => {
    await render(
      [
        { id: 's1', command: 'npm run dev', status: 'running' },
        { id: 's2', command: 'tsc', status: 'exited', exitCode: 0 }
      ],
      [{ id: 'm1', targetId: 's1', until: '/READY/' }]
    )
    expect(tabIds()).toEqual(['npm run dev', 'tsc (exit 0)', 'Monitors (1)'])
    expect(container.querySelector('.processes-output')?.textContent).toBe('output of shell')
  })

  it('kills a running shell from its tab, and an exited one has no such button', async () => {
    await render(
      [
        { id: 's1', command: 'npm run dev', status: 'running' },
        { id: 's2', command: 'tsc', status: 'exited', exitCode: 1 }
      ],
      []
    )
    expect(container.querySelector('[aria-label="Kill tsc"]')).toBeNull()
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Kill npm run dev"]')!.click())
    expect(kill).toHaveBeenCalledWith('s1')
  })

  it('opens the monitors tab, and falls to it when there are no shells', async () => {
    await render([], [{ id: 'm1', targetId: 's9', until: 'exit or 30s' }])
    expect(tabIds()).toEqual(['Monitors (1)'])
    expect(container.querySelector('.processes-monitor-until')?.textContent).toBe('exit or 30s')
  })

  it('shows the empty state with nothing running', async () => {
    await render([], [])
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.textContent).toContain('No background processes')
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
