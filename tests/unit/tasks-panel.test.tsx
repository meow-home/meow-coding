// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPanel, { type TasksPanelSession } from '../../src/renderer/src/components/processes/TasksPanel'

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

const monitors = [
  {
    id: 'mon-1', kind: 'delegation' as const, label: 'wake test 3', targetId: 'sess-bg', until: 'sub-session reports back',
    status: 'watching' as const, startedAt: Date.now() - 42_000, sessionId: 'sess-active'
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
    await act(async () => byText('Stop watching').click())
    expect(api.monitorsCancel).toHaveBeenCalledWith('mon-1')
    await act(async () => byText('Open session').click())
    expect(props.onOpenSession).toHaveBeenCalledWith('sess-bg')
  })

  it('expands the watch a focus request points at', async () => {
    await render({ focus: { monitorId: 'mon-1', seq: 1 } })
    expect(rowHeads()[2].getAttribute('aria-expanded')).toBe('true')
  })

  it('shows the counts in the header and maximizes from it', async () => {
    const props = await render()
    expect(container.querySelector('.tasks-summary')?.textContent).toContain('2 running')
    expect(container.querySelector('.tasks-summary')?.textContent).toContain('1 waiting')
    expect(container.querySelector('.tasks-summary')?.textContent).toContain('1 finished')
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
