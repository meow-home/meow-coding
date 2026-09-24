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

  it('renders an incoming delegated task as a labelled bubble', async () => {
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
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: {
        id: 'delegation-incoming:d1',
        role: 'user',
        text: 'do the thing',
        createdAt: Date.now(),
        delegation: { id: 'd1', direction: 'incoming', peerAgentId: 'src-agent', peerName: 'Staff Agent' }
      }
    }))
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    const label = container.querySelector('.chat-delegation-label')
    expect(label).not.toBeNull()
    expect(label!.textContent).toContain('From session: Staff Agent')
    expect(container.querySelector('.chat-delegation-badge')!.textContent).toBe('delegation')
    expect(container.querySelector('.chat-text')!.textContent).toContain('do the thing')
  })

  it('restores the delegated label from the transcript after a reload', async () => {
    let resolveTranscript!: (page: TranscriptPage) => void
    const transcript = new Promise<TranscriptPage>(resolve => { resolveTranscript = resolve })
    const api = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'listChatTranscript') return () => transcript
        if (key === 'onChatEvent') return () => () => {}
        if (key === 'getAgentVariants' || key === 'getChatTodos' || key === 'listCommands' || key === 'listModels') {
          return async () => []
        }
        if (key === 'getContextInfo') return async () => ({ limit: 128000, compactThreshold: 100000, sessionCost: 0 })
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' }))
      resolveTranscript({
        items: [{
          kind: 'message',
          message: {
            id: 'delegation-incoming:d2',
            role: 'user',
            text: 'do the thing',
            createdAt: 1,
            delegation: { id: 'd2', direction: 'incoming', peerAgentId: 'src-agent', peerName: 'Staff Agent' }
          }
        }],
        hasMore: false
      })
      await transcript
    })

    expect(container.querySelector('.chat-delegation-label')!.textContent).toContain('From session: Staff Agent')
    expect(container.querySelector('.chat-msg.delegation')).not.toBeNull()
  })

  it('does not label ordinary user messages or delegation results', async () => {
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
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: { id: 'msg-plain', role: 'user', text: 'typed by hand', createdAt: Date.now() }
    }))
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: {
        id: 'delegation-result:d3',
        role: 'user',
        text: '### Delegation result — Staff Agent',
        createdAt: Date.now(),
        delegation: { id: 'd3', direction: 'result', peerAgentId: 'a1', peerName: 'Staff Agent' }
      }
    }))
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    expect(container.querySelectorAll('.chat-delegation-label')).toHaveLength(0)
    expect(container.querySelectorAll('.chat-msg.delegation')).toHaveLength(0)
    expect(container.querySelectorAll('.chat-msg.user')).toHaveLength(2)
    expect(container.textContent).toContain('typed by hand')
    expect(container.textContent).toContain('Delegation result — Staff Agent')
  })

  it('clusters consecutive tool calls into a single collapsible group, leaves lone tools alone', async () => {
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
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    // Two tool calls back-to-back → one cluster.
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-1', tool: 'bash', input: { command: 'ls' }, permission: 'allowed', output: 'a.txt' } }))
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-2', tool: 'read', input: { file_path: 'a.txt' }, permission: 'allowed', output: 'hello' } }))

    // An assistant message in between breaks the run.
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: { id: 'u-1', role: 'user', text: 'now run a single tool', createdAt: Date.now() }
    }))

    // Lone tool call after the message → not clustered.
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-3', tool: 'bash', input: { command: 'pwd' }, permission: 'allowed', output: '/repo' } }))

    expect(container.querySelectorAll('.tool-cluster')).toHaveLength(1)
    expect(container.querySelectorAll('.tool-cluster .tool-call')).toHaveLength(2)
    expect(container.querySelector('.tool-cluster-title')!.textContent).toContain('Ran 2 commands')
    // The lone tool renders as a bare .tool-call (no cluster wrapper).
    expect(container.querySelectorAll('.tool-call:not(.tool-cluster .tool-call)')).toHaveLength(1)
  })

  it('keeps clustered tool steps collapsed by default, even while running; a lone running tool still auto-opens', async () => {
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
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    // Cluster: two pending tool calls — both must render collapsed.
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-1', tool: 'bash', input: { command: 'ls' }, permission: 'pending' } }))
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-2', tool: 'read', input: { file_path: 'a.txt' }, permission: 'pending' } }))
    const clusterCards = container.querySelectorAll('.tool-cluster .tool-call')
    expect(clusterCards).toHaveLength(2)
    for (const card of Array.from(clusterCards)) {
      expect((card as HTMLDetailsElement).open).toBe(false)
    }

    // First tool finishes — still collapsed.
    act(() => onEvent?.({ type: 'tool-result', agentId: 'agent-1', call: { id: 'tc-1', tool: 'bash', input: { command: 'ls' }, permission: 'allowed', output: 'a.txt' } }))
    const finishedCards = container.querySelectorAll('.tool-cluster .tool-call')
    for (const card of Array.from(finishedCards)) {
      // tc-2 may have its own open attribute (pending, collapsed) — the test is
      // that nothing auto-opened after tc-1 finished.
      expect((card as HTMLDetailsElement).open).toBe(false)
    }

    // An assistant message between the cluster and the next tool call breaks the run,
    // so the next tool renders as a lone tool-call outside any cluster.
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: { id: 'u-break', role: 'user', text: 'break', createdAt: Date.now() }
    }))

    // Lone pending tool outside any cluster must still auto-open (legacy behavior).
    act(() => onEvent?.({ type: 'tool-start', agentId: 'agent-1', call: { id: 'tc-lone', tool: 'bash', input: { command: 'pwd' }, permission: 'pending' } }))
    const lone = container.querySelector('.tool-call:not(.tool-cluster .tool-call)') as HTMLDetailsElement | null
    expect(lone).not.toBeNull()
    expect(lone!.open).toBe(true)
  })
})
