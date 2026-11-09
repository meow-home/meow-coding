import { WebContentsView, session, type BrowserWindow } from 'electron'
import type { BrowserTabControl } from '../../shared/browser-types'
import { waitForPageSettle } from '../../shared/browser-ax-snapshot'
import type { CdpClient, TabHost } from './browser-tab'
import type { HostCallbacks } from './embedded-browser'
import { isAllowedNavigation } from './navigation-policy'

export const PARTITION = 'persist:meow-browser'

/**
 * 1280×800 is the page viewport for background tabs (spike S2). The view stays
 * attached but sits far outside the window so the panel can take it over later.
 */
export const DEFAULT_VIEW_BOUNDS = { x: 10_000, y: 10_000, width: 1280, height: 800 }

/** Transparent overlay document: only the agent cursor, ring and label. */
const SHIELD_DOCUMENT = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  #ring { position: absolute; border: 2px solid #1f9cf0; border-radius: 4px; box-sizing: border-box; display: none; }
  #cursor { position: absolute; width: 0; height: 0; border-left: 10px solid #1f9cf0; border-top: 6px solid transparent; border-bottom: 6px solid transparent; filter: drop-shadow(0 1px 1px rgba(0,0,0,.45)); display: none; }
  #label { position: absolute; font: 11px system-ui, sans-serif; color: #fff; background: #1f9cf0; padding: 1px 5px; border-radius: 3px; white-space: nowrap; display: none; }
</style></head>
<body>
<div id="ring"></div><div id="cursor"></div><div id="label"></div>
<script>
  const ring = document.getElementById('ring')
  const cursor = document.getElementById('cursor')
  const label = document.getElementById('label')
  window.__meowShield = {
    set(target) {
      if (!target) {
        ring.style.display = 'none'
        label.style.display = 'none'
        return
      }
      ring.style.display = 'block'
      ring.style.left = target.x + 'px'
      ring.style.top = target.y + 'px'
      ring.style.width = target.w + 'px'
      ring.style.height = target.h + 'px'
      cursor.style.display = 'block'
      cursor.style.left = (target.x + target.w / 2) + 'px'
      cursor.style.top = (target.y + target.h / 2) + 'px'
      label.style.display = 'block'
      label.textContent = target.label || ''
      label.style.left = (target.x + target.w / 2 + 12) + 'px'
      label.style.top = (target.y + target.h / 2 + 12) + 'px'
    }
  }
</script>
</body></html>`

const SHIELD_URL = `data:text/html;charset=utf-8,${encodeURIComponent(SHIELD_DOCUMENT)}`

interface ShieldTarget {
  x: number
  y: number
  w: number
  h: number
  label: string
}

export interface ElectronTabHostDeps {
  getWindow: () => BrowserWindow | null
  callbacks: HostCallbacks
}

const DEBUGGER_DOMAINS = ['Page', 'Runtime', 'Network', 'Log', 'DOM', 'Accessibility'] as const
const CAPTURE_ATTEMPTS = 4

function isAbortedNavigation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined
  return e?.code === 'ERR_ABORTED' || /ERR_ABORTED|aborted/i.test(e?.message ?? '')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Hosts re-attach themselves after the app window is recreated. */
const liveHosts = new Set<ElectronTabHost>()

export function reattachBrowserTabs(): void {
  for (const host of liveHosts) host.attach()
}

export class ElectronTabHost implements TabHost {
  readonly id: number
  readonly cdp: CdpClient
  private readonly deps: ElectronTabHostDeps
  private readonly view: WebContentsView
  private attachedWindow: BrowserWindow | null = null
  private reattached = false
  private destroyed = false
  private readonly ready: Promise<void>
  private readyError: string | null = null
  private processGone = false
  private shield: WebContentsView | null = null
  private shieldVisible = false
  private requestedVisible = true
  private shieldTarget: ShieldTarget | null = null
  private shieldLoaded = false
  private onScreen = false
  private onScreenBounds: { x: number; y: number; width: number; height: number } | null = null

  constructor(deps: ElectronTabHostDeps) {
    this.deps = deps
    this.view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: PARTITION,
        backgroundThrottling: false
      }
    })
    this.view.setBackgroundColor('#ffffff')
    const wc = this.view.webContents
    this.id = wc.id
    this.cdp = {
      // Commands wait for attach + domain enable + the metrics override, so the
      // first command never runs against a 0×0 viewport or a disabled domain.
      send: async <T>(method: string, params?: Record<string, unknown>) => {
        await this.ready
        if (this.readyError) throw new Error(this.readyError)
        return wc.debugger.sendCommand(method, params) as Promise<T>
      },
      onEvent: (cb: (method: string, params: unknown) => void) => {
        const listener = (_event: Electron.Event, method: string, params: unknown): void => cb(method, params)
        wc.debugger.on('message', listener)
        return () => wc.debugger.removeListener('message', listener)
      }
    }
    this.attach()
    this.wireEvents()
    liveHosts.add(this)
    this.ready = this.startDebugger()
  }

  /** Re-add the view after the window was recreated; a no-op while it is attached. */
  attach(): void {
    if (this.destroyed) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    if (this.attachedWindow === win) return
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      try { this.attachedWindow.contentView.removeChildView(this.view) } catch { /* gone */ }
      if (this.shield) {
        try { this.attachedWindow.contentView.removeChildView(this.shield) } catch { /* gone */ }
      }
    }
    try {
      win.contentView.addChildView(this.view)
      this.view.setBounds(this.onScreen ? (this.onScreenBounds ?? DEFAULT_VIEW_BOUNDS) : DEFAULT_VIEW_BOUNDS)
      this.view.setVisible(true)
      if (this.shield && !this.shield.webContents.isDestroyed()) {
        // Re-added after the page so it stays directly above it.
        win.contentView.addChildView(this.shield)
        this.shield.setBounds(this.view.getBounds())
        this.shield.setVisible(this.shieldVisible)
      }
      this.attachedWindow = win
    } catch {
      this.attachedWindow = null
    }
  }

  getUrl(): string {
    return this.view.webContents.getURL()
  }

  getTitle(): string {
    return this.view.webContents.getTitle()
  }

  async loadUrl(url: string): Promise<void> {
    await this.ready
    if (this.readyError) throw new Error(this.readyError)
    await this.ensureDebugger()
    const wc = this.view.webContents
    let aborted: unknown = null
    try {
      await wc.loadURL(url)
    } catch (err) {
      // A redirect (or another navigation) aborts the original load with
      // ERR_ABORTED even though the page ends up loaded.
      if (!isAbortedNavigation(err)) throw new Error(`failed to load ${url}: ${errorText(err)}`)
      aborted = err
    }
    if (aborted) {
      await this.waitForLoadStop()
      if (!isAllowedNavigation(wc.getURL(), true) || wc.getURL() === 'about:blank') {
        throw new Error(`failed to load ${url}: ${errorText(aborted)}`)
      }
    }
    if (this.processGone) {
      // The renderer is new: re-enable the domains and the metrics override.
      this.processGone = false
      await this.enableDebugger()
    }
    await waitForPageSettle((method, params) => wc.debugger.sendCommand(method, params))
  }

  history(action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const wc = this.view.webContents
    if (action === 'back') wc.navigationHistory.goBack()
    else if (action === 'forward') wc.navigationHistory.goForward()
    else if (action === 'reload') wc.reload()
    else wc.stop()
  }

  navState(): { loading: boolean; canGoBack: boolean; canGoForward: boolean } {
    const wc = this.view.webContents
    return {
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }
  }

  setShield(state: { visible: boolean; target?: ShieldTarget }): void {
    // The logical state is per tab; the physical view only exists on screen.
    this.shieldVisible = state.visible
    this.shieldTarget = state.target ?? null
    if (!state.visible) {
      this.shield?.setVisible(false)
      this.applyShieldState()
      return
    }
    if (!this.onScreen) return
    const shield = this.ensureShield()
    if (!shield) return
    shield.setBounds(this.view.getBounds())
    shield.setVisible(true)
    this.applyShieldState()
  }

  /**
   * The tab is the panel's visible tab (or not). On screen: the panel bounds and a
   * real viewport, plus the shield view if the agent's shield is up. Off screen: the
   * background placement, the 1280×800 override, and no shield view.
   */
  async setOnScreen(onScreen: boolean, bounds?: { x: number; y: number; width: number; height: number }): Promise<void> {
    await this.ready
    if (this.readyError) throw new Error(this.readyError)
    this.onScreen = onScreen
    if (onScreen && bounds) this.onScreenBounds = bounds
    if (!this.attachedWindow) this.attach()
    if (onScreen) {
      this.view.setBounds(bounds ?? this.onScreenBounds ?? DEFAULT_VIEW_BOUNDS)
      this.view.setVisible(this.requestedVisible)
      await this.clearOffscreenMetrics()
      if (this.requestedVisible && this.shieldVisible) {
        const shield = this.ensureShield()
        if (shield) {
          shield.setBounds(this.view.getBounds())
          shield.setVisible(true)
        }
      }
    } else {
      this.view.setBounds(DEFAULT_VIEW_BOUNDS)
      this.view.setVisible(true)
      this.destroyShieldView()
      await this.applyOffscreenMetrics()
    }
    this.applyShieldState()
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view.setBounds(bounds)
    this.shield?.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.requestedVisible = visible
    this.view.setVisible(visible)
    // Restoring the host restores the shield only while it should be up on screen.
    this.shield?.setVisible(visible && this.shieldVisible && this.onScreen)
  }

  async capture(): Promise<string> {
    const wc = this.view.webContents
    let lastError: unknown = null
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
      try {
        const image = await wc.capturePage()
        if (!image.isEmpty()) return image.toDataURL()
        lastError = new Error('empty capture')
      } catch (err) {
        // capturePage can fail transiently with UnknownVizError.
        lastError = err
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw lastError instanceof Error ? lastError : new Error('capture failed')
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    liveHosts.delete(this)
    const wc = this.view.webContents
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // already detached
    }
    try {
      this.attachedWindow?.contentView.removeChildView(this.view)
    } catch {
      // window or view already gone
    }
    const shield = this.shield
    this.shield = null
    if (shield) {
      try {
        this.attachedWindow?.contentView.removeChildView(shield)
      } catch {
        // window or shield already gone
      }
    }
    this.attachedWindow = null
    try {
      wc.close()
    } catch {
      // already closed
    }
    if (shield) {
      try {
        shield.webContents.close()
      } catch {
        // already closed
      }
    }
  }

  private wireEvents(): void {
    const wc = this.view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url, true) && url !== 'about:blank') this.deps.callbacks.onWindowOpen(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, true)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (!isAllowedNavigation(url, true)) event.preventDefault()
    })
    wc.on('will-frame-navigate', (event) => {
      if (!isAllowedNavigation(event.url, event.isMainFrame)) event.preventDefault()
    })
    // Registered once: a reattach must not add a second listener.
    wc.debugger.on('detach', (_event, reason) => {
      if (this.destroyed || reason === 'target closed' || this.processGone) return
      if (this.reattached) return
      this.reattached = true
      void this.enableDebugger().catch(err => {
        this.readyError = `browser debugger unavailable: ${errorText(err)}`
      })
    })
    wc.on('render-process-gone', () => {
      this.processGone = true
      this.deps.callbacks.onCrashed()
    })
    wc.on('before-input-event', (event) => {
      // The shield is a transparent overlay, not a focus target: while it is up the
      // page must not see keys even when it still has focus. Later shortcuts hook in here.
      if (this.shieldVisible) event.preventDefault()
    })
    const changed = (): void => this.deps.callbacks.onChanged()
    wc.on('did-navigate', changed)
    wc.on('did-navigate-in-page', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
  }

  private destroyShieldView(): void {
    const shield = this.shield
    if (!shield) return
    this.shield = null
    this.shieldLoaded = false
    try {
      this.attachedWindow?.contentView.removeChildView(shield)
    } catch {
      // window or shield already gone
    }
    try {
      shield.webContents.close()
    } catch {
      // already closed
    }
  }

  private async applyOffscreenMetrics(): Promise<void> {
    const wc = this.view.webContents
    try {
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: DEFAULT_VIEW_BOUNDS.width,
        height: DEFAULT_VIEW_BOUNDS.height,
        deviceScaleFactor: 1,
        mobile: false
      })
    } catch {
      // No debugger (not attached yet or detached): the next command reports it.
    }
  }

  private async clearOffscreenMetrics(): Promise<void> {
    const wc = this.view.webContents
    try {
      await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    } catch {
      // No debugger: the next command reports it.
    }
  }

  private ensureShield(): WebContentsView | null {
    if (this.destroyed || !this.onScreen) return null
    if (this.shield && !this.shield.webContents.isDestroyed()) return this.shield
    const shield = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: PARTITION,
        backgroundThrottling: false
      }
    })
    shield.setBackgroundColor('#00000000')
    const wc = shield.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', event => event.preventDefault())
    wc.on('did-finish-load', () => {
      this.shieldLoaded = true
      this.applyShieldState()
    })
    shield.setVisible(false)
    shield.setBounds(this.view.getBounds())
    this.shield = shield
    this.shieldLoaded = false
    if (this.attachedWindow) this.attachedWindow.contentView.addChildView(shield)
    void wc.loadURL(SHIELD_URL).catch(() => {})
    return shield
  }

  private applyShieldState(): void {
    const shield = this.shield
    if (!shield || !this.shieldLoaded || shield.webContents.isDestroyed()) return
    const target = this.shieldVisible ? this.shieldTarget : null
    const script = `window.__meowShield && window.__meowShield.set(${JSON.stringify(target)})`
    void shield.webContents.executeJavaScript(script, true).catch(() => {
      // Decoration only: a shield error never reaches the page or the command.
    })
  }

  private async ensureDebugger(): Promise<void> {
    const wc = this.view.webContents
    if (wc.debugger.isAttached()) return
    try {
      await this.enableDebugger()
    } catch (err) {
      this.readyError = `browser debugger unavailable: ${errorText(err)}`
      throw new Error(this.readyError)
    }
  }

  private async startDebugger(): Promise<void> {
    try {
      const wc = this.view.webContents
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      // A fresh webContents does not answer debugger commands until its renderer
      // exists; about:blank starts it without touching the network, so the domains
      // and the metrics override are in place before the first real navigation.
      await wc.loadURL('about:blank')
      await this.enableDebugger()
    } catch (err) {
      // Ready always settles; commands then fail with this message instead of hanging.
      this.readyError = `browser debugger unavailable: ${errorText(err)}`
    }
  }

  private async enableDebugger(): Promise<void> {
    const wc = this.view.webContents
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    for (const domain of DEBUGGER_DOMAINS) {
      await wc.debugger.sendCommand(`${domain}.enable`)
    }
    if (this.onScreen) await this.clearOffscreenMetrics()
    else await this.applyOffscreenMetrics()
    this.readyError = null
  }

  private waitForLoadStop(timeoutMs = 15_000): Promise<void> {
    const wc = this.view.webContents
    if (!wc.isLoading()) return Promise.resolve()
    return new Promise(resolve => {
      const done = (): void => {
        clearTimeout(timer)
        wc.removeListener('did-stop-loading', done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      wc.once('did-stop-loading', done)
    })
  }
}

export function createElectronTabHost(deps: ElectronTabHostDeps): ElectronTabHost {
  return new ElectronTabHost(deps)
}

export interface PartitionHardeningDeps {
  controlOf?: (webContentsId: number) => BrowserTabControl | null
}

/** Deny everything except clipboard write; agent-controlled downloads are cancelled. */
export function hardenBrowserPartition(deps: PartitionHardeningDeps = {}): void {
  const ses = session.fromPartition(PARTITION)
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  ses.on('will-download', (event, _item, webContents) => {
    const control = deps.controlOf?.(webContents.id) ?? null
    if (control === 'agent' || control === 'approval') event.preventDefault()
  })
}
