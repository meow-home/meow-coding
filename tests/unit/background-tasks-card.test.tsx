// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorInfo } from '@shared/types'
import BackgroundTasksCard from '../../src/renderer/src/components/chat/BackgroundTasksCard'

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
})

const started = Date.now() - 42_000

const MONITORS: MonitorInfo[] = [
  {
    id: 'm1', kind: 'shell', label: 'npm run dev', targetId: 'bg1', until: '/READY/',
    status: 'watching', startedAt: started, sessionId: 'sess-1234'
  },
  {
    id: 'del-1', kind: 'delegation', label: 'review the diff', targetId: 'del-1', until: 'delegation finishes',
    status: 'resolved', reason: 'succeeded', detail: 'completed', startedAt: started, resolvedAt: started + 1000,
    sessionId: 'sess-1234'
  }
]

async function render(monitors: MonitorInfo[]) {
  const cancel = vi.fn(async () => {})
  const onOpenPane = vi.fn()
  ;(window as unknown as { api: unknown }).api = {
    monitorsList: vi.fn(async () => monitors),
    monitorsCancel: cancel,
    onMonitorsChanged: () => () => {}
  }
  await act(async () => { root.render(createElement(BackgroundTasksCard, { agentId: 'a1', onOpenPane })) })
  return { cancel, onOpenPane }
}

describe('BackgroundTasksCard', () => {
  it('renders nothing without tasks', async () => {
    await render([])
    expect(container.querySelector('.chat-tasks')).toBeNull()
  })

  it('disappears as soon as the last watch resolves', async () => {
    await render(MONITORS.filter(m => m.status === 'resolved'))
    expect(container.querySelector('.chat-tasks')).toBeNull()
  })

  it('lists watching and resolved watches with their state', async () => {
    await render(MONITORS)
    const rows = [...container.querySelectorAll('.chat-tasks-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.chat-tasks-name')?.textContent).toBe('npm run dev')
    expect(rows[0].querySelector('.chat-tasks-state')?.textContent).toContain('waiting')
    expect(rows[0].querySelector('.chat-tasks-state')?.textContent).toContain('0:42')
    expect(rows[1].querySelector('.chat-tasks-name')?.textContent).toBe('review the diff')
    expect(rows[1].querySelector('.chat-tasks-state')?.textContent).toContain('succeeded')
    expect(container.querySelector('.chat-tasks-summary')?.textContent).toBe('1 running · 1 done')
  })

  it('opens the pane from the header and focuses a row when clicked', async () => {
    const { onOpenPane } = await render(MONITORS)
    act(() => container.querySelector<HTMLElement>('.chat-tasks-open')!.click())
    expect(onOpenPane).toHaveBeenCalledWith()
    act(() => container.querySelectorAll<HTMLElement>('.chat-tasks-row')[1].click())
    expect(onOpenPane).toHaveBeenLastCalledWith('del-1')
  })

  it('stops a watch without opening the pane', async () => {
    const { cancel, onOpenPane } = await render(MONITORS)
    act(() => container.querySelector<HTMLElement>('.chat-tasks-stop')!.click())
    expect(cancel).toHaveBeenCalledWith('m1')
    expect(onOpenPane).not.toHaveBeenCalled()
  })

  it('collapses to its header', async () => {
    await render(MONITORS)
    act(() => container.querySelector<HTMLElement>('.chat-tasks-caret')!.click())
    expect(container.querySelector('.chat-tasks')?.classList.contains('collapsed')).toBe(true)
    expect(container.querySelectorAll('.chat-tasks-row')).toHaveLength(0)
    act(() => container.querySelector<HTMLElement>('.chat-tasks-caret')!.click())
    expect(container.querySelectorAll('.chat-tasks-row')).toHaveLength(2)
  })
})
