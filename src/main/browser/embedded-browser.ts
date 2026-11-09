import type {
  BrowserCommandName, BrowserCommandResult, BrowserTabControl, BrowserTabInfo
} from '../../shared/browser-types'
import type { ToolRunResult } from '../agent/tools/types'
import type { BrowserBackend, BrowserCall } from './browser-backend'
import { BrowserTab, type TabHost } from './browser-tab'
import { NAVIGATE_TIMEOUT_MS } from './cdp-commands'
import { SiteApprovals } from './site-approval'
import { isAllowedNavigation } from './navigation-policy'

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
  /** The window's zoom factor; panel bounds arrive in CSS px. */
  getZoomFactor?: () => number
  /** Clears the browser partition (cookies, storage and cache). */
  clearData?: () => Promise<void>
  /** Placement failures must not become unhandled rejections. */
  onError?: (message: string) => void
}

type TabOrigin = 'agent' | 'user' | 'popup'

interface TabEntry {
  tab: BrowserTab
  host: TabHost
  ownerId: string
  origin: TabOrigin
  onScreen: boolean
  /** Panel placement while it is the active tab; always settles. */
  placement?: Promise<void>
}

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export type TabsListener = (agentId: string, tabs: BrowserTabInfo[], activeTabId: number | null) => void
export type PanelRequestListener = (agentId: string) => void
export type HandoffListener = (agentId: string, tabId: number, reason: string) => void

function isError(value: TabEntry | BrowserCommandResult): value is Extract<BrowserCommandResult, { ok: false }> {
  return 'ok' in value && !value.ok
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
  private readonly handoffListeners = new Set<HandoffListener>()
  private panelOwner: string | null = null
  private panelBounds: PanelBounds | null = null
  private panelGeneration = 0
  private panelHidden = false

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
    if (this.panelOwner === agentId) {
      this.panelOwner = null
      this.panelBounds = null
      this.panelGeneration++
      this.panelHidden = false
    }
    this.emitTabsChanged(agentId)
  }

  closeAll(): void {
    for (const entry of [...this.tabs.values()]) {
      this.tabs.delete(entry.tab.id)
      entry.tab.destroy()
    }
    this.working.clear()
    this.panelActive.clear()
    this.panelOwner = null
    this.panelBounds = null
    this.panelGeneration++
    this.panelHidden = false
  }

  // ---- panel -----------------------------------------------------------------

  private scaleBounds(bounds: PanelBounds): PanelBounds {
    const zoom = this.deps.getZoomFactor?.() ?? 1
    const scale = (n: number): number => Math.round(n * zoom)
    return { x: scale(bounds.x), y: scale(bounds.y), width: scale(bounds.width), height: scale(bounds.height) }
  }

  private onScreenEntry(): TabEntry | null {
    for (const entry of this.tabs.values()) if (entry.onScreen) return entry
    return null
  }

  private onScreenEntryFor(ownerId: string): TabEntry | null {
    for (const entry of this.tabs.values()) if (entry.ownerId === ownerId && entry.onScreen) return entry
    return null
  }

  /** The panel's tab for an owner: panelActive, else the working tab, else the first. */
  private panelEntry(ownerId: string): TabEntry | null {
    const active = this.panelActive.get(ownerId)
    if (active != null) {
      const entry = this.tabs.get(active)
      if (entry && entry.ownerId === ownerId) return entry
    }
    return this.entryFor(ownerId, undefined)
  }

  /** Fire-and-forget placement that always settles. */
  private place(entry: TabEntry | null): Promise<void> {
    return this.placeOnScreen(entry).catch(err => {
      this.deps.onError?.(`browser panel placement failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  private async placeOnScreen(entry: TabEntry | null): Promise<void> {
    for (const other of this.tabs.values()) {
      if (other === entry || !other.onScreen) continue
      other.onScreen = false
      await other.tab.setOnScreen(false)
    }
    if (!entry) return
    entry.onScreen = true
    this.panelActive.set(entry.ownerId, entry.tab.id)
    await entry.tab.setOnScreen(true, this.panelBounds ?? undefined)
    if (this.panelHidden) entry.tab.setVisible(false)
  }

  async attach(agentId: string, bounds: PanelBounds): Promise<void> {
    this.panelGeneration++
    this.panelHidden = false
    this.panelOwner = agentId
    this.panelBounds = this.scaleBounds(bounds)
    await this.place(this.panelEntry(agentId))
    this.emitTabsChanged(agentId)
  }

  async detach(): Promise<void> {
    const owner = this.panelOwner
    const entry = this.onScreenEntry()
    this.panelGeneration++
    this.panelHidden = false
    this.panelOwner = null
    this.panelBounds = null
    if (entry) {
      entry.onScreen = false
      await entry.tab.setOnScreen(false)
    }
    if (owner) this.emitTabsChanged(owner)
    else if (entry) this.emitTabsChanged(entry.ownerId)
  }

  async setBounds(bounds: PanelBounds): Promise<void> {
    this.panelBounds = this.scaleBounds(bounds)
    const entry = this.onScreenEntry()
    if (!entry || !this.panelBounds) return
    // Bounds only: the metrics override changes with the on-screen state, not per frame.
    entry.tab.setBounds(this.panelBounds)
  }

  /** Capture the visible tab; the view stays visible until hideFrozen. */
  async freeze(): Promise<{ generation: number; image: string | null } | null> {
    const entry = this.onScreenEntry()
    if (!entry) return null
    const generation = this.panelGeneration
    let image: string | null = null
    try {
      image = await entry.host.capture()
    } catch {
      image = null
    }
    // An unfreeze/detach/tab switch during the capture makes this generation stale.
    return { generation, image }
  }

  hideFrozen(generation: number): void {
    if (generation !== this.panelGeneration) return
    const entry = this.onScreenEntry()
    if (!entry) return
    this.panelHidden = true
    entry.tab.setVisible(false)
  }

  unfreeze(): void {
    this.panelGeneration++
    this.panelHidden = false
    this.onScreenEntry()?.tab.setVisible(true)
  }

  async clearData(): Promise<void> {
    await this.deps.clearData?.()
  }

  // ---- user actions from the panel ------------------------------------------

  async createUserTab(agentId: string, url?: string): Promise<BrowserTabInfo> {
    const safe = url != null ? this.requireHttpUrl(url) : null
    const created = this.createTab(agentId, 'user')
    if (isError(created)) throw new Error(created.error)
    // createTab already starts the placement; load only once the view is on screen.
    await (created.placement ?? Promise.resolve())
    if (safe) await created.host.loadUrl(safe)
    this.emitTabsChanged(agentId)
    return created.tab.toInfo()
  }

  /** Show a tab in the panel; the agent's working tab is untouched. */
  async activateTab(agentId: string, tabId: number): Promise<void> {
    const entry = this.tabs.get(tabId)
    if (!entry || entry.ownerId !== agentId) return
    this.panelActive.set(agentId, tabId)
    if (this.panelOwner === agentId) {
      this.panelGeneration++
      this.panelHidden = false
      await this.place(entry)
    }
    this.emitTabsChanged(agentId)
  }

  closeTabFromUser(tabId: number): void {
    this.destroyTab(tabId)
  }

  async navigateFromUser(tabId: number, url: string): Promise<void> {
    const safe = this.requireHttpUrl(url)
    const entry = this.requireUserAction(tabId)
    await entry.host.loadUrl(safe)
    this.emitTabsChanged(entry.ownerId)
  }

  historyFromUser(tabId: number, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    if (!['back', 'forward', 'reload', 'stop'].includes(action)) {
      throw new Error(`invalid history action: ${action}`)
    }
    const entry = this.requireUserAction(tabId)
    entry.host.history(action)
    this.emitTabsChanged(entry.ownerId)
  }

  logsFromUser(tabId: number, kind: 'console' | 'network', limit?: number): unknown[] {
    const entry = this.tabs.get(tabId)
    if (!entry) return []
    return kind === 'console' ? entry.tab.allConsoleLogs(limit) : entry.tab.allNetworkLogs(limit)
  }

  private requireHttpUrl(url: string): string {
    if (!/^https?:\/\//i.test(url) || !isAllowedNavigation(url, true)) {
      throw new Error(`invalid url: ${url} (http and https only)`)
    }
    return url
  }

  private requireUserAction(tabId: number): TabEntry {
    const entry = this.tabs.get(tabId)
    if (!entry) throw new Error(`no such tab: ${tabId}`)
    const control = entry.tab.toInfo().control
    if (control === 'agent' || control === 'approval') {
      throw new Error('Meow is using this tab: take over first')
    }
    return entry
  }

  onTabsChanged(cb: TabsListener): () => void {
    this.tabsListeners.add(cb)
    return () => this.tabsListeners.delete(cb)
  }

  onPanelRequest(cb: PanelRequestListener): () => void {
    this.panelListeners.add(cb)
    return () => this.panelListeners.delete(cb)
  }

  /** The agent handed a tab to the user: make it the panel's tab and ask for it. */
  onHandoff(agentId: string, tabId: number, reason: string): void {
    this.panelActive.set(agentId, tabId)
    if (this.panelOwner === agentId) {
      this.panelGeneration++
      this.panelHidden = false
      const entry = this.tabs.get(tabId)
      if (entry) void this.place(entry)
    }
    this.emitTabsChanged(agentId)
    this.emitPanelRequest(agentId)
    for (const cb of this.handoffListeners) cb(agentId, tabId, reason)
  }

  onHandoffRequest(cb: HandoffListener): () => void {
    this.handoffListeners.add(cb)
    return () => this.handoffListeners.delete(cb)
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
      const created = this.createTab(call.ownerId, 'agent')
      if (isError(created)) return created
      entry = created
    }
    this.setWorking(call.ownerId, entry.tab.id)
    return entry.tab.run('navigate', { url }, call, timeoutMs ?? NAVIGATE_TIMEOUT_MS)
  }

  private async openTab(call: BrowserCall, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    const url = String(params.url ?? '')
    if (!isHttpUrl(url)) return { ok: false, error: `invalid url: ${url}` }
    const created = this.createTab(call.ownerId, 'agent')
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

  private createTab(
    ownerId: string,
    origin: TabOrigin,
    opener?: TabEntry
  ): TabEntry | Extract<BrowserCommandResult, { ok: false }> {
    if (this.countOwned(ownerId) >= MAX_TABS_PER_SESSION) {
      return { ok: false, error: `tab limit reached: ${MAX_TABS_PER_SESSION} per session` }
    }
    if (this.tabs.size >= MAX_TABS_TOTAL) {
      return { ok: false, error: `tab limit reached: ${MAX_TABS_TOTAL} total` }
    }
    let tab: BrowserTab | null = null
    let entry: TabEntry | null = null
    const callbacks: HostCallbacks = {
      onChanged: () => this.emitTabsChanged(ownerId),
      onCrashed: () => {
        tab?.markCrashed()
        this.emitTabsChanged(ownerId)
      },
      onWindowOpen: (url) => {
        const created = this.createTab(ownerId, 'popup', entry ?? undefined)
        if (isError(created)) return
        const load = (): void => {
          void created.host.loadUrl(url).catch(err => {
            this.deps.onError?.(`popup navigation failed: ${err instanceof Error ? err.message : String(err)}`)
          })
        }
        void (created.placement ?? Promise.resolve()).then(load)
      }
    }
    const host = this.deps.createHost(ownerId, callbacks)
    tab = new BrowserTab(host, {
      agentId: ownerId,
      snapshotDir: this.deps.snapshotDir,
      onControlChanged: () => this.emitTabsChanged(ownerId),
      siteApprovals: this.siteApprovals,
      siteApproval: this.deps.siteApproval,
      onHandoff: (reason) => this.onHandoff(ownerId, host.id, reason)
    })
    entry = { tab, host, ownerId, origin, onScreen: false }
    this.tabs.set(tab.id, entry)
    // Only an agent-created tab becomes the working tab: a page calling
    // window.open must not redirect the agent's next untargeted command.
    if (origin === 'agent') this.setWorking(ownerId, tab.id)
    if (this.panelOwner === ownerId) {
      // User tabs take the panel; agent tabs only when nothing of this owner is on
      // screen; a popup only when its opener is the visible, user-owned tab.
      const openerControl = opener?.tab.toInfo().control
      const activate = origin === 'user'
        || (origin === 'agent' && !this.onScreenEntryFor(ownerId))
        || (origin === 'popup' && !!opener?.onScreen && (openerControl === 'user' || openerControl === 'idle'))
      if (activate) {
        this.panelActive.set(ownerId, tab.id)
        entry.placement = this.place(entry)
      }
    }
    this.emitTabsChanged(ownerId)
    if (origin === 'agent') this.emitPanelRequest(ownerId)
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
    if (entry.onScreen) {
      entry.onScreen = false
      this.panelGeneration++
      this.panelHidden = false
      void this.place(this.panelEntry(entry.ownerId))
    }
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
