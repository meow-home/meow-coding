import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserTab, LOG_BUFFER_ENTRIES, MAX_PENDING_REQUESTS } from '../../../src/main/browser/browser-tab'
import type { CdpClient, TabHost } from '../../../src/main/browser/browser-tab'
import type { BrowserCommandResult } from '../../../src/shared/browser-types'

class FakeCdp implements CdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses: Record<string, unknown> = {}
  onSend: ((method: string) => Promise<void> | void) | null = null
  private listeners: Array<(method: string, params: unknown) => void> = []

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (this.onSend) await this.onSend(method)
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
  state: { url: string; title: string; destroyed: boolean; history: string[] }
} {
  const state = { url: 'https://example.com/', title: 'Example', destroyed: false, history: [] as string[] }
  const host: TabHost = {
    id: 42,
    cdp,
    getUrl: () => state.url,
    getTitle: () => state.title,
    loadUrl: async (url) => { state.url = url },
    history: (action) => { state.history.push(action) },
    navState: () => ({ loading: false, canGoBack: true, canGoForward: false }),
    setShield: () => {},
    setBounds: () => {},
    setVisible: () => {},
    setOffscreenMetrics: async () => {},
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
      url: 'https://example.com/',
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
  })
})

describe('BrowserTab lifecycle', () => {
  it('refuses commands while crashed and recovers on a navigation', async () => {
    const cdp = new FakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    const tab = makeTab(cdp)
    tab.markCrashed()
    expect(tab.toInfo().crashed).toBe(true)
    expect(errorOf(await tab.run('scroll', { direction: 'down' }))).toBe('tab crashed; reload it')
    cdp.emit('Page.frameNavigated', { frame: { id: 'F1' } })
    expect(tab.toInfo().crashed).toBe(false)
    expect((await tab.run('scroll', { direction: 'down' })).ok).toBe(true)
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
