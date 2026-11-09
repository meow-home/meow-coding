import type { BrowserCall } from './browser-backend'
import type {
  BrowserCommandName, BrowserCommandResult, BrowserReadMode, BrowserTabControl, BrowserTabInfo
} from '../../shared/browser-types'
import * as commands from './cdp-commands'

export interface CdpClient {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  onEvent(cb: (method: string, params: unknown) => void): () => void
}

export interface TabHost {
  readonly id: number                 // page webContents.id
  readonly cdp: CdpClient
  getUrl(): string
  getTitle(): string
  loadUrl(url: string): Promise<void>
  history(action: 'back' | 'forward' | 'reload' | 'stop'): void
  navState(): { loading: boolean; canGoBack: boolean; canGoForward: boolean }
  setShield(state: { visible: boolean; target?: { x: number; y: number; w: number; h: number; label: string } }): void
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  setVisible(visible: boolean): void
  setOffscreenMetrics(enabled: boolean): Promise<void> // Emulation.setDeviceMetricsOverride on / cleared
  capture(): Promise<string>          // data URL from view.webContents.capturePage(), retried
  destroy(): void
}

export const LOG_BUFFER_ENTRIES = 200
export const MAX_PENDING_REQUESTS = 400

export interface BrowserTabDeps {
  agentId: string
  /** Snapshot files are written here (`userData/browser-snapshots`). */
  snapshotDir: string
}

export interface ConsoleEntry {
  level: string
  text: string
}

export interface NetworkEntry {
  method: string
  url: string
  status: number | 'failed'
}

const MAX_CONSOLE_TEXT = 4000

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function tail<T>(items: T[], limit: number): T[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  return items.length > limit ? items.slice(items.length - limit) : [...items]
}

function consoleArgText(arg: unknown): string {
  const a = arg as { value?: unknown; description?: unknown; unserializableValue?: unknown; type?: unknown } | undefined
  if (!a) return ''
  if (typeof a.value === 'string') return a.value
  if (a.value !== undefined) return JSON.stringify(a.value)
  if (a.description !== undefined) return String(a.description)
  if (a.unserializableValue !== undefined) return String(a.unserializableValue)
  return typeof a.type === 'string' ? a.type : ''
}

/**
 * One browser tab's state and command surface. Electron-free: the host owns the
 * views and the debugger, this class owns refs, buffers, dialogs and the queue.
 */
export class BrowserTab {
  readonly id: number
  private readonly deps: BrowserTabDeps
  private readonly host: TabHost
  private readonly refs = new Map<string, number>()
  private readonly consoleBuffer: ConsoleEntry[] = []
  private readonly networkBuffer: NetworkEntry[] = []
  private readonly pendingRequests = new Map<string, { method: string; url: string }>()
  private readonly dialogNotes: string[] = []
  private control: BrowserTabControl = 'idle'
  private crashed = false
  private queue: Promise<unknown> = Promise.resolve()
  private unsubscribe: (() => void) | null = null

  constructor(host: TabHost, deps: BrowserTabDeps) {
    this.host = host
    this.deps = deps
    this.id = host.id
    this.unsubscribe = host.cdp.onEvent((method, params) => this.handleEvent(method, params))
  }

  /**
   * Commands run one at a time: subagents share their parent's tabs, and two
   * concurrent CDP sequences on one page would interleave.
   */
  run(name: BrowserCommandName, params: Record<string, unknown> = {}, _call?: BrowserCall): Promise<BrowserCommandResult> {
    // Later tasks add the pipeline steps here, in this order: wait for control (6),
    // acquire + shield, sensitive check (9), site approval (8), execute, decorate.
    const task = this.queue.then(() => this.dispatch(name, params))
    // A failed command must not stop the queue for the commands behind it.
    this.queue = task.then(() => undefined, () => undefined)
    return task.then(
      result => this.decorate(result),
      err => this.decorate({ ok: false, error: `${name}: ${errorMessage(err)}` })
    )
  }

  toInfo(): BrowserTabInfo {
    const nav = this.host.navState()
    return {
      id: this.id,
      agentId: this.deps.agentId,
      url: this.host.getUrl(),
      title: this.host.getTitle(),
      loading: nav.loading,
      canGoBack: nav.canGoBack,
      canGoForward: nav.canGoForward,
      crashed: this.crashed,
      control: this.control
    }
  }

  consoleLogs(limit = LOG_BUFFER_ENTRIES): ConsoleEntry[] {
    return tail(this.consoleBuffer, limit)
  }

  networkLogs(limit = LOG_BUFFER_ENTRIES): NetworkEntry[] {
    return tail(this.networkBuffer, limit)
  }

  markCrashed(): void {
    this.crashed = true
    this.refs.clear()
  }

  destroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.host.destroy()
  }

  private async dispatch(name: BrowserCommandName, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    if (this.crashed) return { ok: false, error: 'tab crashed; reload it' }
    switch (name) {
      case 'read':
        return commands.read(this.host.cdp, this.refs, {
          mode: params.mode as BrowserReadMode | undefined,
          snapshotDir: this.deps.snapshotDir
        })
      case 'click':
        return commands.click(this.host.cdp, this.refs, params)
      case 'type':
        return commands.type(this.host.cdp, this.refs, params)
      case 'select':
        return commands.select(this.host.cdp, this.refs, params)
      case 'scroll':
        return commands.scroll(this.host.cdp, this.refs, params)
      case 'waitFor':
        return commands.waitFor(this.host.cdp, this.refs, params)
      default:
        return { ok: false, error: `unsupported command: ${name}` }
    }
  }

  private decorate(result: BrowserCommandResult): BrowserCommandResult {
    if (this.dialogNotes.length === 0) return result
    const note = this.dialogNotes.splice(0).join('\n')
    if (!result.ok) return { ok: false, error: `${result.error}\n${note}` }
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : result.data === undefined ? {} : { result: result.data }
    const previous = typeof data.notice === 'string' ? data.notice : ''
    return { ok: true, data: { ...data, notice: previous ? `${previous}\n${note}` : note } }
  }

  private handleEvent(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const args = Array.isArray(p.args) ? p.args : []
        this.pushConsole({
          level: String(p.type ?? 'log'),
          text: args.map(consoleArgText).join(' ').slice(0, MAX_CONSOLE_TEXT)
        })
        break
      }
      case 'Runtime.exceptionThrown': {
        const details = (p.exceptionDetails ?? {}) as Record<string, unknown>
        const exception = (details.exception ?? {}) as Record<string, unknown>
        this.pushConsole({
          level: 'error',
          text: String(exception.description ?? details.text ?? 'Uncaught exception').slice(0, MAX_CONSOLE_TEXT)
        })
        break
      }
      case 'Log.entryAdded': {
        const entry = (p.entry ?? {}) as Record<string, unknown>
        this.pushConsole({
          level: String(entry.level ?? 'info'),
          text: String(entry.text ?? '').slice(0, MAX_CONSOLE_TEXT)
        })
        break
      }
      case 'Network.requestWillBeSent': {
        const request = (p.request ?? {}) as Record<string, unknown>
        this.rememberRequest(String(p.requestId ?? ''), {
          method: String(request.method ?? 'GET'),
          url: String(request.url ?? '')
        })
        break
      }
      case 'Network.responseReceived': {
        const requestId = String(p.requestId ?? '')
        const pending = this.pendingRequests.get(requestId)
        this.pendingRequests.delete(requestId)
        if (!pending) break
        const response = (p.response ?? {}) as Record<string, unknown>
        this.pushNetwork({ ...pending, status: Number(response.status ?? 0) })
        break
      }
      case 'Network.loadingFailed': {
        const requestId = String(p.requestId ?? '')
        const pending = this.pendingRequests.get(requestId)
        this.pendingRequests.delete(requestId)
        if (!pending) break
        this.pushNetwork({ ...pending, status: 'failed' })
        break
      }
      case 'Page.frameNavigated': {
        const frame = (p.frame ?? {}) as Record<string, unknown>
        // Only a main-frame navigation invalidates refs; iframes come and go all the time.
        if (!frame.parentId) {
          this.refs.clear()
          this.crashed = false
        }
        break
      }
      case 'Page.javascriptDialogOpening': {
        const type = String(p.type ?? 'alert')
        const message = String(p.message ?? '')
        const accept = type === 'alert' || type === 'beforeunload'
        this.dialogNotes.push(`dialog (${type}): ${message}`)
        void this.host.cdp.send('Page.handleJavaScriptDialog', { accept }).catch(() => {})
        break
      }
    }
  }

  private rememberRequest(requestId: string, data: { method: string; url: string }): void {
    // Redirects reuse the id; re-inserting keeps the map in arrival order.
    this.pendingRequests.delete(requestId)
    this.pendingRequests.set(requestId, data)
    while (this.pendingRequests.size > MAX_PENDING_REQUESTS) {
      const oldest = this.pendingRequests.keys().next().value
      if (oldest === undefined) break
      this.pendingRequests.delete(oldest)
    }
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleBuffer.push(entry)
    if (this.consoleBuffer.length > LOG_BUFFER_ENTRIES) {
      this.consoleBuffer.splice(0, this.consoleBuffer.length - LOG_BUFFER_ENTRIES)
    }
  }

  private pushNetwork(entry: NetworkEntry): void {
    this.networkBuffer.push(entry)
    if (this.networkBuffer.length > LOG_BUFFER_ENTRIES) {
      this.networkBuffer.splice(0, this.networkBuffer.length - LOG_BUFFER_ENTRIES)
    }
  }
}
