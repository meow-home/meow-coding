import type {
  BrowserCommandName, BrowserCommandResult, BrowserTabControl, BrowserTabInfo
} from '../../shared/browser-types'
import type { ToolRunResult } from '../agent/tools/types'
import type { BrowserBackend, BrowserCall } from './browser-backend'
import { BrowserTab, type TabHost } from './browser-tab'
import { NAVIGATE_TIMEOUT_MS } from './cdp-commands'
import { SiteApprovals } from './site-approval'

export const MAX_TABS_PER_SESSION = 8
export const MAX_TABS_TOTAL = 8

export interface HostCallbacks {
  onChanged(): void
  onCrashed(): void
  onWindowOpen(url: string): void
}

export interface EmbeddedBrowserDeps {
  createHost(ownerId: string, callbacks: HostCallbacks): TabHost
  /** `userData/browser-snapshots`. */
  snapshotDir: string
  /** False while the app has no window; commands then fail instead of creating views. */
  hasWindow?: () => boolean
  /** Read per call from meow.json, so a settings change applies without a restart. */
  siteApproval?: () => 'ask' | 'off'
}

interface TabEntry {
  tab: BrowserTab
  host: TabHost
  ownerId: string
  agentCreated: boolean
}

export type TabsListener = (agentId: string, tabs: BrowserTabInfo[], activeTabId: number | null) => void
export type PanelRequestListener = (agentId: string) => void

function isError(value: TabEntry | BrowserCommandResult): value is BrowserCommandResult {
  return 'ok' in value
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * The built-in backend: per-session tabs, each a `BrowserTab` over an Electron
 * host. All agent commands run through `BrowserTab.run` so later tasks can gate
 * input at that single point; only tab creation and `listTabs` stay here.
 */
export class EmbeddedBrowser implements BrowserBackend {
  private readonly tabs = new Map<number, TabEntry>()
  private readonly working = new Map<string, number>()
  private readonly panelActive = new Map<string, number>()
  private readonly tabsListeners = new Set<TabsListener>()
  private readonly panelListeners = new Set<PanelRequestListener>()
  private readonly siteApprovals = new SiteApprovals()

  constructor(private readonly deps: EmbeddedBrowserDeps) {}

  start(_call: BrowserCall): Promise<ToolRunResult> {
    return Promise.resolve({ output: 'browser ready (built-in)' })
  }

  async execute(
    name: BrowserCommandName,
    params: Record<string, unknown>,
    call: BrowserCall,
    timeoutMs?: number
  ): Promise<BrowserCommandResult> {
    if (this.deps.hasWindow && !this.deps.hasWindow()) {
      return { ok: false, error: 'browser unavailable: no app window' }
    }
    switch (name) {
      case 'navigate':
        return this.navigate(call, params, timeoutMs)
      case 'openTab':
        return this.openTab(call, params)
      case 'switchTab':
        return this.switchTab(call, params)
      case 'closeTab':
        return this.closeTab(call, params)
      case 'listTabs':
        return { ok: true, data: this.listTabs(call.ownerId) }
      case 'getConsoleLogs':
      case 'getNetworkLogs':
        return { ok: false, error: `unsupported command: ${name}` }
      default: {
        const entry = this.entryFor(call.ownerId, params.tabId)
        if (!entry) return { ok: false, error: params.tabId != null ? `no such tab: ${params.tabId}` : 'no target tab' }
        return entry.tab.run(name, params, call, timeoutMs)
      }
    }
  }

  getConsoleLogs(call: BrowserCall, limit?: number, tabId?: number): unknown[] {
    const entry = this.entryFor(call.ownerId, tabId)
    return entry ? entry.tab.consoleLogs(limit) : []
  }

  getNetworkLogs(call: BrowserCall, limit?: number, tabId?: number): unknown[] {
    const entry = this.entryFor(call.ownerId, tabId)
    return entry ? entry.tab.networkLogs(limit) : []
  }

  /** Control state of a tab by page webContents id (partition hardening reads this). */
  controlOf(webContentsId: number): BrowserTabControl | null {
    return this.tabs.get(webContentsId)?.tab.toInfo().control ?? null
  }

  listTabs(ownerId: string): BrowserTabInfo[] {
    const out: BrowserTabInfo[] = []
    for (const entry of this.tabs.values()) {
      if (entry.ownerId === ownerId) out.push(entry.tab.toInfo())
    }
    return out
  }

  /** The agent's turn ended: drop the lease on its tabs, never a user hold. */
  releaseOwner(agentId: string): void {
    for (const entry of this.tabs.values()) {
      if (entry.ownerId === agentId) entry.tab.releaseLease()
    }
  }

  /** The user takes control of a tab (IPC in a later task). */
  takeOver(tabId: number): void {
    this.tabs.get(tabId)?.tab.takeOver()
  }

  handBack(tabId: number): void {
    this.tabs.get(tabId)?.tab.handBack()
  }

  removeSession(agentId: string): void {
    for (const entry of [...this.tabs.values()]) {
      if (entry.ownerId !== agentId) continue
      this.tabs.delete(entry.tab.id)
      entry.tab.destroy()
    }
    this.working.delete(agentId)
    this.panelActive.delete(agentId)
    this.siteApprovals.clearOwner(agentId)
    this.emitTabsChanged(agentId)
  }

  closeAll(): void {
    for (const entry of [...this.tabs.values()]) {
      this.tabs.delete(entry.tab.id)
      entry.tab.destroy()
    }
    this.working.clear()
    this.panelActive.clear()
  }

  onTabsChanged(cb: TabsListener): () => void {
    this.tabsListeners.add(cb)
    return () => this.tabsListeners.delete(cb)
  }

  onPanelRequest(cb: PanelRequestListener): () => void {
    this.panelListeners.add(cb)
    return () => this.panelListeners.delete(cb)
  }

  private async navigate(
    call: BrowserCall,
    params: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<BrowserCommandResult> {
    const url = String(params.url ?? '')
    if (!isHttpUrl(url)) return { ok: false, error: `invalid url: ${url}` }
    let entry = this.entryFor(call.ownerId, params.tabId)
    if (!entry) {
      if (params.tabId != null) return { ok: false, error: `no such tab: ${params.tabId}` }
      const created = this.createTab(call.ownerId, true)
      if (isError(created)) return created
      entry = created
    }
    this.setWorking(call.ownerId, entry.tab.id)
    return entry.tab.run('navigate', { url }, call, timeoutMs ?? NAVIGATE_TIMEOUT_MS)
  }

  private async openTab(call: BrowserCall, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    const url = String(params.url ?? '')
    if (!isHttpUrl(url)) return { ok: false, error: `invalid url: ${url}` }
    const created = this.createTab(call.ownerId, true)
    if (isError(created)) return created
    const result = await created.tab.run('navigate', { url }, call, NAVIGATE_TIMEOUT_MS)
    if (!result.ok) return result
    return { ok: true, data: { tabId: created.tab.id } }
  }

  private switchTab(call: BrowserCall, params: Record<string, unknown>): BrowserCommandResult {
    const entry = this.entryFor(call.ownerId, params.tabId)
    if (!entry) return { ok: false, error: `no such tab: ${params.tabId}` }
    // Only the working tab changes; the tab the user selected in the panel stays.
    this.setWorking(call.ownerId, entry.tab.id)
    this.emitTabsChanged(call.ownerId)
    return { ok: true }
  }

  private async closeTab(call: BrowserCall, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    const entry = this.entryFor(call.ownerId, params.tabId)
    if (!entry) return { ok: false, error: `no such tab: ${params.tabId}` }
    const result = await entry.tab.run('closeTab', {}, call)
    if (result.ok) this.destroyTab(entry.tab.id)
    return result
  }

  private createTab(ownerId: string, agentCreated: boolean): TabEntry | BrowserCommandResult {
    if (this.countOwned(ownerId) >= MAX_TABS_PER_SESSION) {
      return { ok: false, error: `tab limit reached: ${MAX_TABS_PER_SESSION} per session` }
    }
    if (this.tabs.size >= MAX_TABS_TOTAL) {
      return { ok: false, error: `tab limit reached: ${MAX_TABS_TOTAL} total` }
    }
    let tab: BrowserTab | null = null
    const callbacks: HostCallbacks = {
      onChanged: () => this.emitTabsChanged(ownerId),
      onCrashed: () => {
        tab?.markCrashed()
        this.emitTabsChanged(ownerId)
      },
      onWindowOpen: (url) => {
        const created = this.createTab(ownerId, false)
        if (isError(created)) return
        void created.tab.run('navigate', { url })
      }
    }
    const host = this.deps.createHost(ownerId, callbacks)
    tab = new BrowserTab(host, {
      agentId: ownerId,
      snapshotDir: this.deps.snapshotDir,
      onControlChanged: () => this.emitTabsChanged(ownerId),
      siteApprovals: this.siteApprovals,
      siteApproval: this.deps.siteApproval
    })
    const entry: TabEntry = { tab, host, ownerId, agentCreated }
    this.tabs.set(tab.id, entry)
    // Only an agent-created tab becomes the working tab: a page calling
    // window.open must not redirect the agent's next untargeted command.
    if (agentCreated) this.setWorking(ownerId, tab.id)
    this.emitTabsChanged(ownerId)
    if (agentCreated) this.emitPanelRequest(ownerId)
    return entry
  }

  private destroyTab(id: number): void {
    const entry = this.tabs.get(id)
    if (!entry) return
    this.tabs.delete(id)
    if (this.working.get(entry.ownerId) === id) {
      const next = [...this.tabs.values()].filter(e => e.ownerId === entry.ownerId).pop()
      if (next) this.working.set(entry.ownerId, next.tab.id)
      else this.working.delete(entry.ownerId)
    }
    if (this.panelActive.get(entry.ownerId) === id) this.panelActive.delete(entry.ownerId)
    entry.tab.destroy()
    this.emitTabsChanged(entry.ownerId)
  }

  private entryFor(ownerId: string, tabId: unknown): TabEntry | null {
    if (tabId != null) {
      const entry = this.tabs.get(Number(tabId))
      // A tab id from another session is indistinguishable from an unknown one.
      return entry && entry.ownerId === ownerId ? entry : null
    }
    const working = this.working.get(ownerId)
    if (working != null) {
      const entry = this.tabs.get(working)
      if (entry && entry.ownerId === ownerId) return entry
    }
    const active = this.panelActive.get(ownerId)
    if (active != null) {
      const entry = this.tabs.get(active)
      if (entry && entry.ownerId === ownerId) return entry
    }
    for (const entry of this.tabs.values()) {
      if (entry.ownerId === ownerId) return entry
    }
    return null
  }

  private countOwned(ownerId: string): number {
    let count = 0
    for (const entry of this.tabs.values()) if (entry.ownerId === ownerId) count++
    return count
  }

  private setWorking(ownerId: string, tabId: number): void {
    this.working.set(ownerId, tabId)
  }

  private emitTabsChanged(ownerId: string): void {
    const tabs = this.listTabs(ownerId)
    const active = this.panelActive.get(ownerId) ?? this.working.get(ownerId) ?? null
    for (const cb of this.tabsListeners) cb(ownerId, tabs, active)
  }

  private emitPanelRequest(ownerId: string): void {
    for (const cb of this.panelListeners) cb(ownerId)
  }
}
