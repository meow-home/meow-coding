import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EmbeddedBrowser, MAX_TABS_PER_SESSION, MAX_TABS_TOTAL } from '../../../src/main/browser/embedded-browser'
import type { HostCallbacks } from '../../../src/main/browser/embedded-browser'
import type { CdpClient, TabHost } from '../../../src/main/browser/browser-tab'
import type { BrowserCall } from '../../../src/main/browser/browser-backend'
import type { BrowserCommandResult } from '../../../src/shared/browser-types'

class FakeCdp implements CdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  onSend: ((method: string) => Promise<void> | void) | null = null
  private listeners: Array<(method: string, params: unknown) => void> = []

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (this.onSend) await this.onSend(method)
    return {} as T
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

class FakeHost implements TabHost {
  private static nextId = 500
  readonly id: number
  readonly cdp = new FakeCdp()
  loaded: string[] = []
  destroyed = false
  onScreen = false
  bounds: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 }
  visible = true
  captureImpl: (() => Promise<string>) | null = null
  setOnScreenCalls = 0
  setBoundsCalls = 0
  onScreenAtLoad: boolean | null = null
  setOnScreenImpl: ((onScreen: boolean) => Promise<void>) | null = null

  constructor() {
    this.id = FakeHost.nextId++
  }

  getUrl(): string {
    return this.loaded[this.loaded.length - 1] ?? 'about:blank'
  }

  getTitle(): string {
    return `title:${this.getUrl()}`
  }

  async loadUrl(url: string): Promise<void> {
    this.onScreenAtLoad = this.onScreen
    this.loaded.push(url)
  }

  history(): void {}

  navState(): { loading: boolean; canGoBack: boolean; canGoForward: boolean } {
    return { loading: false, canGoBack: false, canGoForward: false }
  }

  setShield(): void {}

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.setBoundsCalls++
    this.bounds = { ...bounds }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  async setOnScreen(onScreen: boolean, bounds?: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.setOnScreenCalls++
    if (this.setOnScreenImpl) await this.setOnScreenImpl(onScreen)
    this.onScreen = onScreen
    if (bounds) this.bounds = { ...bounds }
    // On screen honors the requested visibility (setVisible); off screen is the
    // background placement, which is visible but at 10000,10000.
    if (!onScreen) this.visible = true
  }

  async capture(): Promise<string> {
    if (this.captureImpl) return this.captureImpl()
    return 'data:image/png;base64,'
  }

  destroy(): void {
    this.destroyed = true
  }
}

const call = (ownerId: string): BrowserCall => ({ ownerId, ask: async () => null })

function errorOf(result: BrowserCommandResult): string {
  if (result.ok) throw new Error('expected an error result')
  return result.error
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-embedded-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function makeBrowser(options: {
  hasWindow?: () => boolean
  getZoomFactor?: () => number
  clearData?: () => Promise<void>
  onError?: (message: string) => void
} = {}): {
  browser: EmbeddedBrowser
  hosts: FakeHost[]
  callbacks: HostCallbacks[]
} {
  const hosts: FakeHost[] = []
  const callbacks: HostCallbacks[] = []
  const browser = new EmbeddedBrowser({
    createHost: (_ownerId, cb) => {
      callbacks.push(cb)
      const host = new FakeHost()
      hosts.push(host)
      return host
    },
    snapshotDir: dir,
    ...options
  })
  return { browser, hosts, callbacks }
}

describe('EmbeddedBrowser tabs', () => {
  it('starts ready on the built-in backend', async () => {
    const { browser } = makeBrowser()
    expect(await browser.start(call('a'))).toEqual({ output: 'browser ready (built-in)' })
  })

  it('creates a tab on navigate when the session has none', async () => {
    const { browser, hosts } = makeBrowser()
    const result = await browser.execute('navigate', { url: 'https://a.test/' }, call('a'))
    expect(result).toEqual({
      ok: true,
      data: { tabId: hosts[0].id, url: 'https://a.test/', title: 'title:https://a.test/' }
    })
    expect(browser.listTabs('a')).toHaveLength(1)
    expect(hosts).toHaveLength(1)
  })

  it('enforces the per-session and total tab caps', async () => {
    const { browser } = makeBrowser()
    for (let i = 0; i < MAX_TABS_PER_SESSION; i++) {
      expect((await browser.execute('openTab', { url: `https://a.test/${i}` }, call('a'))).ok).toBe(true)
    }
    expect(errorOf(await browser.execute('openTab', { url: 'https://a.test/x' }, call('a')))).toContain(
      `${MAX_TABS_PER_SESSION} per session`
    )
    expect(MAX_TABS_TOTAL).toBe(MAX_TABS_PER_SESSION)
    expect(errorOf(await browser.execute('openTab', { url: 'https://b.test/' }, call('b')))).toContain(
      `${MAX_TABS_TOTAL} total`
    )
  })

  it('navigates the working tab, then the tab selected with switchTab', async () => {
    const { browser, hosts } = makeBrowser()
    const first = await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    const second = await browser.execute('openTab', { url: 'https://a.test/2' }, call('a'))
    const firstId = (first as { data: { tabId: number } }).data.tabId
    const secondId = (second as { data: { tabId: number } }).data.tabId

    // The last opened tab is the working tab; navigate reuses it instead of creating one.
    expect((await browser.execute('navigate', { url: 'https://a.test/3' }, call('a'))).ok).toBe(true)
    expect(hosts).toHaveLength(2)
    expect(hosts[1].loaded).toEqual(['https://a.test/2', 'https://a.test/3'])

    expect(await browser.execute('switchTab', { tabId: firstId }, call('a'))).toEqual({ ok: true })
    expect((await browser.execute('navigate', { url: 'https://a.test/4' }, call('a'))).ok).toBe(true)
    expect(hosts[0].loaded).toEqual(['https://a.test/1', 'https://a.test/4'])
    expect(secondId).toBe(hosts[1].id)
  })

  it('targets an explicit tab id and rejects ids from another session', async () => {
    const { browser, hosts } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    const foreign = hosts[0].id
    await browser.execute('openTab', { url: 'https://b.test/1' }, call('b'))

    expect((await browser.execute('navigate', { url: 'https://a.test/2', tabId: foreign }, call('a'))).ok).toBe(true)
    expect(errorOf(await browser.execute('navigate', { url: 'https://b.test/x', tabId: foreign }, call('b')))).toBe(
      `no such tab: ${foreign}`
    )
    expect(errorOf(await browser.execute('click', { ref: 'r1', tabId: foreign }, call('b')))).toBe(
      `no such tab: ${foreign}`
    )
    expect(errorOf(await browser.execute('click', { ref: 'r1', tabId: 999_999 }, call('a')))).toBe(
      'no such tab: 999999'
    )
  })

  it('closes a tab through the tab command and moves the working tab', async () => {
    const { browser, hosts } = makeBrowser()
    const first = await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    const second = await browser.execute('openTab', { url: 'https://a.test/2' }, call('a'))
    const firstId = (first as { data: { tabId: number } }).data.tabId
    const secondId = (second as { data: { tabId: number } }).data.tabId

    expect(await browser.execute('closeTab', { tabId: secondId }, call('a'))).toEqual({ ok: true })
    expect(hosts[1].destroyed).toBe(true)
    expect(browser.listTabs('a').map(t => t.id)).toEqual([firstId])
    // The remaining tab becomes the working tab.
    expect((await browser.execute('navigate', { url: 'https://a.test/3' }, call('a'))).ok).toBe(true)
    expect(hosts[0].loaded).toEqual(['https://a.test/1', 'https://a.test/3'])
  })

  it('removes a session: destroys its hosts and keeps other sessions', async () => {
    const { browser, hosts } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    await browser.execute('openTab', { url: 'https://a.test/2' }, call('a'))
    await browser.execute('openTab', { url: 'https://b.test/1' }, call('b'))

    browser.removeSession('a')
    expect(hosts[0].destroyed).toBe(true)
    expect(hosts[1].destroyed).toBe(true)
    expect(hosts[2].destroyed).toBe(false)
    expect(browser.listTabs('a')).toEqual([])
    expect(browser.listTabs('b')).toHaveLength(1)
    expect(errorOf(await browser.execute('click', { ref: 'r1' }, call('a')))).toBe('no target tab')
  })

  it('settles an in-flight command when the session is removed', async () => {
    const { browser, hosts } = makeBrowser()
    // Loopback so the click is not gated by site approval and reaches CDP.
    await browser.execute('openTab', { url: 'http://127.0.0.1:3000/' }, call('a'))
    hosts[0].cdp.onSend = (method) => (method === 'DOM.getDocument' ? new Promise<void>(() => {}) : undefined)
    const pending = browser.execute('click', { selector: '#a' }, call('a'))
    await tick()
    browser.removeSession('a')
    expect(await pending).toEqual({ ok: false, error: 'tab closed' })
  })

  it('closeAll destroys every tab', async () => {
    const { browser, hosts } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    await browser.execute('openTab', { url: 'https://b.test/1' }, call('b'))
    browser.closeAll()
    expect(hosts.every(h => h.destroyed)).toBe(true)
    expect(browser.listTabs('a')).toEqual([])
    expect(browser.listTabs('b')).toEqual([])
  })

  it('returns no target tab for a command without one', async () => {
    const { browser } = makeBrowser()
    expect(errorOf(await browser.execute('click', { ref: 'r1' }, call('a')))).toBe('no target tab')
  })

  it('fails clearly when the app has no window', async () => {
    const { browser } = makeBrowser({ hasWindow: () => false })
    expect(errorOf(await browser.execute('navigate', { url: 'https://a.test/' }, call('a')))).toBe(
      'browser unavailable: no app window'
    )
  })
})

describe('EmbeddedBrowser events', () => {
  it('requests the panel only for tabs the agent created', async () => {
    const { browser, callbacks } = makeBrowser()
    const requested: string[] = []
    browser.onPanelRequest(agentId => requested.push(agentId))

    await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    expect(requested).toEqual(['a'])

    // A window.open from a page creates a tab but does not pull the panel open.
    callbacks[0].onWindowOpen('https://popup.test/')
    expect(requested).toEqual(['a'])
    expect(browser.listTabs('a')).toHaveLength(2)
  })

  it('does not move the working tab to a page-opened popup', async () => {
    const { browser, hosts, callbacks } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    callbacks[0].onWindowOpen('https://popup.test/')
    expect(hosts).toHaveLength(2)
    // Untargeted command still drives the tab the agent used, not the popup.
    expect((await browser.execute('navigate', { url: 'https://a.test/2' }, call('a'))).ok).toBe(true)
    expect(hosts[0].loaded).toEqual(['https://a.test/1', 'https://a.test/2'])
    expect(hosts[1].loaded).toEqual(['https://popup.test/'])
  })

  it('emits the owner tab list and active tab on change', async () => {
    const { browser } = makeBrowser()
    const events: Array<{ agentId: string; ids: number[]; active: number | null }> = []
    browser.onTabsChanged((agentId, tabs, activeTabId) => {
      events.push({ agentId, ids: tabs.map(t => t.id), active: activeTabId })
    })
    const created = await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    const tabId = (created as { data: { tabId: number } }).data.tabId
    expect(events[events.length - 1]).toEqual({ agentId: 'a', ids: [tabId], active: tabId })
    browser.removeSession('a')
    expect(events[events.length - 1]).toEqual({ agentId: 'a', ids: [], active: null })
  })

  it('reports the control state by page webContents id', async () => {
    const { browser, hosts } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/' }, call('a'))
    expect(browser.controlOf(hosts[0].id)).toBe('agent')
    browser.releaseOwner('a')
    expect(browser.controlOf(hosts[0].id)).toBe('idle')
    expect(browser.controlOf(12_345)).toBeNull()
  })
})

describe('EmbeddedBrowser control', () => {
  it('releaseOwner releases only the leases of that owner', async () => {
    const { browser, hosts } = makeBrowser()
    await browser.execute('openTab', { url: 'https://a.test/' }, call('a'))
    await browser.execute('openTab', { url: 'https://b.test/' }, call('b'))
    await browser.execute('scroll', { direction: 'down' }, call('a'))
    await browser.execute('scroll', { direction: 'down' }, call('b'))
    expect(browser.listTabs('a')[0].control).toBe('agent')
    expect(browser.listTabs('b')[0].control).toBe('agent')

    browser.releaseOwner('a')
    expect(browser.listTabs('a')[0].control).toBe('idle')
    expect(browser.listTabs('b')[0].control).toBe('agent')
    expect(hosts).toHaveLength(2)
  })

  it('takes over and hands back a tab by id', async () => {
    const { browser, hosts } = makeBrowser()
    const created = await browser.execute('openTab', { url: 'https://a.test/' }, call('a'))
    const tabId = (created as { data: { tabId: number } }).data.tabId
    browser.takeOver(tabId)
    expect(browser.listTabs('a')[0].control).toBe('user')
    browser.handBack(tabId)
    expect(browser.listTabs('a')[0].control).toBe('idle')
    expect(hosts[0].destroyed).toBe(false)
  })

  it('emits a tabs-changed event when control changes', async () => {
    const { browser } = makeBrowser()
    const controls: string[] = []
    browser.onTabsChanged((_agentId, tabs) => {
      if (tabs.length > 0) controls.push(tabs[0].control)
    })
    await browser.execute('openTab', { url: 'https://a.test/' }, call('a'))
    await browser.execute('scroll', { direction: 'down' }, call('a'))
    expect(controls).toContain('agent')
  })
})

describe('EmbeddedBrowser handoff', () => {
  it('returns no target tab when the session has none', async () => {
    const { browser } = makeBrowser()
    expect(errorOf(await browser.execute('handoff', { reason: 'Sign in' }, call('a')))).toBe('no target tab')
  })

  it('activates the tab and fires the handoff listeners on entering the hold', async () => {
    const { browser } = makeBrowser()
    const created = await browser.execute('openTab', { url: 'http://127.0.0.1:3000/' }, call('a'))
    const tabId = (created as { data: { tabId: number } }).data.tabId
    const handoffs: Array<{ agentId: string; tabId: number; reason: string }> = []
    const actives: Array<number | null> = []
    browser.onHandoffRequest((agentId, id, reason) => handoffs.push({ agentId, tabId: id, reason }))
    browser.onTabsChanged((_agentId, _tabs, activeTabId) => actives.push(activeTabId))

    const pending = browser.execute('handoff', { reason: 'Sign in' }, call('a'))
    await tick()
    expect(handoffs).toEqual([{ agentId: 'a', tabId, reason: 'Sign in' }])
    expect(actives[actives.length - 1]).toBe(tabId)
    expect(browser.listTabs('a')[0].control).toBe('user')

    browser.handBack(tabId)
    expect(await pending).toEqual({ ok: true, data: { originChanged: false } })
  })
})

describe('EmbeddedBrowser logs', () => {
  it('reads the working tab buffers and accepts an explicit tab id', async () => {
    const { browser, hosts } = makeBrowser()
    const first = await browser.execute('openTab', { url: 'https://a.test/1' }, call('a'))
    const firstId = (first as { data: { tabId: number } }).data.tabId
    await browser.execute('openTab', { url: 'https://a.test/2' }, call('a'))

    hosts[0].cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'from first' }] })
    hosts[1].cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'from second' }] })

    expect(browser.getConsoleLogs(call('a'))).toEqual([{ level: 'log', text: 'from second' }])
    expect(browser.getConsoleLogs(call('a'), undefined, firstId)).toEqual([{ level: 'log', text: 'from first' }])
    expect(browser.getNetworkLogs(call('a'))).toEqual([])
    expect(browser.getConsoleLogs(call('nobody'))).toEqual([])
  })
})

describe('EmbeddedBrowser panel', () => {
  async function twoTabs(options: {
    getZoomFactor?: () => number
    clearData?: () => Promise<void>
    onError?: (message: string) => void
  } = {}): Promise<{
    browser: EmbeddedBrowser
    hosts: FakeHost[]
    requests: string[]
    callbacks: HostCallbacks[]
  }> {
    const { browser, hosts, callbacks } = makeBrowser(options)
    const requests: string[] = []
    browser.onPanelRequest(agentId => requests.push(agentId))
    await browser.execute('openTab', { url: 'http://127.0.0.1:3000/1' }, call('a'))
    await browser.execute('openTab', { url: 'http://127.0.0.1:3000/2' }, call('a'))
    requests.length = 0
    return { browser, hosts, requests, callbacks }
  }

  it('attaches the working tab with zoomed bounds, updates bounds and detaches', async () => {
    const { browser, hosts } = await twoTabs({ getZoomFactor: () => 2 })
    await browser.attach('a', { x: 10, y: 20, width: 300, height: 200 })
    expect(hosts[1].onScreen).toBe(true)
    expect(hosts[1].bounds).toEqual({ x: 20, y: 40, width: 600, height: 400 })
    expect(hosts[0].onScreen).toBe(false)

    await browser.setBounds({ x: 0, y: 0, width: 100, height: 50 })
    expect(hosts[1].bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 })

    await browser.detach()
    expect(hosts[1].onScreen).toBe(false)
    expect(hosts[1].visible).toBe(true)
  })

  it('activateTab swaps the on-screen tab without changing the working tab', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    await browser.activateTab('a', hosts[0].id)
    expect(hosts[0].onScreen).toBe(true)
    expect(hosts[1].onScreen).toBe(false)

    // The agent's untargeted command still drives the working tab (the second one).
    expect((await browser.execute('navigate', { url: 'http://127.0.0.1:3000/3' }, call('a'))).ok).toBe(true)
    expect(hosts[1].loaded).toContain('http://127.0.0.1:3000/3')
    expect(hosts[0].loaded).not.toContain('http://127.0.0.1:3000/3')
  })

  it('a user-created tab becomes the panel tab without a panel request', async () => {
    const { browser, hosts, requests } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const created = await browser.createUserTab('a', 'http://127.0.0.1:3000/user')
    const host = hosts[hosts.length - 1]
    expect(host.onScreen).toBe(true)
    expect(host.loaded).toContain('http://127.0.0.1:3000/user')
    expect(created.control).toBe('idle')
    expect(requests).toEqual([])
  })

  it('an agent-created tab does not yank the panel off the user tab', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    await browser.activateTab('a', hosts[0].id)
    expect((await browser.execute('openTab', { url: 'http://127.0.0.1:3000/agent' }, call('a'))).ok).toBe(true)
    expect(hosts[0].onScreen).toBe(true)
    expect(hosts[2].onScreen).toBe(false)
  })

  it('a popup activates only from a visible, user-owned opener', async () => {
    const { browser, hosts, callbacks } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const userTab = await browser.createUserTab('a', 'http://127.0.0.1:3000/user')
    expect(userTab.control).toBe('idle')
    const userIndex = hosts.findIndex(h => h.id === userTab.id)
    // The opener is on screen and idle: an ordinary target=_blank click.
    callbacks[userIndex].onWindowOpen('http://127.0.0.1:3000/popup')
    await tick()
    const popupHost = hosts[hosts.length - 1]
    expect(popupHost.onScreen).toBe(true)

    // An agent-owned opener never hands the panel to a popup.
    await browser.activateTab('a', hosts[0].id)
    callbacks[0].onWindowOpen('http://127.0.0.1:3000/popup2')
    await tick()
    expect(hosts[hosts.length - 1].onScreen).toBe(false)

    // An off-screen opener does not either.
    await browser.activateTab('a', hosts[0].id)
    callbacks[userIndex].onWindowOpen('http://127.0.0.1:3000/popup3')
    await tick()
    expect(hosts[hosts.length - 1].onScreen).toBe(false)
  })

  it('a popup never sets the working tab and never fires a panel request', async () => {
    const { browser, hosts, callbacks, requests } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const userTab = await browser.createUserTab('a', 'http://127.0.0.1:3000/user')
    const userIndex = hosts.findIndex(h => h.id === userTab.id)
    requests.length = 0
    callbacks[userIndex].onWindowOpen('http://127.0.0.1:3000/popup')
    expect(requests).toEqual([])
    // The working tab is still the agent's second tab.
    expect((await browser.execute('navigate', { url: 'http://127.0.0.1:3000/next' }, call('a'))).ok).toBe(true)
    expect(hosts[1].loaded).toContain('http://127.0.0.1:3000/next')
  })

  it('a popup in an approval opener does not activate', async () => {
    const { browser, hosts, callbacks } = await twoTabs()
    // A non-loopback origin makes the click ask for site approval.
    expect((await browser.execute('navigate', { url: 'https://example.com/' }, call('a'))).ok).toBe(true)
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    void browser.execute('click', { selector: '#x' }, {
      ownerId: 'a', ask: () => new Promise<string | null>(() => {})
    })
    await tick()
    expect(browser.listTabs('a').find(t => t.id === hosts[1].id)?.control).toBe('approval')
    callbacks[1].onWindowOpen('http://127.0.0.1:3000/popup')
    await tick()
    expect(hosts[hosts.length - 1].onScreen).toBe(false)
  })

  it('setBounds only updates the view, never re-applies the on-screen state', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const before = hosts[1].setOnScreenCalls
    await browser.setBounds({ x: 5, y: 6, width: 70, height: 80 })
    expect(hosts[1].setOnScreenCalls).toBe(before)
    expect(hosts[1].bounds).toEqual({ x: 5, y: 6, width: 70, height: 80 })
  })

  it('a placement rejection is reported, not left unhandled', async () => {
    const errors: string[] = []
    const { browser, hosts } = makeBrowser({ onError: message => errors.push(message) })
    browser.onPanelRequest(() => {})
    await browser.execute('openTab', { url: 'http://127.0.0.1:3000/1' }, call('a'))
    hosts[0].setOnScreenImpl = async () => { throw new Error('boom') }
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    expect(errors.some(message => message.includes('placement failed'))).toBe(true)
  })

  it('a user tab is placed before its URL loads and is placed once', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const before = hosts.length
    const created = await browser.createUserTab('a', 'http://127.0.0.1:3000/user')
    const host = hosts[before]
    expect(created.id).toBe(host.id)
    expect(host.onScreen).toBe(true)
    expect(host.onScreenAtLoad).toBe(true)
    expect(host.setOnScreenCalls).toBe(1)
  })

  it('enforces the tab cap for user tabs with the cap message', async () => {
    const { browser } = await twoTabs()
    for (let i = 2; i < 8; i++) await browser.createUserTab('a')
    await expect(browser.createUserTab('a')).rejects.toThrow('per session')
  })

  it('guards user navigation and history while the agent works', async () => {
    const { browser, hosts } = await twoTabs()
    const tabId = hosts[0].id
    await expect(browser.navigateFromUser(tabId, 'ftp://x')).rejects.toThrow('invalid url')
    await expect(browser.navigateFromUser(tabId, 'not a url')).rejects.toThrow('invalid url')

    // The agent's lease makes the tab its own.
    expect((await browser.execute('scroll', { direction: 'down', tabId }, call('a'))).ok).toBe(true)
    await expect(browser.navigateFromUser(tabId, 'http://127.0.0.1:3000/next')).rejects.toThrow(
      'Meow is using this tab: take over first'
    )
    expect(() => browser.historyFromUser(tabId, 'reload')).toThrow('Meow is using this tab: take over first')

    browser.takeOver(tabId)
    await browser.navigateFromUser(tabId, 'http://127.0.0.1:3000/next')
    expect(hosts[0].loaded).toContain('http://127.0.0.1:3000/next')
    expect(() => browser.historyFromUser(tabId, 'bogus' as never)).toThrow('invalid history action')
  })

  it('the drawer log path includes entries the agent path hides', async () => {
    const { browser, hosts } = await twoTabs()
    const tabId = hosts[0].id
    browser.takeOver(tabId)
    hosts[0].cdp.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'during hold' }] })
    expect(browser.logsFromUser(tabId, 'console')).toEqual([{ level: 'log', text: 'during hold' }])
    expect(browser.getConsoleLogs(call('a'))).toEqual([])
    expect(browser.logsFromUser(999_999, 'console')).toEqual([])
  })

  it('freeze/hide/unfreeze honors the generation guard', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const frozen = await browser.freeze()
    expect(frozen?.image).toBe('data:image/png;base64,')
    browser.hideFrozen(frozen!.generation)
    expect(hosts[1].visible).toBe(false)

    browser.unfreeze()
    expect(hosts[1].visible).toBe(true)
    // A stale hide is ignored.
    browser.hideFrozen(frozen!.generation)
    expect(hosts[1].visible).toBe(true)
  })

  it('an unfreeze during a pending capture wins', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    let resolveCapture!: (value: string) => void
    hosts[1].captureImpl = () => new Promise<string>(resolve => { resolveCapture = resolve })
    const pending = browser.freeze()
    browser.unfreeze()
    resolveCapture('data:image/png;base64,AA')
    const frozen = await pending
    expect(frozen?.image).toBe('data:image/png;base64,AA')
    browser.hideFrozen(frozen!.generation)
    expect(hosts[1].visible).toBe(true)
  })

  it('a failed capture still returns a generation', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    hosts[1].captureImpl = async () => { throw new Error('capture failed') }
    const frozen = await browser.freeze()
    expect(frozen?.image).toBeNull()
    expect(typeof frozen?.generation).toBe('number')
  })

  it('setBounds during a freeze is applied without showing the view', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const frozen = await browser.freeze()
    browser.hideFrozen(frozen!.generation)
    await browser.setBounds({ x: 5, y: 6, width: 70, height: 80 })
    expect(hosts[1].bounds).toEqual({ x: 5, y: 6, width: 70, height: 80 })
    expect(hosts[1].visible).toBe(false)
  })

  it('keeps the panel hidden across tab switches, user tabs, handoff and active-tab close', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const frozen = await browser.freeze()
    browser.hideFrozen(frozen!.generation)
    expect(hosts[1].visible).toBe(false)

    await browser.activateTab('a', hosts[0].id)
    expect(hosts[0].onScreen).toBe(true)
    expect(hosts[0].visible).toBe(false)

    const userTab = await browser.createUserTab('a')
    expect(hosts[2].onScreen).toBe(true)
    expect(hosts[2].visible).toBe(false)

    browser.onHandoff('a', hosts[0].id, 'sign in')
    await tick()
    expect(hosts[0].onScreen).toBe(true)
    expect(hosts[0].visible).toBe(false)

    browser.closeTabFromUser(hosts[0].id)
    await tick()
    const current = hosts.find(h => h.onScreen && !h.destroyed)
    expect(current).toBeTruthy()
    expect(current!.visible).toBe(false)
    expect(userTab.id).toBe(hosts[2].id)

    browser.unfreeze()
    expect(hosts.find(h => h.onScreen && !h.destroyed)?.visible).toBe(true)

    browser.hide()
    browser.unfreeze()
    expect(hosts.find(h => h.onScreen && !h.destroyed)?.visible).toBe(true)
  })

  it('a tab hidden on screen earlier is visible when it comes back after an unfreeze', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const frozen = await browser.freeze()
    browser.hideFrozen(frozen!.generation)
    expect(hosts[1].visible).toBe(false)
    await browser.activateTab('a', hosts[0].id)
    browser.unfreeze()
    expect(hosts[0].visible).toBe(true)

    await browser.activateTab('a', hosts[1].id)
    expect(hosts[1].onScreen).toBe(true)
    expect(hosts[1].visible).toBe(true)
  })

  it('detach and attach reset the hidden state', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    const frozen = await browser.freeze()
    browser.hideFrozen(frozen!.generation)
    await browser.detach()
    expect(hosts.find(h => h.onScreen)).toBeUndefined()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 })
    expect(hosts[1].onScreen).toBe(true)
    expect(hosts[1].visible).toBe(true)
  })

  it('attach with startHidden places the tab without a visible frame', async () => {
    const { browser, hosts } = await twoTabs()
    await browser.attach('a', { x: 0, y: 0, width: 100, height: 100 }, true)
    expect(hosts[1].onScreen).toBe(true)
    expect(hosts[1].visible).toBe(false)
    browser.unfreeze()
    expect(hosts[1].visible).toBe(true)
  })

  it('clearData delegates to the partition dep', async () => {
    let cleared = 0
    const { browser } = await twoTabs({ clearData: async () => { cleared++ } })
    await browser.clearData()
    expect(cleared).toBe(1)
  })
})
