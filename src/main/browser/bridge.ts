import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type {
  BrowserCommandName, BrowserCommandResult, BrowserEvent, BrowserStatus, BrowserStatusInfo,
  ExtensionToBridge, HelloMessage, HelloResultMessage, PendingExtensionInfo, TrustedExtension
} from '../../shared/browser-types'
import type { SnapshotNode } from '../../shared/browser-types'
import { snapshotToText, countSnapshotNodes } from './snapshot-format'
import { TrustedExtensionStore } from './trusted-store'

export interface BridgeDeps {
  host?: string
  preferredPort?: number
  screenshotDir?: string
  snapshotDir?: string
  maxLogEntries?: number
  createServer?: () => Server
  trusted?: TrustedExtensionStore
  pendingTtlMs?: number
}

interface PendingCommand {
  resolve: (r: BrowserCommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3927
const DEFAULT_MAX_LOG = 200
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_PENDING_TTL_MS = 120_000

export class BrowserBridge {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private status: BrowserStatus = 'idle'
  private port = 0
  private pending = new Map<string, PendingCommand>()
  private consoleLogs: unknown[] = []
  private networkLogs: unknown[] = []
  private statusListeners = new Set<(info: BrowserStatusInfo) => void>()
  private pendingExtension: PendingExtensionInfo | null = null
  private pendingSocket: WebSocket | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private pairedExtensionId: string | null = null
  private trusted: TrustedExtensionStore

  constructor(private deps: BridgeDeps = {}) {
    this.trusted = deps.trusted ?? new TrustedExtensionStore()
  }

  // `paired` tracks the trusted socket, not the UI status: an unknown extension
  // waiting for approval must not make a working bridge look disconnected.
  private get isPaired(): boolean {
    return this.pairedExtensionId !== null && this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  getStatus(): BrowserStatusInfo {
    const paired = this.isPaired
    return {
      status: this.status,
      port: this.port,
      paired,
      ...(this.pendingExtension ? { pendingExtension: this.pendingExtension } : {})
    }
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    const host = this.deps.host ?? DEFAULT_HOST
    const preferred = this.deps.preferredPort ?? DEFAULT_PORT

    const server = (this.deps.createServer ?? createServer)()
    server.on('request', (req, res) => {
      if (req.url?.startsWith('/api/status')) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*'
        })
        res.end(JSON.stringify({ port: this.port, status: this.status }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(preferred, host)
    })

    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
    this.server = server
    this.wss = new WebSocketServer({ server })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    this.setStatus('listening')
    return this.port
  }

  execute(
    name: BrowserCommandName,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<BrowserCommandResult> {
    if (!this.isPaired || !this.socket) {
      return Promise.resolve({ ok: false, error: 'browser not connected — run browser_start first' })
    }
    const id = randomUUID()
    return new Promise<BrowserCommandResult>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: `browser command timed out: ${name}` })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.socket!.send(JSON.stringify({ type: 'cmd', id, name, params }))
    })
  }

  waitForPaired(timeoutMs: number): Promise<boolean> {
    if (this.isPaired) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, timeoutMs)
      const off = this.onStatusChange(info => {
        if (info.paired) {
          clearTimeout(timer)
          off()
          resolve(true)
        }
      })
    })
  }

  getConsoleLogs(limit?: number): unknown[] {
    return sliceTail(this.consoleLogs, limit ?? DEFAULT_MAX_LOG)
  }

  getNetworkLogs(limit?: number): unknown[] {
    return sliceTail(this.networkLogs, limit ?? DEFAULT_MAX_LOG)
  }

  onStatusChange(cb: (info: BrowserStatusInfo) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private rejectPendingCommands(error: string): void {
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer)
      resolve({ ok: false, error })
    }
    this.pending.clear()
  }

  async close(): Promise<void> {
    this.rejectPendingCommands('browser bridge closed')
    this.socket?.close()
    this.socket = null
    await new Promise<void>(resolve => {
      if (!this.wss) { resolve(); return }
      this.wss.close(() => resolve())
    })
    this.wss = null
    await new Promise<void>(resolve => {
      if (!this.server) { resolve(); return }
      this.server.close(() => resolve())
    })
    this.server = null
    this.clearPending()
    this.pairedExtensionId = null
    this.setStatus('idle')
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // this.socket is assigned only after a hello passes the origin check, so an
    // unknown connection can never evict the extension that is currently paired.
    const origin = req.headers.origin
    if (this.status === 'idle' || this.status === 'disconnected') this.setStatus('listening')

    ws.on('message', (raw) => {
      let msg: ExtensionToBridge
      try {
        msg = JSON.parse(String(raw)) as ExtensionToBridge
      } catch {
        return
      }
      if (msg.type === 'hello') {
        this.handleHello(ws, origin, msg)
        return
      }
      if (ws !== this.socket) return
      if (msg.type === 'result') this.handleResult(msg.id, msg)
      else if (msg.type === 'event') this.handleEvent(msg.name, msg.data)
      else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })

    ws.on('close', () => {
      if (this.socket !== ws) return
      const wasPaired = this.pairedExtensionId !== null
      this.socket = null
      this.pairedExtensionId = null
      this.clearPending()
      this.rejectPendingCommands('browser extension disconnected')
      this.setStatus(wasPaired ? 'disconnected' : 'listening')
    })
    ws.on('error', () => ws.close())
  }

  private handleHello(ws: WebSocket, origin: string | undefined, msg: HelloMessage): void {
    // The claimed id is only trustworthy when the handshake Origin matches it: a web
    // page or a local process can send any id, but cannot forge a chrome-extension:// origin.
    if (!msg.extensionId || origin !== `chrome-extension://${msg.extensionId}`) {
      ws.send(JSON.stringify({
        type: 'hello_result', ok: false, paired: false, error: 'origin mismatch'
      } satisfies HelloResultMessage))
      // Detach first: the close handler only touches the socket it still owns, so a
      // rejected connection must not be able to move the bridge out of listening.
      if (this.socket === ws) this.socket = null
      ws.close()
      return
    }
    if (this.trusted.has(msg.extensionId)) {
      this.clearPending()
      if (this.socket && this.socket !== ws && this.socket.readyState === WebSocket.OPEN) this.socket.close()
      this.socket = ws
      this.pairedExtensionId = msg.extensionId
      this.setStatus('paired')
      ws.send(JSON.stringify({ type: 'hello_result', ok: true, paired: true } satisfies HelloResultMessage))
      return
    }
    if (this.pendingSocket && this.pendingSocket !== ws) this.pendingSocket.close()
    this.pendingSocket = ws
    this.pendingExtension = {
      extensionId: msg.extensionId,
      ...(msg.version ? { version: msg.version } : {}),
      requestedAt: Date.now()
    }
    this.armPendingTimer()
    this.setStatus('pending')
    ws.send(JSON.stringify({
      type: 'hello_result', ok: true, paired: false, pending: true
    } satisfies HelloResultMessage))
  }

  private armPendingTimer(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      const socket = this.pendingSocket
      this.clearPending()
      // Detach before closing so the socket's own close handler does not overwrite
      // the status we are about to set (and never touch a paired socket).
      if (this.socket === socket) this.socket = null
      if (this.status === 'pending') this.setStatus(this.pairedExtensionId ? 'paired' : 'listening')
      socket?.close()
    }, this.deps.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS)
  }

  private clearPending(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.pendingExtension = null
    this.pendingSocket = null
  }

  approveExtension(extensionId: string): BrowserStatusInfo {
    if (this.pendingExtension?.extensionId !== extensionId) return this.getStatus()
    const socket = this.pendingSocket
    this.trusted.approve(extensionId, this.pendingExtension.version)
    this.clearPending()
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'hello_result', ok: true, paired: true } satisfies HelloResultMessage))
      this.socket = socket
      this.pairedExtensionId = extensionId
      this.setStatus('paired')
    }
    return this.getStatus()
  }

  denyExtension(extensionId: string): BrowserStatusInfo {
    if (this.pendingExtension?.extensionId !== extensionId) return this.getStatus()
    const socket = this.pendingSocket
    this.clearPending()
    if (this.socket === socket) this.socket = null
    if (this.status === 'pending') this.setStatus(this.pairedExtensionId ? 'paired' : 'listening')
    socket?.close()
    return this.getStatus()
  }

  revokeExtension(extensionId: string): BrowserStatusInfo {
    this.trusted.revoke(extensionId)
    if (this.pairedExtensionId === extensionId) {
      this.socket?.close()
      this.socket = null
      this.pairedExtensionId = null
      this.setStatus('listening')
    }
    return this.getStatus()
  }

  getTrustedExtensions(): TrustedExtension[] {
    return this.trusted.list()
  }

  private handleResult(id: string, msg: ExtensionToBridge & { type: 'result' }): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (msg.ok) {
      const data = msg.data as Record<string, unknown> | undefined
      const hasBase64 = !!data && typeof data === 'object' && 'base64' in data
      if (hasBase64 && this.deps.screenshotDir) {
        pending.resolve(this.saveScreenshot((data as { base64: string }).base64))
        return
      }
      const tree = data?.tree as SnapshotNode[] | undefined
      if (Array.isArray(tree) && this.deps.snapshotDir) {
        pending.resolve(this.saveSnapshot(tree))
        return
      }
      pending.resolve({ ok: true, data: msg.data })
    } else {
      pending.resolve({ ok: false, error: msg.error ?? 'browser command failed' })
    }
  }

  private saveSnapshot(tree: SnapshotNode[]): BrowserCommandResult {
    try {
      const dir = this.deps.snapshotDir!
      mkdirSync(dir, { recursive: true })
      const text = snapshotToText(tree)
      const file = path.join(dir, `browser-snapshot-${Date.now()}.txt`)
      writeFileSync(file, text, 'utf-8')
      const lines = text.split('\n')
      const preview = lines.slice(0, 80).join('\n') + (lines.length > 80 ? '\n...(preview cut — read the file for the full snapshot)' : '')
      return {
        ok: true,
        data: {
          path: file,
          size: Buffer.byteLength(text, 'utf-8'),
          nodeCount: countSnapshotNodes(tree),
          preview
        }
      }
    } catch (err) {
      return { ok: false, error: `snapshot save failed: ${String(err)}` }
    }
  }

  private saveScreenshot(base64: string): BrowserCommandResult {
    try {
      const dir = this.deps.screenshotDir!
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `browser-${Date.now()}.png`)
      writeFileSync(file, Buffer.from(base64, 'base64'))
      return { ok: true, data: { path: file } }
    } catch (err) {
      return { ok: false, error: `screenshot save failed: ${String(err)}` }
    }
  }

  private handleEvent(name: BrowserEvent['name'], data: unknown): void {
    if (name === 'console') {
      this.consoleLogs.push({ ...(data as object), ts: Date.now() })
      this.consoleLogs = sliceTail(this.consoleLogs, this.deps.maxLogEntries ?? DEFAULT_MAX_LOG)
    } else if (name === 'network') {
      this.networkLogs.push({ ...(data as object), ts: Date.now() })
      this.networkLogs = sliceTail(this.networkLogs, this.deps.maxLogEntries ?? DEFAULT_MAX_LOG)
    }
  }

  private setStatus(status: BrowserStatus): void {
    if (this.status === status) return
    this.status = status
    const info = this.getStatus()
    for (const cb of this.statusListeners) cb(info)
  }
}

function sliceTail<T>(arr: T[], limit: number): T[] {
  return arr.length > limit ? arr.slice(arr.length - limit) : [...arr]
}
