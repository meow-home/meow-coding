// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalInfo } from '@shared/types'
import TerminalOverlay from '../../src/renderer/src/components/terminal/TerminalOverlay'
import TerminalView from '../../src/renderer/src/components/terminal/TerminalView'
import Pane from '../../src/renderer/src/components/Pane'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../src/renderer/src/components/chat/ChatPanel', () => ({
  default: () => null
}))

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as any

const writtenChunks: string[] = []
let mockSelection = ''

const mockTerminalInstance = {
  open: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn((data: string) => {
    writtenChunks.push(data)
  }),
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
  getSelection: vi.fn(() => mockSelection),
  registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
  cols: 80,
  rows: 24,
  options: {
    theme: {},
    fontFamily: ''
  },
  buffer: {
    active: {
      length: 5,
      getLine: vi.fn((i: number) => ({
        translateToString: () => `line ${i}`
      }))
    }
  },
  loadAddon: vi.fn(),
  get textarea() {
    return document.createElement('textarea')
  }
}

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: function MockTerminal() {
      return mockTerminalInstance
    }
  }
})

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: function MockFitAddon() {
      return {
        fit: vi.fn()
      }
    }
  }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

describe('TerminalOverlay & TerminalView', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let terminalDataListener: ((data: { id: string; data: string }) => void) | null = null
  let terminalsChangedListener: ((data: { agentId: string; terminals: TerminalInfo[] }) => void) | null = null

  beforeEach(() => {
    writtenChunks.length = 0
    mockSelection = ''
    vi.clearAllMocks()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        platform: 'win32',
        terminalList: vi.fn().mockResolvedValue([]),
        terminalCreate: vi.fn().mockResolvedValue({
          id: 'term-1',
          agentId: 'agent-1',
          title: 'Terminal 1',
          status: 'running',
          createdAt: Date.now()
        }),
        terminalAttach: vi.fn().mockResolvedValue({ terminalId: 'term-1', scrollback: '' }),
        terminalDetach: vi.fn().mockResolvedValue(undefined),
        terminalWrite: vi.fn().mockResolvedValue(undefined),
        terminalResize: vi.fn().mockResolvedValue(undefined),
        terminalRename: vi.fn().mockResolvedValue(undefined),
        terminalRestart: vi.fn().mockResolvedValue({
          id: 'term-1',
          agentId: 'agent-1',
          title: 'Terminal 1',
          status: 'running',
          createdAt: Date.now()
        }),
        terminalKill: vi.fn().mockResolvedValue(undefined),
        onTerminalData: vi.fn((callback) => {
          terminalDataListener = callback
          return () => {
            terminalDataListener = null
          }
        }),
        onTerminalsChanged: vi.fn((callback) => {
          terminalsChangedListener = callback
          return () => {
            terminalsChangedListener = null
          }
        }),
        onBrowserShortcut: vi.fn(() => () => {})
      }
    })
  })

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('a pane never mounts a terminal itself; the panel lives in the right-hand grid', async () => {
    await act(async () => {
      root?.render(
        createElement(Pane, {
          pane: {
            agent: { id: 'agent-1', name: 'Agent', templateId: 'meow', cwd: '/test' } as any,
            state: { status: 'idle' } as any,
            git: null
          },
          background: false,
          active: true,
          terminalOpen: true,
          onFocus: vi.fn(),
          onRemove: vi.fn(),
          onToggleTerminal: vi.fn()
        })
      )
    })

    expect(container?.querySelector('.terminal-overlay')).toBeNull()
    expect(container?.querySelector('.terminal-view-container')).toBeNull()
    expect(window.api.terminalList).not.toHaveBeenCalled()
  })

  it('Ctrl+backquote in the active pane toggles the terminal panel', async () => {
    const onToggleTerminal = vi.fn()
    await act(async () => {
      root?.render(
        createElement(Pane, {
          pane: {
            agent: { id: 'agent-1', name: 'Agent', templateId: 'meow', cwd: '/test' } as any,
            state: { status: 'idle' } as any,
            git: null
          },
          background: false,
          active: true,
          onFocus: vi.fn(),
          onRemove: vi.fn(),
          onToggleTerminal
        })
      )
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true }))
    })
    expect(onToggleTerminal).toHaveBeenCalledTimes(1)
  })

  it('auto-creates a terminal when opened with 0 terminals', async () => {
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    expect(window.api.terminalCreate).toHaveBeenCalledWith('agent-1')
  })

  it('renders tabs and marks selected tab active', async () => {
    const mockList: TerminalInfo[] = [
      { id: 'term-1', agentId: 'agent-1', title: 'Terminal 1', status: 'running', createdAt: 1 },
      { id: 'term-2', agentId: 'agent-1', title: 'Terminal 2', status: 'running', createdAt: 2 }
    ]
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue(mockList)

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const tabs = container?.querySelectorAll('.terminal-tab')
    expect(tabs?.length).toBe(2)
    expect(tabs?.[0].classList.contains('active')).toBe(true)
    expect(tabs?.[1].classList.contains('active')).toBe(false)
  })

  it('switches selected terminal tab on click', async () => {
    const mockList: TerminalInfo[] = [
      { id: 'term-1', agentId: 'agent-1', title: 'Terminal 1', status: 'running', createdAt: 1 },
      { id: 'term-2', agentId: 'agent-1', title: 'Terminal 2', status: 'running', createdAt: 2 }
    ]
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue(mockList)

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const tabs = container?.querySelectorAll<HTMLDivElement>('.terminal-tab')!
    await act(async () => {
      tabs[1].click()
    })

    expect(tabs[1].classList.contains('active')).toBe(true)
    expect(tabs[0].classList.contains('active')).toBe(false)
  })

  it('calls terminalCreate on "+" button click', async () => {
    const mockList: TerminalInfo[] = [
      { id: 'term-1', agentId: 'agent-1', title: 'Terminal 1', status: 'running', createdAt: 1 }
    ]
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue(mockList)

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const newBtn = container?.querySelector<HTMLButtonElement>('button[aria-label="New terminal"]')
    expect(newBtn).toBeTruthy()
    await act(async () => {
      newBtn?.click()
    })

    expect(window.api.terminalCreate).toHaveBeenCalledWith('agent-1')
  })

  it('calls terminalKill on tab close button click', async () => {
    const mockList: TerminalInfo[] = [
      { id: 'term-1', agentId: 'agent-1', title: 'Terminal 1', status: 'running', createdAt: 1 }
    ]
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue(mockList)

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const closeTabBtn = container?.querySelector<HTMLButtonElement>('.terminal-tab-close')
    expect(closeTabBtn).toBeTruthy()
    await act(async () => {
      closeTabBtn?.click()
    })

    expect(window.api.terminalKill).toHaveBeenCalledWith('term-1')
  })

  it('shows Restart button for exited tab and clicking it calls terminalRestart', async () => {
    const mockList: TerminalInfo[] = [
      { id: 'term-exited', agentId: 'agent-1', title: 'Terminal Exited', status: 'exited', exitCode: 1, createdAt: 1 }
    ]
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue(mockList)

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const restartBtn = container?.querySelector<HTMLButtonElement>('.terminal-restart-btn')
    expect(restartBtn).toBeTruthy()
    expect(restartBtn?.getAttribute('aria-label')).toBe('Restart terminal')

    await act(async () => {
      restartBtn?.click()
    })

    expect(window.api.terminalRestart).toHaveBeenCalledWith('term-exited')
  })

  it('renders dismissible error banner when process cap is reached', async () => {
    ;(window.api.terminalList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'term-1', agentId: 'agent-1', title: 'Terminal 1', status: 'running', createdAt: 1 }
    ])
    ;(window.api.terminalCreate as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Terminal process cap reached (maximum 8)')
    )

    await act(async () => {
      root?.render(
        createElement(TerminalOverlay, {
          agentId: 'agent-1',
          full: false,
          onToggleFull: vi.fn(),
          onClose: vi.fn()
        })
      )
    })

    const newBtn = container?.querySelector<HTMLButtonElement>('button[aria-label="New terminal"]')
    await act(async () => {
      newBtn?.click()
    })

    const errorBar = container?.querySelector('.terminal-error-bar')
    expect(errorBar).toBeTruthy()
    expect(errorBar?.textContent).toContain('Terminal process cap reached (maximum 8)')

    const dismissBtn = container?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]')
    await act(async () => {
      dismissBtn?.click()
    })

    expect(container?.querySelector('.terminal-error-bar')).toBeNull()
  })

  it('buffers data chunks received while attach promise is in flight and writes in order', async () => {
    let resolveAttach: ((value: { terminalId: string; scrollback: string }) => void) | null = null
    const attachPromise = new Promise<{ terminalId: string; scrollback: string }>((resolve) => {
      resolveAttach = resolve
    })
    ;(window.api.terminalAttach as ReturnType<typeof vi.fn>).mockReturnValue(attachPromise)

    await act(async () => {
      root?.render(
        createElement(TerminalView, {
          terminalId: 'term-1',
          agentId: 'agent-1'
        })
      )
    })

    expect(window.api.onTerminalData).toHaveBeenCalled()
    expect(terminalDataListener).toBeTruthy()

    act(() => {
      terminalDataListener?.({ id: 'term-1', data: 'CHUNK-B' })
    })

    expect(writtenChunks).toEqual([])

    await act(async () => {
      resolveAttach?.({ terminalId: 'term-1', scrollback: 'SCROLLBACK-A' })
    })

    expect(writtenChunks).toEqual(['SCROLLBACK-A', 'CHUNK-B'])
  })

  it('dispatches meow:composer-insert event with fenced code block on send selection to chat', async () => {
    mockSelection = 'npm test\nall passed'
    let dispatchedDetail: { agentId: string; text: string } | null = null

    const onInsert = (e: Event) => {
      dispatchedDetail = (e as CustomEvent).detail
    }
    window.addEventListener('meow:composer-insert', onInsert)

    try {
      await act(async () => {
        root?.render(
          createElement(TerminalView, {
            terminalId: 'term-1',
            agentId: 'agent-test'
          })
        )
      })

      const viewContainer = container?.querySelector<HTMLDivElement>('.terminal-view-container')!
      act(() => {
        viewContainer.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: 100,
            clientY: 100
          })
        )
      })

      const sendSelectionBtn = document.querySelector<HTMLButtonElement>(
        '.base-dropdown-menu button'
      )
      expect(sendSelectionBtn).toBeTruthy()
      expect(sendSelectionBtn?.textContent).toContain('Send selection to chat')

      act(() => {
        sendSelectionBtn?.click()
      })

      expect(dispatchedDetail).toEqual({
        agentId: 'agent-test',
        text: '```text\nnpm test\nall passed\n```'
      })
    } finally {
      window.removeEventListener('meow:composer-insert', onInsert)
    }
  })
})
