// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPanel, { type TasksPanelSession } from '../../src/renderer/src/components/processes/TasksPanel'
import type { MonitorInfo } from '@shared/types'

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

const sessions: TasksPanelSession[] = [
  {
    id: 'sess-active', name: 'Fix delegation wake', cwd: 'E:\\repo', mode: 'build', model: 'sonnet',
    status: 'running', alert: 'normal', exitCode: null, lastOutputAt: Date.now(), background: false
  },
  {
    id: 'sess-bg', name: 'Browser bridge docs', cwd: 'E:\\repo', mode: 'build', model: 'sonnet',
    status: 'running', alert: 'normal', exitCode: null, lastOutputAt: Date.now(), background: true
  },
  {
    id: 'sess-done', name: 'MCP config draft', cwd: 'E:\\repo', mode: 'plan',
    status: 'stopped', alert: 'normal', exitCode: 0, lastOutputAt: Date.now(), background: true
  }
]

const shells = [
  { id: 'proc-1', command: 'npm test', cwd: 'E:\\repo', startedAt: Date.now() - 134_000, status: 'running' as const, exitCode: null }
]

const monitors: MonitorInfo[] = [
  {
    id: 'mon-1', kind: 'delegation', label: 'wake test 3', targetId: 'sess-bg', until: 'sub-session reports back',
    status: 'watching', startedAt: Date.now() - 42_000, sessionId: 'sess-active'
  }
]

const api = {
  backgroundProcsList: vi.fn(async () => shells),
  monitorsList: vi.fn(async () => monitors),
  backgroundProcSubscribe: vi.fn(async () => ({ backlog: 'output of shell', status: 'running', exitCode: null })),
  backgroundProcUnsubscribe: vi.fn(async () => {}),
  backgroundProcKill: vi.fn(async () => {}),
  monitorsCancel: vi.fn(async () => {}),
  listChatMessages: vi.fn(async () => []),
  onBackgroundProcData: vi.fn(() => () => {})
}

async function render(overrides: Partial<Parameters<typeof TasksPanel>[0]> = {}) {
  ;(window as unknown as { api: unknown }).api = api
  const props = {
    agentId: 'sess-active',
    sessions,
    full: false,
    onToggleFull: vi.fn(),
    onClose: vi.fn(),
    onOpenSession: vi.fn(),
    onStopSession: vi.fn(),
    onRemoveSession: vi.fn(),
    ...overrides
  }
  await act(async () => {
    root.render(createElement(TasksPanel, props))
  })
  return props
}

const rowHeads = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.tasks-row-head')]
const rowTexts = (): string[] => rowHeads().map(h => h.textContent ?? '')
const byText = (text: string): HTMLElement =>
  [...container.querySelectorAll<HTMLElement>('.tasks-act')].find(b => b.textContent?.includes(text))!

describe('TasksPanel', () => {
  it('lists background sessions, shells and watches, grouped by state', async () => {
    await render()
    const groups = [...container.querySelectorAll('.tasks-group-label')].map(el => el.textContent)
    expect(groups).toEqual(['Active', 'Finished'])
    // Active: background session, shell, watch. Finished: the stopped session.
    expect(rowTexts()).toHaveLength(4)
    expect(rowTexts()[0]).toContain('Browser bridge docs')
    expect(rowTexts()[1]).toContain('npm test')
    expect(rowTexts()[2]).toContain('wake test 3')
    expect(rowTexts()[3]).toContain('MCP config draft')
    // The session the sheet belongs to is on screen already: it is not a row.
    expect(rowTexts().some(t => t.includes('Fix delegation wake'))).toBe(false)
    expect(rowHeads().every(h => h.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  it('expands a shell row in place and streams its output', async () => {
    await render()
    const shellHead = rowHeads()[1]
    await act(async () => shellHead.click())
    expect(shellHead.getAttribute('aria-expanded')).toBe('true')
    expect(api.backgroundProcSubscribe).toHaveBeenCalledWith('proc-1')
    expect(container.querySelector('.tasks-output')?.textContent).toBe('output of shell')

    await act(async () => byText('Kill process').click())
    expect(api.backgroundProcKill).toHaveBeenCalledWith('proc-1')
  })

  it('opens a background session, stops it, and confirms a delete', async () => {
    const props = await render()
    await act(async () => rowHeads()[0].click())

    await act(async () => byText('Open session').click())
    expect(props.onOpenSession).toHaveBeenCalledWith('sess-bg')
    await act(async () => byText('Stop').click())
    expect(props.onStopSession).toHaveBeenCalledWith('sess-bg')

    await act(async () => byText('Delete').click())
    expect(document.body.textContent).toContain('Delete session "Browser bridge docs"')
    const confirm = [...document.querySelectorAll<HTMLElement>('.dialog-footer .btn')].find(b => b.textContent === 'Delete')
    await act(async () => confirm!.click())
    expect(props.onRemoveSession).toHaveBeenCalledWith('sess-bg')
  })

  it('stops a watching monitor and opens its delegation session', async () => {
    const props = await render()
    await act(async () => rowHeads()[2].click())
    const stopWatching = byText('Stop watching')
    expect(stopWatching.classList.contains('stop')).toBe(true)
    await act(async () => stopWatching.click())
    expect(api.monitorsCancel).toHaveBeenCalledWith('mon-1')
    await act(async () => byText('Open session').click())
    expect(props.onOpenSession).toHaveBeenCalledWith('sess-bg')
  })

  it('stops a live task from its collapsed card', async () => {
    const props = await render()
    const stops = [...container.querySelectorAll<HTMLElement>('.tasks-card-stop')]
    // The stopped session has no stop icon; session, shell and watch do.
    expect(stops).toHaveLength(3)
    await act(async () => stops[0].click())
    expect(props.onStopSession).toHaveBeenCalledWith('sess-bg')
    expect(rowHeads()[0].getAttribute('aria-expanded')).toBe('false')
    await act(async () => stops[1].click())
    expect(api.backgroundProcKill).toHaveBeenCalledWith('proc-1')
    await act(async () => stops[2].click())
    expect(api.monitorsCancel).toHaveBeenCalledWith('mon-1')
  })

  it('badges each card with what is running, not its state', async () => {
    api.monitorsList.mockResolvedValue([
      { ...monitors[0], id: 'mon-cli', targetId: 'deleg-1', label: 'deleg-1', cliAgentId: 'antigravity' }
    ])
    await render()
    const badges = [...container.querySelectorAll<HTMLElement>('.tasks-avatar')]
    // Background session, background shell, Antigravity delegation, stopped session — row order.
    expect(badges.map(b => b.className)).toEqual([
      'tasks-avatar agent', 'tasks-avatar shell', 'tasks-avatar cli', 'tasks-avatar agent'
    ])
    expect(badges[0].querySelector('img')).not.toBeNull()
    expect(badges[1].querySelector('img')).toBeNull()
    expect(badges[2].querySelector('img')).not.toBeNull()
    expect(rowTexts()[2]).toContain('antigravity · deleg-1')
    // The state dot is gone: state lives in the chip.
    expect(container.querySelector('.tasks-row .tasks-dot')).toBeNull()
    api.monitorsList.mockResolvedValue(monitors)
  })

  it('expands the watch a focus request points at', async () => {
    await render({ focus: { monitorId: 'mon-1', seq: 1 } })
    expect(rowHeads()[2].getAttribute('aria-expanded')).toBe('true')
  })

  it('shows the total count in the header and maximizes from it', async () => {
    const props = await render()
    expect(container.querySelector('.tasks-count')?.textContent).toBe('4')
    expect(container.querySelector('.tasks-summary')).toBeNull()
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Maximize"]')!.click())
    expect(props.onToggleFull).toHaveBeenCalledOnce()
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Close Tasks"]')!.click())
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows an empty state when there is nothing to list', async () => {
    api.backgroundProcsList.mockResolvedValue([])
    api.monitorsList.mockResolvedValue([])
    await render({ sessions: [] })
    expect(container.textContent).toContain('No tasks')
  })
})
