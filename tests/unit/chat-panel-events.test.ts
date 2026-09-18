// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ToolCallData } from '../../src/shared/types'
import ChatPanel from '../../src/renderer/src/components/chat/ChatPanel'

type TranscriptPage = Awaited<ReturnType<Window['api']['listChatTranscript']>>

let root: ReturnType<typeof createRoot> | undefined

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ChatPanel live event reconciliation', () => {
  it('keeps a completed tool result when transcript loading races with live events', async () => {
    let resolveTranscript!: (page: TranscriptPage) => void
    const transcript = new Promise<TranscriptPage>(resolve => { resolveTranscript = resolve })
    let onEvent: ((event: ChatEvent) => void) | undefined
    const api = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'listChatTranscript') return () => transcript
        if (key === 'onChatEvent') return (listener: (event: ChatEvent) => void) => { onEvent = listener; return () => {} }
        if (key === 'getAgentVariants' || key === 'getChatTodos' || key === 'listCommands' || key === 'listModels') {
          return async () => []
        }
        if (key === 'getContextInfo') return async () => ({ limit: 128000, compactThreshold: 100000, sessionCost: 0 })
        if (key === 'isChatRunning') return async () => true
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    const pending: ToolCallData = {
      id: 'tool-1', tool: 'bash', input: { command: 'npm test' }, permission: 'pending'
    }
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: pending }))

    await act(async () => {
      resolveTranscript({ items: [], hasMore: false })
      await transcript
    })
    act(() => onEvent?.({
      type: 'tool-result', agentId: 'agent-1',
      call: { ...pending, permission: 'allowed', output: 'finished-output' }
    }))

    expect(container.querySelectorAll('.tool-call')).toHaveLength(1)
    expect(container.textContent).toContain('finished-output')
  })
})
