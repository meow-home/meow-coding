import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'node:net'
import { Server as HttpServer } from 'node:http'
import { ExternalApiServer, type ExternalApiHandler } from '../../src/main/external-api/server'
import { ExternalApiError } from '../../src/main/external-api/errors'
import type { CreateTaskBody, TaskDto } from '../../src/shared/external-api-types'

const TOKEN = 'a'.repeat(64)

function dto(over: Partial<TaskDto> = {}): TaskDto {
  return { id: 't1', status: 'queued', sessionId: 's1', projectPath: '/p', planKey: 'k', createdAt: 1, touchedFiles: [], ...over }
}

class FakeHandler implements ExternalApiHandler {
  tasks = new Map<string, TaskDto>()
  created: CreateTaskBody[] = []
  version() { return '9.9.9' }
  async createTask(body: CreateTaskBody) {
    if (body.cwd === '/missing') throw new ExternalApiError(400, '[meow] cwd does not exist')
    this.created.push(body)
    const t = dto()
    this.tasks.set(t.id, t)
    return t
  }
  getTask(id: string) { return this.tasks.get(id) }
  async cancelTask(id: string) {
    const t = this.tasks.get(id)
    if (!t) throw new ExternalApiError(404, 'unknown')
    const c = { ...t, status: 'cancelled' as const }
    this.tasks.set(id, c)
    return c
  }
}

describe('ExternalApiServer', () => {
  let handler: FakeHandler
  let server: ExternalApiServer
  let base: string
  const auth = { authorization: `Bearer ${TOKEN}` }

  beforeEach(async () => {
    handler = new FakeHandler()
    server = new ExternalApiServer({ handler, getToken: () => TOKEN, preferredPort: 0, maxWaitMs: 300 })
    const port = await server.start()
    base = `http://127.0.0.1:${port}`
  })
  afterEach(async () => { await server.stop() })

  it('rejects a missing or wrong token with 401', async () => {
    expect((await fetch(`${base}/v1/health`)).status).toBe(401)
    expect((await fetch(`${base}/v1/health`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('rejects any request carrying an Origin header with 403', async () => {
    const res = await fetch(`${base}/v1/health`, { headers: { ...auth, origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('serves health', async () => {
    const res = await fetch(`${base}/v1/health`, { headers: auth })
    expect(await res.json()).toEqual({ version: '9.9.9' })
  })

  it('creates a task', async () => {
    const res = await fetch(`${base}/v1/tasks`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/p', planKey: 'k', task: 'do' })
    })
    expect(res.status).toBe(200)
    expect((await res.json()).task.id).toBe('t1')
    expect(handler.created[0]).toEqual({ cwd: '/p', planKey: 'k', task: 'do' })
  })

  it('maps handler errors to their status', async () => {
    const res = await fetch(`${base}/v1/tasks`, {
      method: 'POST', headers: auth, body: JSON.stringify({ cwd: '/missing', planKey: 'k', task: 'do' })
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cwd/)
  })

  it('rejects malformed JSON and missing fields with 400', async () => {
    expect((await fetch(`${base}/v1/tasks`, { method: 'POST', headers: auth, body: '{' })).status).toBe(400)
    expect((await fetch(`${base}/v1/tasks`, { method: 'POST', headers: auth, body: '{"cwd":"/p"}' })).status).toBe(400)
  })

  it('rejects bodies over 64 KiB with 413', async () => {
    const body = JSON.stringify({ cwd: '/p', planKey: 'k', task: 'x'.repeat(65 * 1024) })
    expect((await fetch(`${base}/v1/tasks`, { method: 'POST', headers: auth, body })).status).toBe(413)
  })

  it('returns 404 for unknown tasks and routes', async () => {
    expect((await fetch(`${base}/v1/tasks/zzz`, { headers: auth })).status).toBe(404)
    expect((await fetch(`${base}/v1/nope`, { headers: auth })).status).toBe(404)
  })

  it('wait returns immediately for a terminal task', async () => {
    handler.tasks.set('t2', dto({ id: 't2', status: 'completed' }))
    const res = await fetch(`${base}/v1/tasks/t2/wait?timeout=5`, { headers: auth })
    expect(await res.json()).toMatchObject({ done: true, task: { status: 'completed' } })
  })

  it('wait resolves when notifyChanged reports a terminal status', async () => {
    handler.tasks.set('t3', dto({ id: 't3', status: 'running' }))
    const pending = fetch(`${base}/v1/tasks/t3/wait?timeout=5`, { headers: auth }).then(r => r.json())
    await new Promise(r => setTimeout(r, 30))
    handler.tasks.set('t3', dto({ id: 't3', status: 'failed', error: 'boom' }))
    server.notifyChanged('t3')
    expect(await pending).toMatchObject({ done: true, task: { status: 'failed', error: 'boom' } })
  })

  it('wait times out with done=false, capped by maxWaitMs', async () => {
    handler.tasks.set('t4', dto({ id: 't4', status: 'running' }))
    const started = Date.now()
    const res = await fetch(`${base}/v1/tasks/t4/wait?timeout=100`, { headers: auth })
    expect(await res.json()).toMatchObject({ done: false, task: { status: 'running' } })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('cancels a task', async () => {
    handler.tasks.set('t5', dto({ id: 't5', status: 'queued' }))
    const res = await fetch(`${base}/v1/tasks/t5/cancel`, { method: 'POST', headers: auth })
    expect((await res.json()).task.status).toBe('cancelled')
  })

  it('falls back to another port when the preferred one is taken', async () => {
    const blocker = createServer()
    await new Promise<void>(r => blocker.listen(0, '127.0.0.1', () => r()))
    const taken = (blocker.address() as { port: number }).port
    const other = new ExternalApiServer({ handler, getToken: () => TOKEN, preferredPort: taken })
    const port = await other.start()
    expect(port).not.toBe(taken)
    await other.stop()
    await new Promise<void>(r => blocker.close(() => r()))
  })

  it('falls back to another port when the preferred one is in an excluded range (EACCES)', async () => {
    const spy = vi.spyOn(HttpServer.prototype, 'listen').mockImplementationOnce(function (this: HttpServer) {
      process.nextTick(() => this.emit('error', Object.assign(new Error('listen EACCES'), { code: 'EACCES' })))
      return this
    })
    const other = new ExternalApiServer({ handler, getToken: () => TOKEN, preferredPort: 3929 })
    try {
      const port = await other.start()
      expect(port).toBeGreaterThan(0)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy.mock.calls[1][0]).toBe(0)
    } finally {
      spy.mockRestore()
      await other.stop()
    }
  })
})
