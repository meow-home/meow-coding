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
    this.loaded.push(url)
  }

  history(): void {}

  navState(): { loading: boolean; canGoBack: boolean; canGoForward: boolean } {
    return { loading: false, canGoBack: false, canGoForward: false }
  }

  setShield(): void {}

  setBounds(): void {}

  setVisible(): void {}

  async setOffscreenMetrics(): Promise<void> {}

  async capture(): Promise<string> {
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

function makeBrowser(options: { hasWindow?: () => boolean } = {}): {
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
    await browser.execute('openTab', { url: 'https://a.test/' }, call('a'))
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
