import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { CreateTaskBody, TaskDto } from '../../shared/external-api-types'
import { ExternalApiError } from './errors'

export interface ExternalApiHandler {
  version(): string
  createTask(body: CreateTaskBody): Promise<TaskDto>
  getTask(id: string): TaskDto | undefined
  cancelTask(id: string): Promise<TaskDto>
}

export interface ExternalApiServerDeps {
  handler: ExternalApiHandler
  getToken: () => string
  host?: string
  preferredPort?: number
  maxWaitMs?: number
}

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

const MAX_BODY_BYTES = 64 * 1024
const DEFAULT_WAIT_S = 60
const DEFAULT_MAX_WAIT_MS = 120_000

interface Waiter {
  taskId: string
  finish: (done: boolean) => void
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new ExternalApiError(413, '[meow] Request body exceeds 64 KiB.'))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseCreateBody(raw: string): CreateTaskBody {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ExternalApiError(400, '[meow] Body is not valid JSON.')
  }
  const b = body as Record<string, unknown>
  if (typeof b !== 'object' || b === null) throw new ExternalApiError(400, '[meow] Body must be an object.')
  for (const key of ['cwd', 'planKey', 'task'] as const) {
    if (typeof b[key] !== 'string') throw new ExternalApiError(400, `[meow] Missing string field: ${key}`)
  }
  if (b.title !== undefined && typeof b.title !== 'string') throw new ExternalApiError(400, '[meow] title must be a string.')
  if (b.sessionId !== undefined && typeof b.sessionId !== 'string') throw new ExternalApiError(400, '[meow] sessionId must be a string.')
  return {
    cwd: b.cwd as string,
    planKey: b.planKey as string,
    task: b.task as string,
    ...(b.title !== undefined ? { title: b.title as string } : {}),
    ...(b.sessionId !== undefined ? { sessionId: b.sessionId as string } : {})
  }
}

export class ExternalApiServer {
  private server: Server | null = null
  private boundPort: number | null = null
  private waiters = new Set<Waiter>()

  constructor(private deps: ExternalApiServerDeps) {}

  get port(): number | null {
    return this.boundPort
  }

  async start(): Promise<number> {
    if (this.server) return this.boundPort!
    const host = this.deps.host ?? '127.0.0.1'
    const preferred = this.deps.preferredPort ?? 3929
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    try {
      await this.listen(server, preferred, host)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      await this.listen(server, 0, host)
    }
    const addr = server.address()
    this.boundPort = typeof addr === 'object' && addr ? addr.port : null
    this.server = server
    return this.boundPort!
  }

  async stop(): Promise<void> {
    for (const w of [...this.waiters]) w.finish(false)
    const server = this.server
    this.server = null
    this.boundPort = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  notifyChanged(taskId: string): void {
    const task = this.deps.handler.getTask(taskId)
    if (!task || !TERMINAL_STATUSES.has(task.status)) return
    for (const w of [...this.waiters]) if (w.taskId === taskId) w.finish(true)
  }

  private listen(server: Server, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.headers.origin !== undefined) return send(res, 403, { error: '[meow] Browser requests are not allowed.' })
      if (!tokenMatches(req.headers.authorization, this.deps.getToken())) {
        return send(res, 401, { error: '[meow] Invalid or missing token.' })
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const parts = url.pathname.split('/').filter(Boolean)
      const { handler } = this.deps
      if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { version: handler.version() })
      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const task = await handler.createTask(parseCreateBody(await readBody(req)))
        return send(res, 200, { task })
      }
      if (parts[0] === 'v1' && parts[1] === 'tasks' && parts[2]) {
        const id = decodeURIComponent(parts[2])
        if (req.method === 'GET' && parts.length === 3) {
          const task = handler.getTask(id)
          return task ? send(res, 200, { task }) : send(res, 404, { error: `[meow] Unknown task: ${id}` })
        }
        if (req.method === 'GET' && parts[3] === 'wait' && parts.length === 4) {
          return await this.wait(id, url, res)
        }
        if (req.method === 'POST' && parts[3] === 'cancel' && parts.length === 4) {
          return send(res, 200, { task: await handler.cancelTask(id) })
        }
      }
      send(res, 404, { error: '[meow] Not found.' })
    } catch (err) {
      if (err instanceof ExternalApiError) return send(res, err.status, { error: err.message })
      send(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async wait(id: string, url: URL, res: ServerResponse): Promise<void> {
    const { handler } = this.deps
    const first = handler.getTask(id)
    if (!first) return send(res, 404, { error: `[meow] Unknown task: ${id}` })
    if (TERMINAL_STATUSES.has(first.status)) return send(res, 200, { done: true, task: first })
    const requestedS = Number(url.searchParams.get('timeout') ?? DEFAULT_WAIT_S)
    const requestedMs = Number.isFinite(requestedS) && requestedS > 0 ? requestedS * 1000 : DEFAULT_WAIT_S * 1000
    const ms = Math.min(requestedMs, this.deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS)
    await new Promise<void>((resolve) => {
      const waiter: Waiter = {
        taskId: id,
        finish: (done) => {
          clearTimeout(timer)
          this.waiters.delete(waiter)
          const task = handler.getTask(id) ?? first
          send(res, 200, { done: done && TERMINAL_STATUSES.has(task.status), task })
          resolve()
        }
      }
      const timer = setTimeout(() => waiter.finish(false), ms)
      res.on('close', () => {
        if (!this.waiters.has(waiter)) return
        clearTimeout(timer)
        this.waiters.delete(waiter)
        resolve()
      })
      this.waiters.add(waiter)
    })
  }
}
