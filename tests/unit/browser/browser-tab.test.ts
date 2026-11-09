import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BrowserTab, CONTROL_LEASE_MS, LOG_BUFFER_ENTRIES, MAX_PENDING_REQUESTS, USER_HOLD_TIMEOUT_MS
} from '../../../src/main/browser/browser-tab'
import type { CdpClient, TabHost } from '../../../src/main/browser/browser-tab'
import type { BrowserCommandResult } from '../../../src/shared/browser-types'
import type { QuestionPrompt } from '../../../shared/types'
import { SiteApprovals } from '../../../src/main/browser/site-approval'

class FakeCdp implements CdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses: Record<string, unknown> = {}
  callFunctionOnValues: unknown[] = []
  onSend: ((method: string) => Promise<void> | void) | null = null
  private listeners: Array<(method: string, params: unknown) => void> = []

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (this.onSend) await this.onSend(method)
    if (method === 'Runtime.callFunctionOn' && this.callFunctionOnValues.length > 0) {
      return { result: { value: this.callFunctionOnValues.shift() } } as T
    }
    return (this.responses[method] ?? {}) as T
  }

  onEvent(cb: (method: string, params: unknown) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb)
    }
  }

  emit(method: string, params: unknown): void {
    for (const listener of [...this.listeners]) listener(method, params)
  }
}

function fakeHost(cdp: CdpClient): {
  host: TabHost
  state: {
    url: string
    title: string
    destroyed: boolean
    history: string[]
    shields: Array<{ visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }>
  }
} {
  const state = {
    url: 'http://127.0.0.1:3000/',
    title: 'Example',
    destroyed: false,
    history: [] as string[],
    shields: [] as Array<{ visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }>
  }
  const host: TabHost = {
    id: 42,
    cdp,
    getUrl: () => state.url,
    getTitle: () => state.title,
    loadUrl: async (url) => { state.url = url },
    history: (action) => { state.history.push(action) },
    navState: () => ({ loading: false, canGoBack: true, canGoForward: false }),
    setShield: (shield) => { state.shields.push({ ...shield }) },
    setBounds: () => {},
    setVisible: () => {},
    setOnScreen: async () => {},
    capture: async () => 'data:image/png;base64,',
    destroy: () => { state.destroyed = true }
  }
  return { host, state }
}

function primeRead(cdp: FakeCdp): void {
  cdp.responses['Runtime.evaluate'] = { result: { value: true } }
  cdp.responses['Page.getFrameTree'] = { frameTree: { frame: { id: 'F1' } } }
  cdp.responses['Accessibility.getFullAXTree'] = {
    nodes: [
      { nodeId: '1', role: { value: 'rootwebarea' }, childIds: ['2'] },
      { nodeId: '2', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 12 }
    ]
  }
  cdp.responses['DOM.pushNodesByBackendIdsToFrontend'] = { nodeIds: [9] }
  cdp.responses['DOM.getBoxModel'] = {
    model: { content: [10, 20, 110, 20, 110, 70, 10, 70], width: 100, height: 50 }
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function errorOf(result: BrowserCommandResult): string {
  if (result.ok) throw new Error('expected an error result')
  return result.error
}

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-tab-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function makeTab(cdp: FakeCdp): BrowserTab {
  return new BrowserTab(fakeHost(cdp).host, { agentId: 'agent-1', snapshotDir: dir })
}

describe('BrowserTab info', () => {
  it('reports the host state with an idle control', () => {
    const tab = makeTab(new FakeCdp())
    expect(tab.toInfo()).toEqual({
      id: 42,
      agentId: 'agent-1',
      url: 'http://127.0.0.1:3000/',
      title: 'Example',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      crashed: false,
      control: 'idle'
    })
  })
})

describe('BrowserTab queue', () => {
  it('runs commands FIFO', async () => {
    const cdp = new FakeCdp()
    let releaseFirst: (() => void) | null = null
    let evaluations = 0
    const order: string[] = []
    cdp.onSend = async (method) => {
      if (method !== 'Runtime.evaluate') return
      evaluations++
      const n = evaluations
      order.push(`start${n}`)
      if (n === 1) await new Promise<void>(resolve => { releaseFirst = resolve })
      order.push(`end${n}`)
    }
    const tab = makeTab(cdp)
    const first = tab.run('scroll', { direction: 'down' })
    const second = tab.run('scroll', { direction: 'up' })
    await tick()
    expect(order).toEqual(['start1'])
    releaseFirst!()
    await Promise.all([first, second])
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('keeps the queue moving after a command throws', async () => {
    const cdp = new FakeCdp()
    cdp.onSend = (method) => {
      if (method === 'DOM.getDocument') throw new Error('boom')
    }
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    const [clicked, scrolled] = await Promise.all([
      tab.run('click', { selector: '#a' }),
      tab.run('scroll', { direction: 'down' })
    ])
    expect(errorOf(clicked)).toBe('click: boom')
    expect(scrolled).toEqual({ ok: true })
  })
})

describe('BrowserTab timeouts', () => {
  it('times out a hung command and keeps the queue moving', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      let hung = false
      cdp.onSend = (method) => {
        if (method === 'Runtime.evaluate' && !hung) {
          hung = true
          return new Promise<void>(() => {})
        }
      }
      cdp.responses['Runtime.evaluate'] = { result: { value: true } }
      const tab = makeTab(cdp)
      const first = tab.run('scroll', { direction: 'down' }, undefined, 1000)
      const second = tab.run('scroll', { direction: 'up' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(await first).toEqual({ ok: false, error: 'browser command timed out: scroll' })
      await vi.advanceTimersByTimeAsync(0)
      expect(await second).toEqual({ ok: true })
      // The last command armed its 15 s lease; destroying the tab clears it.
      expect(vi.getTimerCount()).toBe(1)
      tab.destroy()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not count time spent queued against the timeout', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      let evaluations = 0
      cdp.onSend = async (method) => {
        if (method !== 'Runtime.evaluate') return
        evaluations++
        if (evaluations === 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 5000))
          return
        }
        await new Promise<void>(() => {})
      }
      cdp.responses['Runtime.evaluate'] = { result: { value: true } }
      const tab = makeTab(cdp)
      const first = tab.run('scroll', { direction: 'down' }, undefined, 10_000)
      const second = tab.run('scroll', { direction: 'up' }, undefined, 1000)
      let secondSettled = false
      void second.then(() => { secondSettled = true })
      await vi.advanceTimersByTimeAsync(5000)
      expect(await first).toEqual({ ok: true })
      await vi.advanceTimersByTimeAsync(999)
      expect(secondSettled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await second).toEqual({ ok: false, error: 'browser command timed out: scroll' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a command on abort, removes the listener and frees the queue', async () => {
    const cdp = new FakeCdp()
    let hung = false
    cdp.onSend = (method) => {
      if (method === 'Runtime.evaluate' && !hung) {
        hung = true
        return new Promise<void>(() => {})
      }
    }
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const call = { ownerId: 'agent-1', ask: async () => null, signal: controller.signal }
    const pending = tab.run('scroll', { direction: 'down' }, call)
    await tick()
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: 'browser command aborted: scroll' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(await tab.run('scroll', { direction: 'up' })).toEqual({ ok: true })
  })
})

describe('BrowserTab refs', () => {
  it('clears refs on a main-frame navigation but keeps them for a child frame', async () => {
    const cdp = new FakeCdp()
    primeRead(cdp)
    const tab = makeTab(cdp)
    expect((await tab.run('read', {})).ok).toBe(true)
    expect((await tab.run('click', { ref: 'r1' })).ok).toBe(true)

    cdp.emit('Page.frameNavigated', { frame: { id: 'child', parentId: 'F1' } })
    expect((await tab.run('click', { ref: 'r1' })).ok).toBe(true)

    cdp.emit('Page.frameNavigated', { frame: { id: 'F1' } })
    expect(errorOf(await tab.run('click', { ref: 'r1' }))).toBe(
      'snapshot stale: re-read the page (ref r1 no longer valid)'
    )
  })
})

describe('BrowserTab buffers', () => {
  it('caps console entries at LOG_BUFFER_ENTRIES, dropping the oldest', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    for (let i = 1; i <= LOG_BUFFER_ENTRIES + 50; i++) {
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: `m${i}` }] })
    }
    const logs = tab.consoleLogs()
    expect(logs).toHaveLength(LOG_BUFFER_ENTRIES)
    expect(logs[0]).toEqual({ level: 'log', text: 'm51' })
    expect(logs[logs.length - 1]).toEqual({ level: 'log', text: `m${LOG_BUFFER_ENTRIES + 50}` })
    expect(tab.consoleLogs(3).map(l => l.text)).toEqual(['m248', 'm249', 'm250'])
  })

  it('captures exceptions and Log entries', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    cdp.emit('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: bad' } } })
    cdp.emit('Log.entryAdded', { entry: { level: 'warning', text: 'deprecated' } })
    expect(tab.consoleLogs()).toEqual([
      { level: 'error', text: 'Error: bad' },
      { level: 'warning', text: 'deprecated' }
    ])
  })

  it('pairs network requests with responses and failures', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    cdp.emit('Network.requestWillBeSent', { requestId: 'a', request: { method: 'GET', url: 'https://x/a' } })
    cdp.emit('Network.responseReceived', { requestId: 'a', response: { status: 200 } })
    cdp.emit('Network.requestWillBeSent', { requestId: 'b', request: { method: 'POST', url: 'https://x/b' } })
    cdp.emit('Network.loadingFailed', { requestId: 'b' })
    expect(tab.networkLogs()).toEqual([
      { method: 'GET', url: 'https://x/a', status: 200 },
      { method: 'POST', url: 'https://x/b', status: 'failed' }
    ])
  })

  it('caps network entries and the pending request map', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    for (let i = 1; i <= LOG_BUFFER_ENTRIES + 20; i++) {
      cdp.emit('Network.requestWillBeSent', { requestId: `n${i}`, request: { method: 'GET', url: `https://x/${i}` } })
      cdp.emit('Network.responseReceived', { requestId: `n${i}`, response: { status: 200 } })
    }
    const entries = tab.networkLogs()
    expect(entries).toHaveLength(LOG_BUFFER_ENTRIES)
    expect(entries[0]).toEqual({ method: 'GET', url: 'https://x/21', status: 200 })

    for (let i = 0; i < MAX_PENDING_REQUESTS + 5; i++) {
      cdp.emit('Network.requestWillBeSent', { requestId: `p${i}`, request: { method: 'GET', url: `https://p/${i}` } })
    }
    // The oldest requests fell out of the pairing map, so their responses add nothing.
    cdp.emit('Network.responseReceived', { requestId: 'p0', response: { status: 200 } })
    expect(tab.networkLogs().some(e => e.url === 'https://p/0')).toBe(false)
    cdp.emit('Network.responseReceived', { requestId: `p${MAX_PENDING_REQUESTS + 4}`, response: { status: 201 } })
    expect(tab.networkLogs().some(e => e.url === `https://p/${MAX_PENDING_REQUESTS + 4}` && e.status === 201)).toBe(true)
  })
})

describe('BrowserTab dialogs', () => {
  it('accepts alert/beforeunload, dismisses confirm/prompt and notes the next result', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    // The agent owns the tab while its command runs, so its dialogs are auto-answered.
    await tab.run('scroll', { direction: 'down' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hi' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'sure?' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'prompt', message: 'name?' })
    cdp.emit('Page.javascriptDialogOpening', { type: 'beforeunload', message: 'leave?' })
    await tick()
    const handled = cdp.calls
      .filter(c => c.method === 'Page.handleJavaScriptDialog')
      .map(c => (c.params as { accept: boolean }).accept)
    expect(handled).toEqual([true, false, false, true])

    const result = await tab.run('scroll', { direction: 'down' })
    expect(result.ok).toBe(true)
    const notice = (result as { data: { notice: string } }).data.notice
    expect(notice).toContain('dialog (alert): hi')
    expect(notice).toContain('dialog (confirm): sure?')
    expect(notice).toContain('dialog (prompt): name?')
    expect(notice).toContain('dialog (beforeunload): leave?')

    const next = await tab.run('scroll', { direction: 'down' })
    expect((next as { data?: { notice?: string } }).data?.notice).toBeUndefined()
    tab.destroy()
  })

  it('leaves dialogs to the user when the agent does not own the tab', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    // On screen, idle: Electron shows its own dialog, nothing is auto-answered.
    await tab.setOnScreen(true)
    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'sure?' })
    await tick()
    expect(cdp.calls.filter(c => c.method === 'Page.handleJavaScriptDialog')).toEqual([])
    expect((await tab.run('scroll', { direction: 'down' }) as { data?: { notice?: string } }).data?.notice)
      .toBeUndefined()

    // user hold: same, the dialog stays the user's.
    tab.takeOver()
    cdp.emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hi' })
    await tick()
    expect(cdp.calls.filter(c => c.method === 'Page.handleJavaScriptDialog')).toEqual([])
    tab.handBack()
    const resumed = await tab.run('scroll', { direction: 'down' })
    expect((resumed as { data?: { notice?: string } }).data?.notice ?? '').not.toContain('dialog (')
    tab.destroy()
  })

  it('auto-answers an off-screen idle dialog so an unseen page cannot pop one', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    await tab.setOnScreen(false)
    cdp.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'sure?' })
    await tick()
    expect(cdp.calls.filter(c => c.method === 'Page.handleJavaScriptDialog')).toEqual([
      { method: 'Page.handleJavaScriptDialog', params: { accept: false } }
    ])
    tab.destroy()
  })
})

describe('BrowserTab lifecycle', () => {
  it('lets navigate recover a crashed tab, then runs commands again', async () => {
    const cdp = new FakeCdp()
    const { host } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    tab.markCrashed()
    expect(tab.toInfo().crashed).toBe(true)
    expect(errorOf(await tab.run('click', { x: 1, y: 2 }))).toBe(
      'tab crashed; call browser_navigate to reload it'
    )
    expect((await tab.run('navigate', { url: 'http://127.0.0.1:4000/' })).ok).toBe(true)
    expect(tab.toInfo().crashed).toBe(false)
    expect((await tab.run('click', { x: 1, y: 2 })).ok).toBe(true)
  })

  it('allows reload on a crashed tab and clears crashed on a main-frame navigation', async () => {
    const cdp = new FakeCdp()
    const { host, state } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    tab.markCrashed()
    expect(await tab.run('reload')).toEqual({ ok: true })
    expect(state.history).toEqual(['reload'])
    cdp.emit('Page.frameNavigated', { frame: { id: 'F1' } })
    expect(tab.toInfo().crashed).toBe(false)
  })

  it('navigates through the host and reports the tab id, url and title', async () => {
    const cdp = new FakeCdp()
    const { host, state } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    const result = await tab.run('navigate', { url: 'https://example.org/' })
    expect(result).toEqual({
      ok: true,
      data: { tabId: 42, url: 'https://example.org/', title: 'Example' }
    })
    expect(state.url).toBe('https://example.org/')
  })

  it('reloads through the host and rejects commands the browser owns', async () => {
    const cdp = new FakeCdp()
    const { host, state } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    expect(await tab.run('reload')).toEqual({ ok: true })
    expect(state.history).toEqual(['reload'])
    expect(errorOf(await tab.run('openTab', { url: 'https://x' }))).toBe('unsupported command: openTab')
  })

  it('settles an in-flight command when the tab is destroyed', async () => {
    const cdp = new FakeCdp()
    cdp.onSend = (method) => (method === 'Runtime.evaluate' ? new Promise<void>(() => {}) : undefined)
    const { host } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    const pending = tab.run('scroll', { direction: 'down' })
    await tick()
    tab.destroy()
    expect(await pending).toEqual({ ok: false, error: 'tab closed' })
  })

  it('destroys the host and stops listening', () => {
    const cdp = new FakeCdp()
    const { host, state } = fakeHost(cdp)
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    tab.destroy()
    expect(state.destroyed).toBe(true)
    expect(() => cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [] })).not.toThrow()
  })

  it('browser-tab.ts and cdp-commands.ts do not import electron', () => {
    for (const file of ['browser-tab.ts', 'cdp-commands.ts']) {
      const source = readFileSync(path.join(process.cwd(), 'src/main/browser', file), 'utf-8')
      expect(source, file).not.toMatch(/from ['"]electron['"]|require\(['"]electron['"]\)/)
    }
  })
})

describe('BrowserTab control state', () => {
  function makeControlledTab(cdp: FakeCdp): {
    tab: BrowserTab
    host: TabHost
    state: {
      url: string
      title: string
      destroyed: boolean
      history: string[]
      shields: Array<{ visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }>
    }
    counter: { changes: number }
  } {
    const { host, state } = fakeHost(cdp)
    const counter = { changes: 0 }
    const tab = new BrowserTab(host, {
      agentId: 'agent-1',
      snapshotDir: dir,
      onControlChanged: () => { counter.changes++ }
    })
    return { tab, host, state, counter }
  }

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>(r => { resolve = r })
    return { promise, resolve }
  }

  it('acquires on a command and drops to idle when the lease expires', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      cdp.responses['Runtime.evaluate'] = { result: { value: true } }
      const { tab, state, counter } = makeControlledTab(cdp)
      expect(await tab.run('scroll', { direction: 'down' })).toEqual({ ok: true })
      expect(tab.toInfo().control).toBe('agent')
      expect(state.shields).toEqual([{ visible: true }])
      expect(counter.changes).toBe(1)

      await vi.advanceTimersByTimeAsync(CONTROL_LEASE_MS)
      expect(tab.toInfo().control).toBe('idle')
      expect(state.shields).toEqual([{ visible: true }, { visible: false }])
      expect(counter.changes).toBe(2)
      tab.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renews the lease on each command without notifying', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      cdp.responses['Runtime.evaluate'] = { result: { value: true } }
      const { tab, counter } = makeControlledTab(cdp)
      await tab.run('scroll', { direction: 'down' })
      await vi.advanceTimersByTimeAsync(CONTROL_LEASE_MS - 1000)
      await tab.run('scroll', { direction: 'up' })
      expect(tab.toInfo().control).toBe('agent')
      await vi.advanceTimersByTimeAsync(CONTROL_LEASE_MS - 1000)
      expect(tab.toInfo().control).toBe('agent')
      await vi.advanceTimersByTimeAsync(1000)
      expect(tab.toInfo().control).toBe('idle')
      expect(counter.changes).toBe(2)
      tab.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releaseLease ends an agent lease but never a user hold', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab, counter } = makeControlledTab(cdp)
    await tab.run('scroll', { direction: 'down' })
    tab.releaseLease()
    expect(tab.toInfo().control).toBe('idle')
    expect(counter.changes).toBe(2)

    tab.takeOver()
    expect(tab.toInfo().control).toBe('user')
    tab.releaseLease()
    expect(tab.toInfo().control).toBe('user')
    tab.destroy()
  })

  it('takeOver from idle sets user, from user is a no-op, and a finishing command keeps it', async () => {
    const cdp = new FakeCdp()
    const gate = deferred()
    cdp.onSend = (method) => (method === 'Runtime.evaluate' ? gate.promise : undefined)
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab, state } = makeControlledTab(cdp)

    tab.takeOver()
    expect(tab.toInfo().control).toBe('user')
    const shieldsBefore = state.shields.length
    tab.takeOver()
    expect(tab.toInfo().control).toBe('user')
    expect(state.shields.length).toBe(shieldsBefore)

    tab.handBack()
    const running = tab.run('scroll', { direction: 'down' })
    await tick()
    expect(tab.toInfo().control).toBe('agent')
    tab.takeOver()
    expect(tab.toInfo().control).toBe('user')
    expect(state.shields[state.shields.length - 1]).toEqual({ visible: false })

    gate.resolve()
    expect((await running).ok).toBe(true)
    expect(tab.toInfo().control).toBe('user')

    const behind = tab.run('scroll', { direction: 'up' })
    await tick()
    expect(cdp.calls.filter(c => c.method === 'Runtime.evaluate')).toHaveLength(1)
    tab.handBack()
    expect((await behind).ok).toBe(true)
    tab.destroy()
  })

  it('waits during a hold and resumes on hand-back with the notice', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab } = makeControlledTab(cdp)
    tab.takeOver()

    const waiting = tab.run('scroll', { direction: 'down' })
    await tick()
    expect(cdp.calls).toEqual([])
    tab.handBack()
    const result = await waiting
    expect(result.ok).toBe(true)
    expect((result as { data: { notice: string } }).data.notice).toContain('[meow] The user held this tab')
    tab.destroy()
  })

  it('applies the notice to a command that arrives after the hand-back', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab } = makeControlledTab(cdp)
    tab.takeOver()
    tab.handBack()
    const result = await tab.run('scroll', { direction: 'down' })
    expect((result as { data: { notice: string } }).data.notice).toContain('[meow] The user held this tab')
    const next = await tab.run('scroll', { direction: 'up' })
    expect((next as { data?: { notice?: string } }).data?.notice).toBeUndefined()
    tab.destroy()
  })

  it('clears refs on hand-back and lets a stale error carry the notice', async () => {
    const cdp = new FakeCdp()
    primeRead(cdp)
    const { tab } = makeControlledTab(cdp)
    expect((await tab.run('read', {})).ok).toBe(true)
    tab.takeOver()
    tab.handBack()
    const result = await tab.run('click', { ref: 'r1' })
    expect(result.ok).toBe(false)
    const error = (result as { error: string }).error
    expect(error).toContain('snapshot stale')
    expect(error).toContain('[meow] The user held this tab')
    tab.destroy()
  })

  it('read and closeTab wait during a hold', async () => {
    const cdp = new FakeCdp()
    primeRead(cdp)
    const { tab } = makeControlledTab(cdp)
    tab.takeOver()
    const read = tab.run('read', {})
    const close = tab.run('closeTab')
    await tick()
    expect(cdp.calls).toEqual([])
    tab.handBack()
    expect((await read).ok).toBe(true)
    expect(await close).toEqual({ ok: true })
    tab.destroy()
  })

  it('settles a waiting command on abort and removes its listener', async () => {
    const cdp = new FakeCdp()
    const { tab } = makeControlledTab(cdp)
    tab.takeOver()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const waiting = tab.run('scroll', { direction: 'down' }, {
      ownerId: 'agent-1',
      ask: async () => null,
      signal: controller.signal
    })
    await tick()
    controller.abort()
    expect(await waiting).toEqual({ ok: false, error: 'browser command aborted: scroll' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    tab.handBack()
    expect((await tab.run('scroll', { direction: 'down' })).ok).toBe(true)
    tab.destroy()
  })

  it('gives up on a hold after USER_HOLD_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      const { tab } = makeControlledTab(cdp)
      tab.takeOver()
      const waiting = tab.run('read', {})
      await vi.advanceTimersByTimeAsync(USER_HOLD_TIMEOUT_MS)
      expect(await waiting).toEqual({ ok: false, error: 'user is holding this tab' })
      expect(vi.getTimerCount()).toBe(0)
      tab.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a waiting command when the tab is destroyed', async () => {
    const cdp = new FakeCdp()
    const { tab } = makeControlledTab(cdp)
    tab.takeOver()
    const waiting = tab.run('read', {})
    await tick()
    tab.destroy()
    expect(await waiting).toEqual({ ok: false, error: 'tab closed' })
  })

  it('keeps the lease timer from outliving the tab', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      cdp.responses['Runtime.evaluate'] = { result: { value: true } }
      const { tab } = makeControlledTab(cdp)
      await tab.run('scroll', { direction: 'down' })
      expect(vi.getTimerCount()).toBe(1)
      tab.destroy()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BrowserTab shield', () => {
  it('shows the shield while the agent owns the tab and hides it on take over', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab, state } = makeControlledTabForShield(cdp)
    await tab.run('scroll', { direction: 'down' })
    expect(state.shields).toEqual([{ visible: true }])
    tab.takeOver()
    expect(state.shields).toEqual([{ visible: true }, { visible: false }])
    tab.destroy()
  })

  it('passes the click target rect to the shield', async () => {
    const cdp = new FakeCdp()
    cdp.responses['DOM.getDocument'] = { root: { nodeId: 1 } }
    cdp.responses['DOM.querySelector'] = { nodeId: 7 }
    cdp.responses['DOM.getBoxModel'] = { model: { content: [10, 20, 110, 20, 110, 70, 10, 70], width: 100, height: 50 } }
    const { tab, state } = makeControlledTabForShield(cdp)
    expect((await tab.run('click', { selector: '#b' })).ok).toBe(true)
    const withTarget = state.shields.filter(entry => entry.target)
    expect(withTarget).toEqual([{ visible: true, target: { x: 10, y: 20, w: 100, h: 50, label: 'Meow' } }])
    tab.destroy()
  })

  it('does not fail a command when the shield throws', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { host } = fakeHost(cdp)
    host.setShield = () => { throw new Error('shield boom') }
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    expect((await tab.run('scroll', { direction: 'down' })).ok).toBe(true)
    tab.destroy()
  })

  function makeControlledTabForShield(cdp: FakeCdp): {
    tab: BrowserTab
    state: { shields: Array<{ visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }> }
  } {
    const { host, state } = fakeHost(cdp)
    return { tab: new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir }), state }
  }
})

describe('BrowserTab logs during a hold', () => {
  function makeTab(cdp: FakeCdp): BrowserTab {
    return new BrowserTab(fakeHost(cdp).host, { agentId: 'agent-1', snapshotDir: dir })
  }

  it('hides entries captured while the user holds the tab from the agent path', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'before' }] })
    cdp.emit('Network.requestWillBeSent', { requestId: 'a', request: { method: 'GET', url: 'https://x/before' } })
    cdp.emit('Network.responseReceived', { requestId: 'a', response: { status: 200 } })

    tab.takeOver()
    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'held' }] })
    cdp.emit('Network.requestWillBeSent', { requestId: 'b', request: { method: 'GET', url: 'https://x/token?code=secret' } })
    cdp.emit('Network.responseReceived', { requestId: 'b', response: { status: 200 } })

    expect(tab.consoleLogs().map(e => e.text)).toEqual(['before'])
    expect(tab.allConsoleLogs().map(e => e.text)).toEqual(['before', 'held'])
    expect(tab.networkLogs().map(e => e.url)).toEqual(['https://x/before'])
    expect(tab.allNetworkLogs().map(e => e.url)).toEqual(['https://x/before', 'https://x/token?code=secret'])

    tab.handBack()
    expect(tab.consoleLogs().map(e => e.text)).toEqual(['before'])
    expect(tab.allConsoleLogs().map(e => e.text)).toEqual(['before', 'held'])

    cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'after' }] })
    expect(tab.consoleLogs().map(e => e.text)).toEqual(['before', 'after'])
    expect(tab.allConsoleLogs().map(e => e.text)).toEqual(['before', 'held', 'after'])
    tab.destroy()
  })

  it('keeps a request private when it starts during a hold and ends after hand-back', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    tab.takeOver()
    cdp.emit('Network.requestWillBeSent', {
      requestId: 'signin',
      request: { method: 'POST', url: 'https://x/signin?code=secret' }
    })
    tab.handBack()
    cdp.emit('Network.responseReceived', { requestId: 'signin', response: { status: 200 } })
    expect(tab.networkLogs()).toEqual([])
    expect(tab.allNetworkLogs()).toEqual([
      { method: 'POST', url: 'https://x/signin?code=secret', status: 200 }
    ])
    tab.destroy()
  })

  it('still counts marked entries toward the buffer cap', () => {
    const cdp = new FakeCdp()
    const tab = makeTab(cdp)
    tab.takeOver()
    for (let i = 0; i < LOG_BUFFER_ENTRIES + 50; i++) {
      cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: `m${i}` }] })
    }
    expect(tab.allConsoleLogs()).toHaveLength(LOG_BUFFER_ENTRIES)
    expect(tab.consoleLogs()).toEqual([])
    tab.destroy()
  })
})

describe('BrowserTab site approval', () => {
  function makeApprovalTab(
    cdp: FakeCdp,
    options: { url?: string; siteApproval?: () => 'ask' | 'off'; approvals?: SiteApprovals } = {}
  ): {
    tab: BrowserTab
    state: { url: string; shields: Array<{ visible: boolean; target?: unknown }> }
    approvals: SiteApprovals
  } {
    const { host, state } = fakeHost(cdp)
    if (options.url) state.url = options.url
    const approvals = options.approvals ?? new SiteApprovals()
    const tab = new BrowserTab(host, {
      agentId: 'agent-1',
      snapshotDir: dir,
      siteApprovals: approvals,
      siteApproval: options.siteApproval ?? (() => 'ask')
    })
    return { tab, state, approvals }
  }

  function primeClick(cdp: FakeCdp): void {
    cdp.responses['DOM.getDocument'] = { root: { nodeId: 1 } }
    cdp.responses['DOM.querySelector'] = { nodeId: 7 }
    cdp.responses['DOM.getBoxModel'] = { model: { content: [10, 20, 110, 20, 110, 70, 10, 70], width: 100, height: 50 } }
  }

  it('prompts once per click on a non-loopback site and allows once', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/page' })

    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    const prompt = ask.mock.calls[0][0]
    expect(prompt.header).toBe('Allow Meow to act on this site?')
    expect(prompt.question.split('\n')[0]).toBe('Allow Meow to act on this site?')
    expect(prompt.question).toContain('browser_click on https://example.com')
    expect(prompt.question).toContain('Target: selector #b')
    expect(prompt.options?.map(o => o.label)).toEqual(['Allow once', 'Allow this site for the session', 'Deny'])
    expect(prompt.custom).toBe(false)
    expect(tab.toInfo().control).toBe('agent')

    // Allow once records nothing: the next click asks again.
    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    tab.destroy()
  })

  it('Allow this site for the session skips the next prompt for that origin', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow this site for the session')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    tab.destroy()
  })

  it('Deny and null/unknown answers block the command before any input', async () => {
    for (const answer of ['Deny', null, 'Something else']) {
      const cdp = new FakeCdp()
      primeClick(cdp)
      const ask = vi.fn(async (_q: QuestionPrompt) => answer)
      const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
      const result = await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
      expect(result).toEqual({ ok: false, error: 'not approved: https://example.com' })
      expect(cdp.calls).toEqual([])
      tab.destroy()
    }
  })

  it('fails when the origin changes during the prompt and records nothing', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const { tab, state } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    const ask = vi.fn(async (_q: QuestionPrompt) => {
      state.url = 'https://other.example/'
      return 'Allow this site for the session'
    })
    const result = await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
    expect(result).toEqual({
      ok: false,
      error: 'page changed during approval (now https://other.example): re-read it'
    })
    // Nothing was recorded for either origin: the next click asks again.
    ask.mockImplementationOnce(async () => 'Deny')
    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(false)
    expect(ask).toHaveBeenCalledTimes(2)
    tab.destroy()
  })

  it('does not prompt when site approval is off', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Deny')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/', siteApproval: () => 'off' })
    expect((await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    tab.destroy()
  })

  it('never prompts for a stale ref', async () => {
    const cdp = new FakeCdp()
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    const result = await tab.run('click', { ref: 'r9' }, { ownerId: 'agent-1', ask })
    expect(result).toEqual({ ok: false, error: 'snapshot stale: re-read the page (ref r9 no longer valid)' })
    expect(ask).not.toHaveBeenCalled()
    tab.destroy()
  })

  it('shows what the page calls the target and collapses the name', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    cdp.responses['Page.getFrameTree'] = { frameTree: { frame: { id: 'F1' } } }
    const longName = `  Delete\n   workspace ${'x'.repeat(120)} `
    cdp.responses['Accessibility.getFullAXTree'] = {
      nodes: [
        { nodeId: '1', role: { value: 'rootwebarea' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: longName }, backendDOMNodeId: 12 }
      ]
    }
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Deny')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    await tab.run('read', {})
    await tab.run('click', { ref: 'r1' }, { ownerId: 'agent-1', ask })
    const question = ask.mock.calls[0][0].question
    const target = question.split('\n')[2]
    expect(target.startsWith('Target: button "Delete workspace x')).toBe(true)
    expect(target).not.toContain('  ')
    const quoted = target.slice('Target: button "'.length, -1)
    expect(quoted.length).toBeLessThanOrEqual(80)
    tab.destroy()
  })

  it('labels coordinate and selector targets', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    await tab.run('click', { x: 12, y: 34 }, { ownerId: 'agent-1', ask })
    expect(ask.mock.calls[0][0].question).toContain('Target: at 12,34')
    await tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
    expect(ask.mock.calls[1][0].question).toContain('Target: selector #b')
    tab.destroy()
  })

  it('does not gate read, scroll or navigate', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    primeRead(cdp)
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Deny')
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    expect((await tab.run('read', {}, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect((await tab.run('scroll', { direction: 'down' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect((await tab.run('navigate', { url: 'https://example.com/next' }, { ownerId: 'agent-1', ask })).ok).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    tab.destroy()
  })

  it('shares approvals per owner and survives another owner', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const approvals = new SiteApprovals()
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow this site for the session')
    const first = makeApprovalTab(cdp, { url: 'https://example.com/', approvals })
    await first.tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
    expect(approvals.isAllowed('agent-1', 'https://example.com')).toBe(true)
    expect(approvals.isAllowed('agent-2', 'https://example.com')).toBe(false)
    first.tab.destroy()
  })

  it('shows approval during the prompt and goes back to agent after the answer', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    let release: (value: string) => void = () => {}
    const ask = vi.fn((_q: QuestionPrompt) => new Promise<string | null>(resolve => { release = resolve }))
    const { tab, state } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    const pending = tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
    await tick()
    expect(tab.toInfo().control).toBe('approval')
    expect(state.shields[state.shields.length - 1]).toEqual({ visible: true })
    // Take over has no transition from approval, and releaseLease must not unstick it.
    tab.takeOver()
    tab.releaseLease()
    expect(tab.toInfo().control).toBe('approval')
    release('Allow once')
    expect((await pending).ok).toBe(true)
    expect(tab.toInfo().control).toBe('agent')
    tab.destroy()
  })

  it('settles a pending prompt on abort and drops the lease afterwards', async () => {
    vi.useFakeTimers()
    try {
      const cdp = new FakeCdp()
      primeClick(cdp)
      const ask = vi.fn((_q: QuestionPrompt) => new Promise<string | null>(() => {}))
      const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
      const controller = new AbortController()
      const pending = tab.run('click', { selector: '#b' }, {
        ownerId: 'agent-1', ask, signal: controller.signal
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(tab.toInfo().control).toBe('approval')
      controller.abort()
      expect(await pending).toEqual({ ok: false, error: 'browser command aborted: click' })
      expect(tab.toInfo().control).toBe('agent')
      await vi.advanceTimersByTimeAsync(CONTROL_LEASE_MS)
      expect(tab.toInfo().control).toBe('idle')
      tab.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a pending prompt when the tab is destroyed', async () => {
    const cdp = new FakeCdp()
    primeClick(cdp)
    const ask = vi.fn((_q: QuestionPrompt) => new Promise<string | null>(() => {}))
    const { tab } = makeApprovalTab(cdp, { url: 'https://example.com/' })
    const pending = tab.run('click', { selector: '#b' }, { ownerId: 'agent-1', ask })
    await tick()
    tab.destroy()
    expect(await pending).toEqual({ ok: false, error: 'tab closed' })
  })
})

describe('BrowserTab sensitive fields', () => {
  function makeSensitiveTab(cdp: FakeCdp, url = 'https://example.com/'): {
    tab: BrowserTab
    state: { url: string; shields: Array<{ visible: boolean }> }
  } {
    const { host, state } = fakeHost(cdp)
    state.url = url
    cdp.responses['DOM.resolveNode'] = { object: { objectId: 'obj-1' } }
    cdp.responses['DOM.getDocument'] = { root: { nodeId: 1 } }
    cdp.responses['DOM.querySelector'] = { nodeId: 7 }
    const tab = new BrowserTab(host, { agentId: 'agent-1', snapshotDir: dir })
    return { tab, state }
  }

  it('refuses a password ref before any approval prompt', async () => {
    const cdp = new FakeCdp()
    primeRead(cdp)
    cdp.callFunctionOnValues = ['password']
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeSensitiveTab(cdp)
    expect((await tab.run('read', {})).ok).toBe(true)
    const result = await tab.run('type', { ref: 'r1', text: 'secret' }, { ownerId: 'agent-1', ask })
    expect((result as { error: string }).error).toContain('browser_type refused')
    expect((result as { error: string }).error).toContain('browser_handoff')
    expect(ask).not.toHaveBeenCalled()
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(false)
    tab.destroy()
  })

  it('refuses a payment selector before any approval prompt', async () => {
    const cdp = new FakeCdp()
    cdp.callFunctionOnValues = ['payment']
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeSensitiveTab(cdp)
    const result = await tab.run('type', { selector: '#card', text: '4111' }, { ownerId: 'agent-1', ask })
    expect((result as { error: string }).error).toContain('browser_type refused')
    expect(ask).not.toHaveBeenCalled()
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(false)
    tab.destroy()
  })

  it('returns the stale error for an unknown ref and never prompts', async () => {
    const cdp = new FakeCdp()
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeSensitiveTab(cdp)
    const result = await tab.run('type', { ref: 'r9', text: 'x' }, { ownerId: 'agent-1', ask })
    expect(result).toEqual({ ok: false, error: 'snapshot stale: re-read the page (ref r9 no longer valid)' })
    expect(ask).not.toHaveBeenCalled()
    expect(cdp.calls).toEqual([])
    tab.destroy()
  })

  it('fails closed when the sensitive check itself errors', async () => {
    const cdp = new FakeCdp()
    cdp.onSend = (method) => {
      if (method === 'Runtime.callFunctionOn') throw new Error('call failed')
    }
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeSensitiveTab(cdp)
    const result = await tab.run('type', { selector: '#q', text: 'x' }, { ownerId: 'agent-1', ask })
    expect((result as { error: string }).error).toContain('sensitive check failed')
    expect(ask).not.toHaveBeenCalled()
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(false)
    tab.destroy()
  })

  it('refuses a field that becomes sensitive during the approval prompt', async () => {
    const cdp = new FakeCdp()
    primeRead(cdp)
    // Pipeline check: not sensitive. Then type's internal check after approval: password.
    cdp.callFunctionOnValues = [null, true, 'password']
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Allow once')
    const { tab } = makeSensitiveTab(cdp)
    expect((await tab.run('read', {})).ok).toBe(true)
    const result = await tab.run('type', { ref: 'r1', text: 'secret' }, { ownerId: 'agent-1', ask })
    expect((result as { error: string }).error).toContain('browser_type refused')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(false)
    tab.destroy()
  })
})

describe('BrowserTab handoff', () => {
  function makeHandoffTab(cdp: FakeCdp): {
    tab: BrowserTab
    state: { url: string; shields: Array<{ visible: boolean }> }
    reasons: string[]
  } {
    const { host, state } = fakeHost(cdp)
    state.url = 'https://example.com/signin'
    const reasons: string[] = []
    const tab = new BrowserTab(host, {
      agentId: 'agent-1',
      snapshotDir: dir,
      onHandoff: reason => reasons.push(reason)
    })
    return { tab, state, reasons }
  }

  it('enters user with the reason and resolves on hand-back with originChanged', async () => {
    const cdp = new FakeCdp()
    const { tab, state, reasons } = makeHandoffTab(cdp)
    const pending = tab.run('handoff', { reason: '  Sign in  ' })
    await tick()
    expect(tab.toInfo().control).toBe('user')
    expect(tab.toInfo().holdReason).toBe('Sign in')
    expect(reasons).toEqual(['Sign in'])
    expect(state.shields[state.shields.length - 1]).toEqual({ visible: false })

    state.url = 'https://accounts.example.com/account'
    tab.handBack()
    expect(await pending).toEqual({ ok: true, data: { originChanged: true } })
    expect(tab.toInfo().control).toBe('idle')
    tab.destroy()
  })

  it('reports originChanged false when the page stays put', async () => {
    const cdp = new FakeCdp()
    const { tab } = makeHandoffTab(cdp)
    const pending = tab.run('handoff', { reason: 'Sign in' })
    await tick()
    tab.handBack()
    expect(await pending).toEqual({ ok: true, data: { originChanged: false } })
    tab.destroy()
  })

  it('holds the queue while the user signs in', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const { tab } = makeHandoffTab(cdp)
    const handoff = tab.run('handoff', { reason: 'Sign in' })
    await tick()
    const queued = tab.run('scroll', { direction: 'down' })
    await tick()
    expect(cdp.calls).toEqual([])
    tab.handBack()
    expect((await handoff).ok).toBe(true)
    expect((await queued).ok).toBe(true)
    tab.destroy()
  })

  it('on abort stays user, clears the reason and settles with the abort error', async () => {
    const cdp = new FakeCdp()
    const { tab } = makeHandoffTab(cdp)
    const controller = new AbortController()
    const pending = tab.run('handoff', { reason: 'Sign in' }, {
      ownerId: 'agent-1', ask: async () => null, signal: controller.signal
    })
    await tick()
    controller.abort()
    expect(await pending).toEqual({ ok: false, error: 'browser command aborted: browser_handoff' })
    expect(tab.toInfo().control).toBe('user')
    expect(tab.toInfo().holdReason).toBeUndefined()
    tab.handBack()
    expect(tab.toInfo().control).toBe('idle')
    tab.destroy()
  })


  it('settles with tab closed when the tab is destroyed', async () => {
    const cdp = new FakeCdp()
    const { tab } = makeHandoffTab(cdp)
    const pending = tab.run('handoff', { reason: 'Sign in' })
    await tick()
    tab.destroy()
    expect(await pending).toEqual({ ok: false, error: 'tab closed' })
  })

  it('requires a reason, trims and caps it, and skips site approval', async () => {
    const cdp = new FakeCdp()
    const ask = vi.fn(async (_q: QuestionPrompt) => 'Deny')
    const { tab } = makeHandoffTab(cdp)
    expect((await tab.run('handoff', { reason: '   ' })).error).toContain('requires a reason')

    const pending = tab.run('handoff', { reason: 'x'.repeat(300) }, { ownerId: 'agent-1', ask })
    await tick()
    expect(tab.toInfo().holdReason).toHaveLength(200)
    expect(ask).not.toHaveBeenCalled()
    tab.handBack()
    await pending
    tab.destroy()
  })
})
