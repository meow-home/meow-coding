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
/** Matches the bridge's 30 s command timeout. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
/** How long the agent keeps the shield up after its last command. */
export const CONTROL_LEASE_MS = 15_000
/** How long an agent command waits while the user holds the tab. */
export const USER_HOLD_TIMEOUT_MS = 300_000

const USER_HELD_NOTE = '[meow] The user held this tab; the page may have changed. Re-read it.'

export interface BrowserTabTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface BrowserTabDeps {
  agentId: string
  /** Snapshot files are written here (`userData/browser-snapshots`). */
  snapshotDir: string
  /** Called when `control` really changes (not on lease renewals). */
  onControlChanged?: () => void
  /** Injectable for tests; defaults to the global timers. */
  timers?: BrowserTabTimers
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

interface BufferedConsoleEntry extends ConsoleEntry {
  held?: boolean
}

interface BufferedNetworkEntry extends NetworkEntry {
  held?: boolean
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
  private readonly consoleBuffer: BufferedConsoleEntry[] = []
  private readonly networkBuffer: BufferedNetworkEntry[] = []
  private readonly pendingRequests = new Map<string, { method: string; url: string; held: boolean }>()
  private readonly dialogNotes: string[] = []
  private readonly resumeNotes: string[] = []
  private readonly holdWaiters = new Set<() => void>()
  private readonly timers: BrowserTabTimers
  private control: BrowserTabControl = 'idle'
  private holdReason: string | undefined
  private leaseTimer: unknown = null
  private crashed = false
  private closed = false
  private readonly lifetime = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()
  private unsubscribe: (() => void) | null = null

  constructor(host: TabHost, deps: BrowserTabDeps) {
    this.host = host
    this.deps = deps
    this.id = host.id
    this.timers = deps.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
    this.unsubscribe = host.cdp.onEvent((method, params) => this.handleEvent(method, params))
  }

  /**
   * Commands run one at a time: subagents share their parent's tabs, and two
   * concurrent CDP sequences on one page would interleave.
   */
  run(
    name: BrowserCommandName,
    params: Record<string, unknown> = {},
    call?: BrowserCall,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
  ): Promise<BrowserCommandResult> {
    const task = this.queue.then(async () => {
      // Pipeline: wait for control, acquire the lease + shield, then execute and
      // decorate. The wait is not part of the command's execution budget, so it
      // runs before the timeout below starts.
      const blocked = await this.waitForControl(name, call)
      if (blocked) return this.decorate(blocked)
      return this.executeTimed(name, params, call, timeoutMs)
    })
    // A failed (or abandoned) command must not stop the queue for the commands behind it.
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  private waitForControl(name: BrowserCommandName, call: BrowserCall | undefined): Promise<BrowserCommandResult | null> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'tab closed' })
    if (this.control !== 'user') return Promise.resolve(null)
    const tab = this
    return new Promise(resolve => {
      let settled = false
      let timer: unknown = null
      const signal = call?.signal
      const lifetime = this.lifetime.signal

      function cleanup(): void {
        if (timer !== null) {
          tab.timers.clearTimeout(timer)
          timer = null
        }
        signal?.removeEventListener('abort', onAbort)
        lifetime.removeEventListener('abort', onClosed)
        tab.holdWaiters.delete(waiter)
      }

      function finish(result: BrowserCommandResult | null): void {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      function onAbort(): void {
        finish({ ok: false, error: `browser command aborted: ${name}` })
      }

      function onClosed(): void {
        finish({ ok: false, error: 'tab closed' })
      }

      function onTimeout(): void {
        finish({ ok: false, error: 'user is holding this tab' })
      }

      function waiter(): void {
        finish(null)
      }

      if (tab.closed) {
        onClosed()
        return
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      lifetime.addEventListener('abort', onClosed, { once: true })
      tab.holdWaiters.add(waiter)
      timer = tab.timers.setTimeout(onTimeout, USER_HOLD_TIMEOUT_MS)
      tab.unrefTimer(timer)
    })
  }

  private executeTimed(
    name: BrowserCommandName,
    params: Record<string, unknown>,
    call: BrowserCall | undefined,
    timeoutMs: number
  ): Promise<BrowserCommandResult> {
    // The clock covers execution only: the hold wait and any approval prompt run
    // before this point, so a long wait cannot spend the command's budget.
    const tab = this
    return new Promise(resolve => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const signal = call?.signal

      const lifetime = this.lifetime.signal

      function finish(result: BrowserCommandResult): void {
        if (settled) return
        settled = true
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        signal?.removeEventListener('abort', onAbort)
        lifetime.removeEventListener('abort', onClosed)
        tab.armLeaseIfAgent()
        resolve(result)
      }

      function onAbort(): void {
        finish({ ok: false, error: `browser command aborted: ${name}` })
      }

      function onClosed(): void {
        finish({ ok: false, error: 'tab closed' })
      }

      if (this.closed) {
        onClosed()
        return
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      lifetime.addEventListener('abort', onClosed, { once: true })
      this.acquire()
      timer = setTimeout(() => finish({ ok: false, error: `browser command timed out: ${name}` }), timeoutMs)
      this.dispatch(name, params).then(
        // A late result from an abandoned command is dropped without decorating
        // (which would consume dialog notes) or resolving anything.
        result => {
          if (!settled) finish(this.decorate(result))
        },
        err => {
          if (!settled) finish(this.decorate({ ok: false, error: `${name}: ${errorMessage(err)}` }))
        }
      )
    })
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
      control: this.control,
      ...(this.holdReason ? { holdReason: this.holdReason } : {})
    }
  }

  /** The agent path: entries captured while the user held the tab stay private. */
  consoleLogs(limit = LOG_BUFFER_ENTRIES): ConsoleEntry[] {
    return tail(this.consoleBuffer.filter(entry => !entry.held), limit)
      .map(entry => ({ level: entry.level, text: entry.text }))
  }

  /** The user's drawer path: everything, including entries captured during a hold. */
  allConsoleLogs(limit = LOG_BUFFER_ENTRIES): ConsoleEntry[] {
    return tail(this.consoleBuffer, limit).map(entry => ({ level: entry.level, text: entry.text }))
  }

  networkLogs(limit = LOG_BUFFER_ENTRIES): NetworkEntry[] {
    return tail(this.networkBuffer.filter(entry => !entry.held), limit)
      .map(entry => ({ method: entry.method, url: entry.url, status: entry.status }))
  }

  /** The user's drawer path: everything, including entries captured during a hold. */
  allNetworkLogs(limit = LOG_BUFFER_ENTRIES): NetworkEntry[] {
    return tail(this.networkBuffer, limit)
      .map(entry => ({ method: entry.method, url: entry.url, status: entry.status }))
  }

  /** The user takes control: the in-flight command finishes, the next ones wait. */
  takeOver(): void {
    if (this.control === 'user' || this.control === 'approval') return
    this.cancelLease()
    this.control = 'user'
    this.host.setShield({ visible: false })
    this.notifyControlChanged()
  }

  handBack(): void {
    if (this.control !== 'user') return
    this.control = 'idle'
    this.holdReason = undefined
    this.refs.clear()
    this.resumeNotes.push(USER_HELD_NOTE)
    const waiters = [...this.holdWaiters]
    this.holdWaiters.clear()
    for (const waiter of waiters) waiter()
    this.notifyControlChanged()
  }

  /** The turn ended: drop the lease unless the user is holding the tab. */
  releaseLease(): void {
    if (this.control !== 'agent') return
    this.cancelLease()
    this.control = 'idle'
    this.host.setShield({ visible: false })
    this.notifyControlChanged()
  }

  markCrashed(): void {
    this.crashed = true
    this.refs.clear()
  }

  /** Settles any in-flight command, then detaches and closes the page. */
  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.cancelLease()
    this.lifetime.abort('tab closed')
    this.unsubscribe?.()
    this.unsubscribe = null
    this.host.destroy()
  }

  private async dispatch(name: BrowserCommandName, params: Record<string, unknown>): Promise<BrowserCommandResult> {
    if (this.closed) return { ok: false, error: 'tab closed' }
    // A crashed tab is recoverable through navigation/reload; nothing else runs.
    if (this.crashed && name !== 'navigate' && name !== 'reload') {
      return { ok: false, error: 'tab crashed; call browser_navigate to reload it' }
    }
    switch (name) {
      case 'navigate': {
        const url = String(params.url ?? '')
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: `invalid url: ${url}` }
        await this.host.loadUrl(url)
        this.crashed = false
        return { ok: true, data: { tabId: this.id, url: this.host.getUrl(), title: this.host.getTitle() } }
      }
      case 'reload':
        this.host.history('reload')
        return { ok: true }
      case 'closeTab':
        // The browser removes and destroys the tab after this command settles.
        return { ok: true }
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
    const notes = [...this.dialogNotes.splice(0), ...this.resumeNotes.splice(0)]
    if (notes.length === 0) return result
    const note = notes.join('\n')
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
        // The agent's dialogs are auto-answered so a page cannot block a turn. In
        // user/idle the dialog belongs to the user: Electron shows its own native
        // alert/confirm and nothing is recorded for the agent.
        if (this.control !== 'agent' && this.control !== 'approval') break
        const type = String(p.type ?? 'alert')
        const message = String(p.message ?? '')
        const accept = type === 'alert' || type === 'beforeunload'
        this.dialogNotes.push(`dialog (${type}): ${message}`)
        void this.host.cdp.send('Page.handleJavaScriptDialog', { accept }).catch(() => {})
        break
      }
    }
  }

  private acquire(): void {
    this.cancelLease()
    const changed = this.control !== 'agent'
    this.control = 'agent'
    this.host.setShield({ visible: true })
    if (changed) this.notifyControlChanged()
  }

  /** Arm a fresh lease only while the agent still owns the tab. */
  private armLeaseIfAgent(): void {
    if (this.closed || this.control !== 'agent') return
    this.armLease()
  }

  private armLease(): void {
    this.cancelLease()
    this.leaseTimer = this.timers.setTimeout(() => this.expireLease(), CONTROL_LEASE_MS)
    this.unrefTimer(this.leaseTimer)
  }

  private cancelLease(): void {
    if (this.leaseTimer === null) return
    this.timers.clearTimeout(this.leaseTimer)
    this.leaseTimer = null
  }

  private expireLease(): void {
    this.leaseTimer = null
    if (this.control !== 'agent') return
    this.control = 'idle'
    this.host.setShield({ visible: false })
    this.notifyControlChanged()
  }

  private unrefTimer(handle: unknown): void {
    const maybe = handle as { unref?: () => void } | null
    maybe?.unref?.()
  }

  private notifyControlChanged(): void {
    this.deps.onControlChanged?.()
  }

  private rememberRequest(requestId: string, data: { method: string; url: string }): void {
    // A request that starts while the user holds the tab stays private even if its
    // response arrives after hand-back. Redirects reuse the id: keep the first mark.
    const previous = this.pendingRequests.get(requestId)
    const held = previous?.held === true || this.control === 'user'
    // Redirects reuse the id; re-inserting keeps the map in arrival order.
    this.pendingRequests.delete(requestId)
    this.pendingRequests.set(requestId, { ...data, held })
    while (this.pendingRequests.size > MAX_PENDING_REQUESTS) {
      const oldest = this.pendingRequests.keys().next().value
      if (oldest === undefined) break
      this.pendingRequests.delete(oldest)
    }
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleBuffer.push({ ...entry, ...(this.control === 'user' ? { held: true } : {}) })
    if (this.consoleBuffer.length > LOG_BUFFER_ENTRIES) {
      this.consoleBuffer.splice(0, this.consoleBuffer.length - LOG_BUFFER_ENTRIES)
    }
  }

  private pushNetwork(entry: NetworkEntry & { held?: boolean }): void {
    const held = entry.held === true || this.control === 'user'
    this.networkBuffer.push({
      method: entry.method,
      url: entry.url,
      status: entry.status,
      ...(held ? { held: true } : {})
    })
    if (this.networkBuffer.length > LOG_BUFFER_ENTRIES) {
      this.networkBuffer.splice(0, this.networkBuffer.length - LOG_BUFFER_ENTRIES)
    }
  }
}
