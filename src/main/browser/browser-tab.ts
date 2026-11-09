import type { BrowserCall } from './browser-backend'
import type {
  BrowserCommandName, BrowserCommandResult, BrowserReadMode, BrowserTabControl, BrowserTabInfo
} from '../../shared/browser-types'
import * as commands from './cdp-commands'
import { staleRefError } from './cdp-commands'
import type { RefLabel, TargetRect } from './cdp-commands'
import { SiteApprovals } from './site-approval'
import { isLoopback } from '../../shared/loopback'

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
  /** Panel visibility: placement, viewport metrics and the physical shield view. */
  setOnScreen(onScreen: boolean, bounds?: { x: number; y: number; width: number; height: number }): Promise<void>
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
  /** Session approvals shared by the owner's tabs (and its subagents). */
  siteApprovals?: SiteApprovals
  /** Read per call, so a settings change applies without a restart. */
  siteApproval?: () => 'ask' | 'off'
  /** Fired when the agent hands the tab to the user (panel request + notification). */
  onHandoff?: (reason: string) => void
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

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'null'
  }
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
  private readonly refLabels = new Map<string, RefLabel>()
  private readonly consoleBuffer: BufferedConsoleEntry[] = []
  private readonly networkBuffer: BufferedNetworkEntry[] = []
  private readonly pendingRequests = new Map<string, { method: string; url: string; held: boolean }>()
  private readonly dialogNotes: string[] = []
  private readonly resumeNotes: string[] = []
  private readonly holdWaiters = new Set<() => void>()
  private readonly timers: BrowserTabTimers
  private readonly siteApprovals: SiteApprovals
  private control: BrowserTabControl = 'idle'
  private onScreen = false
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
    this.siteApprovals = deps.siteApprovals ?? new SiteApprovals()
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
      // Pipeline: wait for control, acquire the lease + shield, refuse sensitive
      // fields, ask for site approval, then execute. Neither the hold wait nor the
      // prompt is part of the command's execution budget. A handoff goes straight
      // to the user state with no clock and no approval.
      const blocked = await this.waitForControl(name, call)
      if (blocked) return this.decorate(blocked)
      if (name === 'handoff') return this.handoff(String(params.reason ?? ''), call)
      this.acquire()
      const sensitive = await this.sensitiveCheck(name, params, call)
      if (sensitive) return this.decorate(sensitive)
      const denied = await this.approvalGate(name, params, call)
      if (denied) return this.decorate(denied)
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
    // The clock covers execution only: the hold wait, the sensitive check and any
    // approval prompt run before this point, so a long wait cannot spend it.
    return this.bounded(name, call, timeoutMs, () => this.dispatch(name, params))
  }

  /**
   * Runs `work` with the command timeout and abort/close listeners. Shared by the
   * sensitive check and the command itself so a hung page cannot wedge the queue.
   */
  private bounded(
    name: BrowserCommandName,
    call: BrowserCall | undefined,
    timeoutMs: number,
    work: () => Promise<BrowserCommandResult>,
    decorateResults = true
  ): Promise<BrowserCommandResult> {
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
      timer = setTimeout(() => finish({ ok: false, error: `browser command timed out: ${name}` }), timeoutMs)
      work().then(
        // A late result from an abandoned command is dropped without decorating
        // (which would consume dialog notes) or resolving anything.
        result => {
          if (!settled) finish(decorateResults ? tab.decorate(result) : result)
        },
        err => {
          const error = { ok: false as const, error: `${name}: ${errorMessage(err)}` }
          if (!settled) finish(decorateResults ? tab.decorate(error) : error)
        }
      )
    })
  }

  /**
   * Step 3: password/payment fields are refused before the approval prompt, so a
   * prompt is never wasted on an action that cannot run. Bounded like a command.
   */
  private async sensitiveCheck(
    name: BrowserCommandName,
    params: Record<string, unknown>,
    call: BrowserCall | undefined
  ): Promise<BrowserCommandResult | null> {
    if (name !== 'type' && name !== 'select') return null
    const result = await this.bounded(
      name,
      call,
      DEFAULT_COMMAND_TIMEOUT_MS,
      () => this.sensitiveTarget(name, params),
      false
    )
    return result.ok ? null : result
  }

  private async sensitiveTarget(name: 'type' | 'select', params: Record<string, unknown>): Promise<BrowserCommandResult> {
    if (params.ref != null) {
      const ref = String(params.ref)
      const backendNodeId = this.refs.get(ref)
      if (backendNodeId == null) return staleRefError(ref)
      const sensitive = await commands.isSensitiveTarget(this.host.cdp, { backendNodeId })
      return sensitive ? commands.sensitiveFieldError(name) : { ok: true }
    }
    const selector = params.selector != null ? String(params.selector) : null
    if (!selector) return { ok: false, error: `${name} requires ref or selector` }
    const doc = await this.host.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
    const found = await this.host.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
    if (!found.nodeId) return { ok: false, error: `selector not found: ${selector}` }
    const sensitive = await commands.isSensitiveTarget(this.host.cdp, { nodeId: found.nodeId })
    return sensitive ? commands.sensitiveFieldError(name) : { ok: true }
  }

  /** The panel shows this tab; the host handles the physical side. */
  async setOnScreen(onScreen: boolean, bounds?: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.onScreen = onScreen
    await this.host.setOnScreen(onScreen, bounds)
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.host.setBounds(bounds)
  }

  setVisible(visible: boolean): void {
    this.host.setVisible(visible)
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

  /**
   * Hand the tab to the user for a step only a person can do. No clock: it holds
   * the queue until hand-back, abort or tab close. Returns only whether the origin
   * changed across the hold.
   */
  async handoff(reason: string, call?: BrowserCall): Promise<BrowserCommandResult> {
    const text = reason.trim().slice(0, 200)
    if (!text) return { ok: false, error: 'browser_handoff requires a reason' }
    const origin = originOf(this.host.getUrl())
    this.control = 'user'
    this.holdReason = text
    this.cancelLease()
    this.setShieldSafe({ visible: false })
    this.notifyControlChanged()
    this.deps.onHandoff?.(text)

    const outcome = await this.waitForHandBack(call)
    if ('error' in outcome) {
      // Abort (Stop) leaves the sign-in uninterrupted: stay user, drop the reason so
      // the banner falls back to the plain hold.
      this.holdReason = undefined
      this.notifyControlChanged()
      return outcome.error
    }
    return { ok: true, data: { originChanged: originOf(this.host.getUrl()) !== origin } }
  }

  private waitForHandBack(call?: BrowserCall): Promise<{ ok: true } | { error: BrowserCommandResult }> {
    const tab = this
    return new Promise(resolve => {
      let settled = false
      const signal = call?.signal
      const lifetime = this.lifetime.signal

      function cleanup(): void {
        signal?.removeEventListener('abort', onAbort)
        lifetime.removeEventListener('abort', onClosed)
        tab.holdWaiters.delete(waiter)
      }

      function finish(result: { ok: true } | { error: BrowserCommandResult }): void {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      function onAbort(): void {
        finish({ error: { ok: false, error: 'browser command aborted: browser_handoff' } })
      }

      function onClosed(): void {
        finish({ error: { ok: false, error: 'tab closed' } })
      }

      function waiter(): void {
        finish({ ok: true })
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
    })
  }

  /** The user takes control: the in-flight command finishes, the next ones wait. */
  takeOver(): void {
    if (this.control === 'user' || this.control === 'approval') return
    this.cancelLease()
    this.control = 'user'
    this.setShieldSafe({ visible: false })
    this.notifyControlChanged()
  }

  handBack(): void {
    if (this.control !== 'user') return
    this.control = 'idle'
    this.holdReason = undefined
    this.refs.clear()
    this.refLabels.clear()
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
    this.setShieldSafe({ visible: false })
    this.notifyControlChanged()
  }

  markCrashed(): void {
    this.crashed = true
    this.refs.clear()
    this.refLabels.clear()
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
        return commands.read(this.host.cdp, this.refs, this.refLabels, {
          mode: params.mode as BrowserReadMode | undefined,
          snapshotDir: this.deps.snapshotDir
        })
      case 'click':
        return commands.click(this.host.cdp, this.refs, params, target => this.showShieldTarget(target))
      case 'type':
        return commands.type(this.host.cdp, this.refs, params, target => this.showShieldTarget(target))
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
          this.refLabels.clear()
          this.crashed = false
        }
        break
      }
      case 'Page.javascriptDialogOpening': {
        // The agent's dialogs are auto-answered so a page cannot block a turn. On
        // screen, user/idle dialogs belong to the user (Electron shows its own
        // alert/confirm). Off screen the agent rule applies so an unseen page cannot
        // pop an OS dialog — except while the user holds the tab.
        const autoAnswer = this.control === 'agent' || this.control === 'approval'
          || (!this.onScreen && this.control !== 'user')
        if (!autoAnswer) break
        const type = String(p.type ?? 'alert')
        const message = String(p.message ?? '')
        const accept = type === 'alert' || type === 'beforeunload'
        this.dialogNotes.push(`dialog (${type}): ${message}`)
        void this.host.cdp.send('Page.handleJavaScriptDialog', { accept }).catch(() => {})
        break
      }
    }
  }

  /**
   * Step 4: click/type/select on a non-loopback origin needs the user's consent
   * once per session. The prompt is outside the command clock.
   */
  private async approvalGate(
    name: BrowserCommandName,
    params: Record<string, unknown>,
    call: BrowserCall | undefined
  ): Promise<BrowserCommandResult | null> {
    if (name !== 'click' && name !== 'type' && name !== 'select') return null
    if ((this.deps.siteApproval ?? (() => 'ask'))() === 'off') return null
    const url = this.host.getUrl()
    const origin = originOf(url)
    if (isLoopback(origin)) return null
    if (this.siteApprovals.isAllowed(this.deps.agentId, origin)) return null

    const target = this.describeTarget(params)
    if ('error' in target) return target.error
    const site = origin === 'null' ? (url || 'about:blank') : origin

    this.control = 'approval'
    this.setShieldSafe({ visible: true })
    this.notifyControlChanged()
    const outcome = await this.askApproval(call, name, site, target.label)
    // The prompt can outlive a take-over attempt; the tab stays the agent's while
    // it runs and goes back to `agent` for the answer.
    this.control = 'agent'
    this.setShieldSafe({ visible: true })
    this.notifyControlChanged()
    if ('error' in outcome) {
      this.armLeaseIfAgent()
      return outcome.error
    }

    const now = originOf(this.host.getUrl())
    if (now !== origin) {
      this.refs.clear()
      this.refLabels.clear()
      this.armLeaseIfAgent()
      return { ok: false, error: `page changed during approval (now ${now}): re-read it` }
    }
    if (outcome.answer === 'Allow once') return null
    if (outcome.answer === 'Allow this site for the session') {
      this.siteApprovals.allow(this.deps.agentId, origin)
      return null
    }
    this.armLeaseIfAgent()
    return { ok: false, error: `not approved: ${origin}` }
  }

  /** Settles on an answer, `call.signal` abort or tab close; `ask` may never resolve. */
  private askApproval(
    call: BrowserCall | undefined,
    name: BrowserCommandName,
    site: string,
    target: string
  ): Promise<{ answer: string | null } | { error: BrowserCommandResult }> {
    if (!call) return Promise.resolve({ answer: null })
    const tab = this
    return new Promise(resolve => {
      let settled = false
      const signal = call.signal
      const lifetime = this.lifetime.signal

      function cleanup(): void {
        signal?.removeEventListener('abort', onAbort)
        lifetime.removeEventListener('abort', onClosed)
      }

      function finish(result: { answer: string | null } | { error: BrowserCommandResult }): void {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      function onAbort(): void {
        finish({ error: { ok: false, error: `browser command aborted: ${name}` } })
      }

      function onClosed(): void {
        finish({ error: { ok: false, error: 'tab closed' } })
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
      void call.ask({
        header: 'Allow Meow to act on this site?',
        question: `Allow Meow to act on this site?\nbrowser_${name} on ${site}\nTarget: ${target}`,
        options: [
          { label: 'Allow once' },
          { label: 'Allow this site for the session' },
          { label: 'Deny' }
        ],
        custom: false
      }).then(
        answer => finish({ answer }),
        () => finish({ answer: null })
      )
    })
  }

  /** What the page calls the target; an unknown ref never prompts (the command is stale). */
  private describeTarget(params: Record<string, unknown>): { label: string } | { error: BrowserCommandResult } {
    if (params.ref != null) {
      const ref = String(params.ref)
      if (!this.refs.has(ref)) return { error: staleRefError(ref) }
      const label = this.refLabels.get(ref)
      if (!label) return { label: `ref ${ref}` }
      const text = label.name.replace(/\s+/g, ' ').trim().slice(0, 80)
      return { label: text ? `${label.role} "${text}"` : label.role }
    }
    if (params.selector != null) return { label: `selector ${String(params.selector)}` }
    return { label: `at ${Number(params.x)},${Number(params.y)}` }
  }

  /** The shield's target ring, drawn before the input is dispatched. */
  private showShieldTarget(target: TargetRect | null): void {
    if (this.control !== 'agent' && this.control !== 'approval') return
    this.setShieldSafe(target ? { visible: true, target } : { visible: true })
  }

  /** Decoration never fails a command: a shield problem stays invisible to the agent. */
  private setShieldSafe(state: { visible: boolean; target?: TargetRect }): void {
    try {
      this.host.setShield(state)
    } catch {
      // The page and the command continue without the shield.
    }
  }

  private acquire(): void {
    this.cancelLease()
    const changed = this.control !== 'agent'
    this.control = 'agent'
    this.setShieldSafe({ visible: true })
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
    this.setShieldSafe({ visible: false })
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
