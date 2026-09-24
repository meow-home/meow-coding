import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { ExternalApiServer, type ExternalApiHandler } from '../../src/main/external-api/server'
import type { CreateTaskBody, TaskDto } from '../../src/shared/external-api-types'

const CLI = path.resolve('resources/external-api/meow-delegate.mjs')
const TOKEN = 'b'.repeat(64)

function run(args: string[], retryMs = '300'): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, MEOW_DELEGATE_RETRY_MS: retryMs } })
    let out = ''
    let err = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('close', code => resolve({ code: code ?? -1, out, err }))
  })
}

class Handler implements ExternalApiHandler {
  final: Partial<TaskDto> = { status: 'completed', result: 'all good', touchedFiles: ['src/a.ts'] }
  bodies: CreateTaskBody[] = []
  task?: TaskDto
  version() { return '1' }
  async createTask(body: CreateTaskBody) {
    this.bodies.push(body)
    this.task = { id: 't1', status: 'running', sessionId: 's1', projectPath: '/p', planKey: 'k', createdAt: 1, touchedFiles: [] }
    setTimeout(() => { this.task = { ...this.task!, ...this.final }; onChange?.('t1') }, 50)
    return this.task
  }
  getTask(id: string) { return this.task?.id === id ? this.task : undefined }
  async cancelTask() { this.task = { ...this.task!, status: 'cancelled' }; return this.task }
}

let onChange: ((id: string) => void) | undefined

describe('meow-delegate CLI', () => {
  let dir: string
  let config: string
  let taskFile: string
  let handler: Handler
  let server: ExternalApiServer

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-cli-'))
    handler = new Handler()
    server = new ExternalApiServer({ handler, getToken: () => TOKEN, preferredPort: 0 })
    onChange = (id) => server.notifyChanged(id)
    const port = await server.start()
    config = path.join(dir, 'external-api.json')
    writeFileSync(config, JSON.stringify({ enabled: true, port, token: TOKEN, cliPath: CLI }))
    taskFile = path.join(dir, 'task.md')
    writeFileSync(taskFile, 'Implement task 1')
  })
  afterEach(async () => { await server.stop(); rmSync(dir, { recursive: true, force: true }) })

  it('start waits for completion, prints the result block, exits 0', async () => {
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'docs/plan.md', '--title', 'P', '--task-file', taskFile])
    expect(r.code).toBe(0)
    expect(r.out).toContain('=== MEOW TASK RESULT ===')
    expect(r.out).toContain('task: t1   session: s1   status: completed')
    expect(r.out).toContain('- src/a.ts')
    expect(r.out).toContain('--- final answer ---\nall good')
    expect(handler.bodies[0]).toEqual({ cwd: path.resolve(dir), planKey: 'docs/plan.md', title: 'P', task: 'Implement task 1' })
  })

  it('prints the task id before waiting so a killed CLI still leaves it', async () => {
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile])
    const early = r.out.indexOf('task: t1   session: s1   status: running')
    expect(early).toBeGreaterThanOrEqual(0)
    expect(early).toBeLessThan(r.out.indexOf('=== MEOW TASK RESULT ==='))
  })

  it('exits 5 and flags the status when the task stopped at the step limit', async () => {
    handler.final = { status: 'completed', endReason: 'max-steps', result: 'did half', touchedFiles: [] }
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile])
    expect(r.code).toBe(5)
    expect(r.out).toContain('status: completed (max steps reached)')
    expect(r.out).toContain('did half')
  })

  it('shows other end reasons in the status without a special exit code', async () => {
    handler.final = { status: 'completed', endReason: 'stuck', result: 'looping', touchedFiles: [] }
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile])
    expect(r.code).toBe(0)
    expect(r.out).toContain('status: completed (stuck)')
  })

  it('wait resumes waiting on an existing task', async () => {
    handler.task = { id: 't9', status: 'running', sessionId: 's1', projectPath: '/p', planKey: 'k', createdAt: 1, touchedFiles: [] }
    setTimeout(() => { handler.task = { ...handler.task!, status: 'completed', result: 'resumed ok' }; onChange?.('t9') }, 50)
    const r = await run(['wait', 't9', '--config', config])
    expect(r.code).toBe(0)
    expect(r.out).toContain('task: t9   session: s1   status: completed')
    expect(r.out).toContain('resumed ok')
  })

  it('wait rejects a missing or unknown task id', async () => {
    expect((await run(['wait', '--config', config])).code).toBe(4)
    expect((await run(['wait', 'nope', '--config', config])).code).toBe(4)
  })

  it('exits 1 on failure and prints the error', async () => {
    handler.final = { status: 'failed', error: 'boom', touchedFiles: [] }
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile])
    expect(r.code).toBe(1)
    expect(r.out).toContain('(none)')
    expect(r.out).toContain('boom')
  })

  it('exits 2 when cancelled', async () => {
    handler.final = { status: 'cancelled', touchedFiles: [] }
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile])
    expect(r.code).toBe(2)
  })

  it('send posts the session id and message', async () => {
    const r = await run(['send', '--config', config, '--session', 's1', '--message-file', taskFile])
    expect(r.code).toBe(0)
    expect(handler.bodies[0]).toMatchObject({ sessionId: 's1', task: 'Implement task 1' })
  })

  it('--no-wait prints the queued id and exits 0', async () => {
    const r = await run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile, '--no-wait'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('queued: t1   session: s1')
  })

  it('exits 3 when the feature is disabled', async () => {
    writeFileSync(config, JSON.stringify({ enabled: false, port: 1, token: TOKEN, cliPath: CLI }))
    const r = await run(['status', 't1', '--config', config])
    expect(r.code).toBe(3)
    expect(r.err).toContain('[meow] Meow is not running or external delegation is disabled.')
  })

  it('exits 3 when Meow is unreachable', async () => {
    await server.stop()
    const r = await run(['status', 't1', '--config', config])
    expect(r.code).toBe(3)
  })

  it('reloads the config while retrying, following Meow to a new port', async () => {
    const port = server.port
    const dead = createServer()
    await new Promise<void>(r => dead.listen(0, '127.0.0.1', () => r()))
    const deadPort = (dead.address() as { port: number }).port
    await new Promise<void>(r => dead.close(() => r()))
    writeFileSync(config, JSON.stringify({ enabled: true, port: deadPort, token: TOKEN, cliPath: CLI }))
    const pending = run(['start', '--config', config, '--cwd', dir, '--plan', 'p.md', '--task-file', taskFile], '10000')
    await new Promise(r => setTimeout(r, 300))
    writeFileSync(config, JSON.stringify({ enabled: true, port, token: TOKEN, cliPath: CLI }))
    const r = await pending
    expect(r.code).toBe(0)
    expect(r.out).toContain('status: completed')
  })

  it('exits 3 on a wrong token', async () => {
    const port = (await server.stop(), await server.start())
    writeFileSync(config, JSON.stringify({ enabled: true, port, token: 'c'.repeat(64), cliPath: CLI }))
    const r = await run(['status', 't1', '--config', config])
    expect(r.code).toBe(3)
  })

  it('exits 4 on bad arguments or an unknown task', async () => {
    expect((await run(['start', '--config', config])).code).toBe(4)
    expect((await run(['bogus', '--config', config])).code).toBe(4)
    expect((await run(['status', 'nope', '--config', config])).code).toBe(4)
  })
})
