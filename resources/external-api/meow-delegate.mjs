#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXIT = { ok: 0, failed: 1, cancelled: 2, unreachable: 3, invalid: 4 }
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const RETRY_MS = Number(process.env.MEOW_DELEGATE_RETRY_MS ?? 30_000)
const UNREACHABLE = '[meow] Meow is not running or external delegation is disabled.'

class CliError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--no-wait') flags.noWait = true
    else if (a.startsWith('--')) {
      const value = rest[i + 1]
      if (value === undefined || value.startsWith('--')) throw new CliError(EXIT.invalid, `[meow] Missing value for ${a}`)
      flags[a.slice(2)] = value
      i++
    } else positional.push(a)
  }
  return { command, flags, positional }
}

function need(flags, name) {
  if (!flags[name]) throw new CliError(EXIT.invalid, `[meow] Missing required --${name}`)
  return flags[name]
}

function readText(file) {
  try { return readFileSync(file, 'utf8') } catch { throw new CliError(EXIT.invalid, `[meow] Cannot read file: ${file}`) }
}

function loadConfig(flags) {
  const file = flags.config ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'external-api.json')
  let cfg
  try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new CliError(EXIT.unreachable, UNREACHABLE) }
  if (!cfg.enabled || !cfg.port || !cfg.token) throw new CliError(EXIT.unreachable, UNREACHABLE)
  return { ...cfg, flags }
}

// Meow may restart on another port or regenerate its token while a CLI call is
// in flight; refresh in place so later requests (the /wait loop) follow it.
function reloadConfig(cfg) {
  const before = `${cfg.port}:${cfg.token}`
  try { Object.assign(cfg, loadConfig(cfg.flags)) } catch { /* keep the last good values */ }
  return `${cfg.port}:${cfg.token}` !== before
}

async function request(cfg, method, route, body) {
  const deadline = Date.now() + RETRY_MS
  let reloadedOnAuth = false
  for (;;) {
    let res
    try {
      res = await fetch(`http://127.0.0.1:${cfg.port}${route}`, {
        method,
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      })
    } catch {
      if (Date.now() >= deadline) throw new CliError(EXIT.unreachable, UNREACHABLE)
      await new Promise(r => setTimeout(r, Math.min(1000, RETRY_MS)))
      reloadConfig(cfg)
      continue
    }
    const json = await res.json().catch(() => ({}))
    if (res.status === 401 && !reloadedOnAuth) {
      reloadedOnAuth = true
      if (reloadConfig(cfg)) continue
    }
    if (res.status === 401 || res.status === 403) throw new CliError(EXIT.unreachable, `${UNREACHABLE} (${json.error ?? res.status})`)
    if (res.status >= 400) throw new CliError(EXIT.invalid, json.error ?? `[meow] HTTP ${res.status}`)
    return json
  }
}

async function waitFor(cfg, id) {
  for (;;) {
    const { done, task } = await request(cfg, 'GET', `/v1/tasks/${encodeURIComponent(id)}/wait?timeout=120`)
    if (done || TERMINAL.has(task.status)) return task
  }
}

function printResult(task) {
  const files = task.touchedFiles?.length ? task.touchedFiles.map(f => `- ${f}`).join('\n') : '(none)'
  const answer = task.result ?? task.error ?? '(no output)'
  process.stdout.write(
    `=== MEOW TASK RESULT ===\n` +
    `task: ${task.id}   session: ${task.sessionId}   status: ${task.status}\n` +
    `touched_files:\n${files}\n` +
    `--- final answer ---\n${answer}\n`
  )
  if (task.status === 'completed') return EXIT.ok
  if (task.status === 'cancelled') return EXIT.cancelled
  return TERMINAL.has(task.status) ? EXIT.failed : EXIT.ok
}

async function submit(cfg, body, flags) {
  const { task } = await request(cfg, 'POST', '/v1/tasks', body)
  if (flags.noWait) {
    process.stdout.write(`queued: ${task.id}   session: ${task.sessionId}\n`)
    return EXIT.ok
  }
  return printResult(await waitFor(cfg, task.id))
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'start': {
      const cwd = path.resolve(need(flags, 'cwd'))
      const planKey = need(flags, 'plan')
      const task = readText(need(flags, 'task-file'))
      const cfg = loadConfig(flags)
      return submit(cfg, { cwd, planKey, task, ...(flags.title ? { title: flags.title } : {}) }, flags)
    }
    case 'send': {
      const sessionId = need(flags, 'session')
      const task = readText(need(flags, 'message-file'))
      const cfg = loadConfig(flags)
      return submit(cfg, { cwd: process.cwd(), planKey: '', sessionId, task }, flags)
    }
    case 'status': {
      if (!positional[0]) throw new CliError(EXIT.invalid, '[meow] Usage: status <taskId>')
      const cfg = loadConfig(flags)
      const { task } = await request(cfg, 'GET', `/v1/tasks/${encodeURIComponent(positional[0])}`)
      if (!TERMINAL.has(task.status)) {
        process.stdout.write(`task: ${task.id}   session: ${task.sessionId}   status: ${task.status}\n`)
        return EXIT.ok
      }
      return printResult(task)
    }
    case 'cancel': {
      if (!positional[0]) throw new CliError(EXIT.invalid, '[meow] Usage: cancel <taskId>')
      const cfg = loadConfig(flags)
      const { task } = await request(cfg, 'POST', `/v1/tasks/${encodeURIComponent(positional[0])}/cancel`)
      process.stdout.write(`task: ${task.id}   status: ${task.status}\n`)
      return EXIT.ok
    }
    default:
      throw new CliError(EXIT.invalid, '[meow] Usage: meow-delegate <start|send|status|cancel> ...')
  }
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(`${err.message}\n`)
    process.exit(err instanceof CliError ? err.code : EXIT.failed)
  }
)
