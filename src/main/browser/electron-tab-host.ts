import { WebContentsView, session, type BrowserWindow } from 'electron'
import type { BrowserTabControl } from '../../shared/browser-types'
import { waitForPageSettle } from '../../shared/browser-ax-snapshot'
import type { CdpClient, TabHost } from './browser-tab'

export const PARTITION = 'persist:meow-browser'

/**
 * 1280×800 is the page viewport for background tabs (spike S2). The view stays
 * attached but sits far outside the window so the panel can take it over later.
 */
export const DEFAULT_VIEW_BOUNDS = { x: 10_000, y: 10_000, width: 1280, height: 800 }

export interface HostCallbacks {
  /** URL, title or loading state changed. */
  onChanged(): void
  onCrashed(): void
  /** The page called window.open with an http(s) URL; the browser creates the tab. */
  onWindowOpen(url: string): void
}

export interface ElectronTabHostDeps {
  getWindow: () => BrowserWindow | null
  callbacks: HostCallbacks
}

const DEBUGGER_DOMAINS = ['Page', 'Runtime', 'Network', 'Log', 'DOM', 'Accessibility'] as const
const CAPTURE_ATTEMPTS = 4

function isAllowedNavigation(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

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
      send: <T>(method: string, params?: Record<string, unknown>) =>
        wc.debugger.sendCommand(method, params) as Promise<T>,
      onEvent: (cb: (method: string, params: unknown) => void) => {
        const listener = (_event: Electron.Event, method: string, params: unknown): void => cb(method, params)
        wc.debugger.on('message', listener)
        return () => wc.debugger.removeListener('message', listener)
      }
    }
    this.attach()
    this.wireEvents()
    liveHosts.add(this)
    void this.attachDebugger()
  }

  /** Re-add the view after the window was recreated; a no-op while it is attached. */
  attach(): void {
    if (this.destroyed) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    if (this.attachedWindow === win) return
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      try { this.attachedWindow.contentView.removeChildView(this.view) } catch { /* gone */ }
    }
    try {
      win.contentView.addChildView(this.view)
      this.view.setBounds(DEFAULT_VIEW_BOUNDS)
      this.view.setVisible(true)
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
      if (!isAllowedNavigation(wc.getURL()) || wc.getURL() === 'about:blank') {
        throw new Error(`failed to load ${url}: ${errorText(aborted)}`)
      }
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

  setShield(_state: { visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }): void {
    // The shield WebContentsView lands in Task 7.
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.view.setVisible(visible)
  }

  async setOffscreenMetrics(enabled: boolean): Promise<void> {
    const wc = this.view.webContents
    try {
      if (enabled) {
        await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: DEFAULT_VIEW_BOUNDS.width,
          height: DEFAULT_VIEW_BOUNDS.height,
          deviceScaleFactor: 1,
          mobile: false
        })
      } else {
        await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
      }
    } catch {
      // No debugger (not attached yet or detached): the next command reports it.
    }
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
    this.attachedWindow = null
    try {
      wc.close()
    } catch {
      // already closed
    }
  }

  private wireEvents(): void {
    const wc = this.view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url) && url !== 'about:blank') this.deps.callbacks.onWindowOpen(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault()
    })
    wc.on('will-frame-navigate', (event) => {
      if (!isAllowedNavigation(event.url)) event.preventDefault()
    })
    wc.on('render-process-gone', () => this.deps.callbacks.onCrashed())
    const changed = (): void => this.deps.callbacks.onChanged()
    wc.on('did-navigate', changed)
    wc.on('did-navigate-in-page', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
  }

  private async attachDebugger(): Promise<void> {
    const wc = this.view.webContents
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      for (const domain of DEBUGGER_DOMAINS) {
        await wc.debugger.sendCommand(`${domain}.enable`)
      }
    } catch {
      return
    }
    wc.debugger.on('detach', (_event, reason) => {
      if (this.destroyed || reason === 'target closed') return
      // An unexpected detach is retried once; after that every command reports it.
      if (this.reattached) return
      this.reattached = true
      void this.attachDebugger()
    })
    await this.setOffscreenMetrics(true)
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
