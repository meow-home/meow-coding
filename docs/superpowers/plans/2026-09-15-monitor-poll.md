# Monitor Poll-a-Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `monitor` tool poll a short command on an interval (besides watching a background shell by id) and wake the agent when the command succeeds, its output matches a regex, or a timeout elapses.

**Architecture:** A new `PollMonitorStore` spawns the command on a timer and resolves through the same `MonitorResolveInfo` + `handleMonitorResolve` path as shell-watch monitors (append message, notify, auto-wake). The `monitor` tool dispatches on `id` vs `command`; the manager owns the poll store and merges it into `monitorsList`.

**Tech Stack:** TypeScript, Node `child_process` + `tree-kill`, Electron main, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-monitor-poll-design.md`

## Global Constraints

- Poll mode does NOT touch `BackgroundProcessStore` or `MonitorStore`; it is a separate store.
- Reuse `buildShellCommand` (Git Bash on Windows) for each poll; each poll is tree-killed at a per-poll timeout so the interval never stalls.
- Reuse `MonitorResolveInfo` / `handleMonitorResolve`; distinguish poll vs shell via a `kind` field so the resolve message omits the `bash_output` hint for polls.
- Defaults: interval 5s (min 1s); max 10 poll monitors per agent; detail capped at 500 chars. No persistence.
- Tests live under `tests/unit/*.test.ts` (Vitest); mock `ToolContext` as a plain object literal.

## How to apply this plan (no inference required)

- Every **"Create"** step gives the file's full contents — write it verbatim.
- Every **"Modify"** step is a set of exact **FIND → REPLACE** edits. The `FIND` block exists verbatim in the current source; locate it and swap in the `REPLACE` block. Do not hand-merge.
- Line numbers in prose are **hints as of 2026-09-15 only** — match by the verbatim `FIND` text. If a `FIND` block does not match, re-read the file and re-locate the anchor.
- Run the exact command at each "Run:" step and confirm the Expected result. Commit at the end of each task with the message given.

---

### Task 1: Extend `MonitorResolveInfo` with `kind` + `succeeded`

**Files:**
- Modify: `src/main/agent/monitor-store.ts`
- Test: `tests/unit/monitor-store.test.ts`

**Interfaces:**
- Produces: `MonitorReason` gains `'succeeded'`; `MonitorResolveInfo` gains `kind: 'shell' | 'poll'`; `monitorResolveMessage` omits the `bash_output` hint when `kind === 'poll'`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/monitor-store.test.ts`, inside `describe('handleMonitorResolve', ...)` before its closing `})`:

```ts
  it('poll-kind message omits the bash_output hint; shell-kind keeps it', () => {
    const shellMsg = monitorResolveMessage({ ...info, kind: 'shell' })
    expect(shellMsg).toContain('bash_output')
    const pollMsg = monitorResolveMessage({
      id: 'm2', agentId: 'a1', sessionId: 's9', targetId: 'curl -sf localhost:3000',
      reason: 'succeeded', detail: 'exit code 0', kind: 'poll'
    })
    expect(pollMsg).toContain('curl -sf localhost:3000')
    expect(pollMsg).toContain('succeeded')
    expect(pollMsg).not.toContain('bash_output')
  })
```

> The existing `info` constant in that describe block does not set `kind`; Step 3 makes `kind` required, so also update that constant — see Step 3's second edit to the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/monitor-store.test.ts -t "omits the bash_output"`
Expected: FAIL — `monitorResolveMessage` still appends the hint / TS type error on `kind`.

- [ ] **Step 3: Implement**

Three exact edits in `src/main/agent/monitor-store.ts`.

**Edit 1 — extend `MonitorReason`.** FIND:
```ts
export type MonitorReason = 'matched' | 'exited' | 'timeout'
```
REPLACE:
```ts
export type MonitorReason = 'matched' | 'exited' | 'timeout' | 'succeeded'
```

**Edit 2 — add `kind` to `MonitorResolveInfo`.** FIND:
```ts
export interface MonitorResolveInfo {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  reason: MonitorReason
  detail: string
}
```
REPLACE:
```ts
export interface MonitorResolveInfo {
  id: string
  agentId: string
  sessionId: string
  targetId: string
  reason: MonitorReason
  detail: string
  // 'shell' = watching a background shell (targetId is a shell id);
  // 'poll'  = polling a command (targetId is the command string).
  kind: 'shell' | 'poll'
}
```

**Edit 3 — set `kind: 'shell'` in `MonitorStore.resolve`.** FIND:
```ts
    this.opts.onResolve({
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.targetId, reason, detail
    })
```
REPLACE:
```ts
    this.opts.onResolve({
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.targetId, reason, detail, kind: 'shell'
    })
```

**Edit 4 — branch `monitorResolveMessage` on `kind`.** FIND:
```ts
export function monitorResolveMessage(info: MonitorResolveInfo): string {
  const head = info.reason === 'matched' ? `matched: ${info.detail}`
    : info.reason === 'exited' ? `shell exited (${info.detail})`
    : `timed out after ${info.detail}`
  return `[monitor ${info.id}] shell ${info.targetId} — ${head}. ` +
    `Read output with bash_output({ id: "${info.targetId}" }).`
}
```
REPLACE:
```ts
export function monitorResolveMessage(info: MonitorResolveInfo): string {
  const head = info.reason === 'matched' ? `matched: ${info.detail}`
    : info.reason === 'exited' ? `shell exited (${info.detail})`
    : info.reason === 'succeeded' ? `command succeeded (${info.detail})`
    : `timed out after ${info.detail}`
  if (info.kind === 'poll') {
    return `[monitor ${info.id}] command \`${info.targetId}\` — ${head}.`
  }
  return `[monitor ${info.id}] shell ${info.targetId} — ${head}. ` +
    `Read output with bash_output({ id: "${info.targetId}" }).`
}
```

**Edit 5 — the existing test's `info` constant** in `tests/unit/monitor-store.test.ts` now needs `kind`. FIND:
```ts
  const info: MonitorResolveInfo = { id: 'm1', agentId: 'a1', sessionId: 's9', targetId: 'bg1', reason: 'matched', detail: 'Local: http://x' }
```
REPLACE:
```ts
  const info: MonitorResolveInfo = { id: 'm1', agentId: 'a1', sessionId: 's9', targetId: 'bg1', reason: 'matched', detail: 'Local: http://x', kind: 'shell' }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/monitor-store.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/monitor-store.ts tests/unit/monitor-store.test.ts
git commit -m "feat(agent): add poll monitor kind and succeeded reason to MonitorResolveInfo"
```

---

### Task 2: `PollMonitorStore`

**Files:**
- Create: `src/main/agent/poll-monitor-store.ts`
- Test: `tests/unit/poll-monitor-store.test.ts`

**Interfaces:**
- Consumes: `MonitorResolveInfo` (Task 1); `buildShellCommand`.
- Produces:
  - `interface PollMonitorStartOpts { untilRegex?: string; untilExit?: boolean | number; intervalMs?: number; timeoutMs?: number }`
  - `interface PollMonitorStoreOpts { getSessionId: (agentId: string) => string; onResolve: (info: MonitorResolveInfo) => void; maxPerAgent?: number }`
  - `class PollMonitorStore` with `start(agentId, command, cwd, opts): { id: string } | { error: string }`, `count(agentId)`, `list(agentId): { id: string; targetId: string; until: string }[]`, `cancelAllForAgent(agentId)`, `cancelAll()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/poll-monitor-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PollMonitorStore } from '../../src/main/agent/poll-monitor-store'
import type { MonitorResolveInfo } from '../../src/main/agent/monitor-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-poll-'))

function makeStore(maxPerAgent?: number) {
  const resolved: MonitorResolveInfo[] = []
  const store = new PollMonitorStore({ getSessionId: () => 's', onResolve: (i) => resolved.push(i), maxPerAgent })
  return { store, resolved }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 40)) }
}

describe('PollMonitorStore', () => {
  it('resolves succeeded when the command exits 0 (default condition)', async () => {
    const { store, resolved } = makeStore()
    const r = store.start('a1', 'exit 0', dir, { intervalMs: 1000 })
    expect('id' in r).toBe(true)
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('succeeded')
    expect(resolved[0].kind).toBe('poll')
    expect(resolved[0].targetId).toBe('exit 0')
  }, 20000)

  it('resolves succeeded only on a specific exit code', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'exit 7', dir, { untilExit: 7, intervalMs: 1000 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('succeeded')
    expect(resolved[0].detail).toContain('7')
  }, 20000)

  it('resolves matched when output matches the regex', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'echo READY_TO_GO; exit 1', dir, { untilRegex: 'READY_TO_GO', intervalMs: 1000 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('matched')
    expect(resolved[0].detail).toContain('READY_TO_GO')
  }, 20000)

  it('resolves timeout when nothing satisfies in time', async () => {
    const { store, resolved } = makeStore()
    store.start('a1', 'exit 1', dir, { untilExit: 0, intervalMs: 1000, timeoutMs: 400 })
    await waitFor(() => resolved.length === 1)
    expect(resolved[0].reason).toBe('timeout')
  }, 20000)

  it('errors on invalid regex and enforces the per-agent limit', () => {
    const { store } = makeStore(2)
    expect('error' in store.start('a1', 'exit 1', dir, { untilRegex: '(' })).toBe(true)
    store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })
    store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })
    expect('error' in store.start('a1', 'sleep 5', dir, { intervalMs: 2000 })).toBe(true)
    store.cancelAllForAgent('a1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/poll-monitor-store.test.ts`
Expected: FAIL — module `poll-monitor-store` not found.

- [ ] **Step 3: Implement `PollMonitorStore`**

Create `src/main/agent/poll-monitor-store.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import kill from 'tree-kill'
import { buildShellCommand } from './tools/bash'
import type { MonitorResolveInfo } from './monitor-store'

export interface PollMonitorStartOpts {
  untilRegex?: string
  untilExit?: boolean | number
  intervalMs?: number
  timeoutMs?: number
}

export interface PollMonitorStoreOpts {
  getSessionId: (agentId: string) => string
  onResolve: (info: MonitorResolveInfo) => void
  maxPerAgent?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  command: string
  cwd: string
  untilRegex?: RegExp
  checkExit: boolean
  untilCode: number
  until: string
  status: 'watching' | 'resolved'
  polling: boolean
  timer?: ReturnType<typeof setInterval>
  timeoutTimer?: ReturnType<typeof setTimeout>
}

const DEFAULT_MAX_PER_AGENT = 10
const DEFAULT_INTERVAL_MS = 5000
const MIN_INTERVAL_MS = 1000
const DETAIL_CAP = 500
const MAX_OUTPUT = 64 * 1024
const POLL_KILL_MS = 30_000

export class PollMonitorStore {
  private entries = new Map<string, Entry>()

  constructor(private opts: PollMonitorStoreOpts) {}

  private get maxPerAgent(): number { return this.opts.maxPerAgent ?? DEFAULT_MAX_PER_AGENT }

  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'watching') n++
    return n
  }

  list(agentId: string): { id: string; targetId: string; until: string }[] {
    const out: { id: string; targetId: string; until: string }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'watching') out.push({ id: e.id, targetId: e.command, until: e.until })
    }
    return out
  }

  start(agentId: string, command: string, cwd: string, opts: PollMonitorStartOpts): { id: string } | { error: string } {
    if (!command || typeof command !== 'string') return { error: 'monitor: missing command' }
    let untilRegex: RegExp | undefined
    if (opts.untilRegex !== undefined) {
      try { untilRegex = new RegExp(opts.untilRegex) } catch { return { error: 'monitor: invalid until_regex' } }
    }
    let checkExit = false
    let untilCode = 0
    if (opts.untilExit !== undefined) {
      checkExit = true
      untilCode = typeof opts.untilExit === 'number' ? opts.untilExit : 0
    }
    // Default when no condition is given: poll until the command succeeds.
    if (!untilRegex && !checkExit) checkExit = true
    if (this.count(agentId) >= this.maxPerAgent) {
      return { error: `monitor: too many monitors (max ${this.maxPerAgent})` }
    }
    const intervalMs = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS)
    const id = randomUUID().slice(0, 8)
    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      checkExit ? `exit ${untilCode}` : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')
    const entry: Entry = {
      id, agentId, sessionId: this.opts.getSessionId(agentId), command, cwd,
      untilRegex, checkExit, untilCode, until, status: 'watching', polling: false
    }
    entry.timer = setInterval(() => this.poll(entry), intervalMs)
    entry.timer.unref?.()
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const ms = opts.timeoutMs
      entry.timeoutTimer = setTimeout(() => this.resolve(entry, 'timeout', `${Math.round(ms / 1000)}s`), ms)
      entry.timeoutTimer.unref?.()
    }
    this.entries.set(id, entry)
    this.poll(entry) // immediate first poll
    return { id }
  }

  private poll(entry: Entry): void {
    if (entry.status !== 'watching' || entry.polling) return
    entry.polling = true
    const dir = existsSync(entry.cwd) ? entry.cwd : homedir()
    const resolved = buildShellCommand(entry.command, dir)
    const child = spawn(resolved.command, resolved.args, {
      cwd: dir,
      env: process.env as Record<string, string>,
      windowsHide: true,
      windowsVerbatimArguments: resolved.verbatim ?? false
    })
    let out = ''
    child.stdout?.on('data', d => { if (out.length < MAX_OUTPUT) out += d.toString() })
    child.stderr?.on('data', d => { if (out.length < MAX_OUTPUT) out += d.toString() })
    const killTimer = setTimeout(() => { if (child.pid) { try { kill(child.pid) } catch { /* dead */ } } }, POLL_KILL_MS)
    killTimer.unref?.()
    child.on('error', () => { clearTimeout(killTimer); entry.polling = false })
    child.on('close', (code) => {
      clearTimeout(killTimer)
      entry.polling = false
      if (entry.status !== 'watching') return
      if (entry.untilRegex) {
        for (const line of out.split('\n')) {
          if (entry.untilRegex.test(line)) { this.resolve(entry, 'matched', line.trim().slice(0, DETAIL_CAP)); return }
        }
      }
      if (entry.checkExit && code === entry.untilCode) {
        this.resolve(entry, 'succeeded', `exit code ${code}`)
      }
    })
  }

  private resolve(entry: Entry, reason: 'matched' | 'succeeded' | 'timeout', detail: string): void {
    if (entry.status !== 'watching') return
    this.teardown(entry)
    this.opts.onResolve({
      id: entry.id, agentId: entry.agentId, sessionId: entry.sessionId,
      targetId: entry.command, reason, detail, kind: 'poll'
    })
  }

  private teardown(entry: Entry): void {
    entry.status = 'resolved'
    if (entry.timer) clearInterval(entry.timer)
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
    this.entries.delete(entry.id)
  }

  cancelAllForAgent(agentId: string): void {
    for (const e of [...this.entries.values()]) if (e.agentId === agentId) this.teardown(e)
  }

  cancelAll(): void {
    for (const e of [...this.entries.values()]) this.teardown(e)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/poll-monitor-store.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/poll-monitor-store.ts tests/unit/poll-monitor-store.test.ts
git commit -m "feat(agent): add PollMonitorStore for interval command polling"
```

---

### Task 3: Merge poll mode into the `monitor` tool

**Files:**
- Modify: `src/main/agent/tools/types.ts`
- Modify: `src/main/agent/tools/monitor.ts`
- Test: `tests/unit/agent-tools-monitor.test.ts`

**Interfaces:**
- Consumes: `PollMonitorStore` (Task 2), `MonitorStore` (existing).
- Produces: `ToolContext.pollMonitors?: PollMonitorStore`; `monitor` accepts `id` XOR `command`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agent-tools-monitor.test.ts`, before the final `})` of `describe('monitor tool', ...)`:

```ts
  it('command mode returns immediately with a monitor id', async () => {
    const { PollMonitorStore } = await import('../../src/main/agent/poll-monitor-store')
    const pollMonitors = new PollMonitorStore({ getSessionId: () => 'sess-1', onResolve: () => {} })
    const c = { cwd: dir, ask: async () => null, agentId: 'a1', pollMonitors } as unknown as import('../../src/main/agent/tools/types').ToolContext
    const r = await monitorTool.run({ command: 'exit 1', until_regex: 'never', timeout_s: 1 }, c)
    expect(r.background).toBe(true)
    expect(r.output).toMatch(/monitor [0-9a-f]{8}/)
    pollMonitors.cancelAllForAgent('a1')
  }, 20000)

  it('errors when neither id nor command (and when both) are given', async () => {
    const { ctx: c } = ctx()
    const none = await monitorTool.run({}, c)
    expect(none.error).toMatch(/exactly one/)
    const both = await monitorTool.run({ id: 'x', command: 'y' }, c)
    expect(both.error).toMatch(/exactly one/)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/agent-tools-monitor.test.ts -t "command mode"`
Expected: FAIL — `command` is ignored / no `exactly one` error.

- [ ] **Step 3a: Add `pollMonitors` to `ToolContext`**

Two exact edits in `src/main/agent/tools/types.ts`.

**Edit 1 — import.** FIND:
```ts
import type { MonitorStore } from '../monitor-store'
```
REPLACE:
```ts
import type { MonitorStore } from '../monitor-store'
import type { PollMonitorStore } from '../poll-monitor-store'
```

**Edit 2 — field** (after `monitors`). FIND:
```ts
  // Async watches over background shells (monitor tool).
  monitors?: MonitorStore
}
```
REPLACE:
```ts
  // Async watches over background shells (monitor tool).
  monitors?: MonitorStore
  // Interval polling of a command (monitor tool, command mode).
  pollMonitors?: PollMonitorStore
}
```

- [ ] **Step 3b: Rewrite the `monitor` tool for dispatch**

Replace the whole `src/main/agent/tools/monitor.ts` with:

```ts
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface MonitorInput {
  id?: string
  command?: string
  until_regex?: string
  until_exit?: boolean | number
  interval_s?: number
  timeout_s?: number
}

export const monitorTool: ToolDefinition = {
  name: 'monitor',
  description:
    'Wait for a condition without blocking. Watch a background shell by id, OR poll a command periodically. ' +
    'Resolves when a regex matches output (until_regex), the shell exits / a poll succeeds (until_exit; poll defaults to exit 0), ' +
    'or a timeout elapses (timeout_s). Returns immediately; you are notified in the feed when it resolves. ' +
    'Use monitor to wait (e.g. until a server is ready or a command succeeds) instead of polling with bash_output in a loop. ' +
    'Provide exactly one of id or command.',
  schema: z.object({
    id: z.string().optional().describe('Watch this background shell (from bash run_in_background).'),
    command: z.string().optional().describe('Poll this shell command on an interval instead of watching a shell.'),
    until_regex: z.string().optional().describe('Resolve when output matches this regex.'),
    until_exit: z.union([z.boolean(), z.number()]).optional()
      .describe('id: resolve when the shell exits (number = expected code). command: resolve when a poll exits with this code (default 0).'),
    interval_s: z.number().optional().describe('command mode only: seconds between polls (default 5, min 1).'),
    timeout_s: z.number().optional().describe('Resolve as "timeout" after this many seconds if nothing else matched.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id, command, until_regex, until_exit, interval_s, timeout_s } = input as unknown as MonitorInput
    if (!ctx.agentId) return { error: 'monitor: not available in this context' }
    if ((id && command) || (!id && !command)) return { error: 'monitor: provide exactly one of id or command' }
    const timeoutMs = timeout_s !== undefined ? Math.round(timeout_s * 1000) : undefined

    if (command) {
      if (!ctx.pollMonitors) return { error: 'monitor: not available in this context' }
      const res = ctx.pollMonitors.start(ctx.agentId, command, ctx.cwd, {
        untilRegex: until_regex,
        untilExit: until_exit,
        intervalMs: interval_s !== undefined ? Math.round(interval_s * 1000) : undefined,
        timeoutMs
      })
      if ('error' in res) return { error: res.error }
      const conds = [
        until_regex ? `output matches /${until_regex}/` : null,
        (until_exit === undefined || until_exit !== false) ? 'the command succeeds' : null,
        timeout_s ? `${timeout_s}s pass` : null
      ].filter(Boolean).join(' or ')
      return { output: `Polling \`${command}\`; you'll be woken when ${conds}. (monitor ${res.id})`, background: true }
    }

    if (!ctx.monitors) return { error: 'monitor: not available in this context' }
    const res = ctx.monitors.start(ctx.agentId, id!, {
      untilRegex: until_regex,
      untilExit: until_exit,
      timeoutMs
    })
    if ('error' in res) return { error: res.error }
    const conds = [
      until_regex ? `output matches /${until_regex}/` : null,
      until_exit !== undefined ? 'it exits' : null,
      timeout_s ? `${timeout_s}s pass` : null
    ].filter(Boolean).join(' or ')
    return { output: `Monitoring shell ${id}; you'll be woken when ${conds}. (monitor ${res.id})`, background: true }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-tools-monitor.test.ts`
Expected: PASS (existing id-mode tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/types.ts src/main/agent/tools/monitor.ts tests/unit/agent-tools-monitor.test.ts
git commit -m "feat(agent): monitor tool polls a command in command mode (id XOR command)"
```

---

### Task 4: Wire `PollMonitorStore` through the loop and manager

**Files:**
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/meow-agent-manager.ts`

**Interfaces:**
- Consumes: `PollMonitorStore` (Task 2); the manager's existing `onMonitorResolve` (reused for poll resolutions).
- Produces: `LoopDeps.pollMonitors?`; the manager owns a `PollMonitorStore` and merges it into `monitorsList`.

- [ ] **Step 1: Wire through the loop**

Three exact edits in `src/main/agent/loop.ts`.

**Edit 1 — import.** FIND:
```ts
import type { MonitorStore } from './monitor-store'
```
REPLACE:
```ts
import type { MonitorStore } from './monitor-store'
import type { PollMonitorStore } from './poll-monitor-store'
```

**Edit 2 — `LoopDeps` field.** FIND:
```ts
  monitors?: MonitorStore
```
REPLACE:
```ts
  monitors?: MonitorStore
  pollMonitors?: PollMonitorStore
```

**Edit 3 — pass into `toolCtx`.** FIND:
```ts
          monitors: this.deps.monitors
```
REPLACE:
```ts
          monitors: this.deps.monitors,
          pollMonitors: this.deps.pollMonitors
```

- [ ] **Step 2: Own the store and merge the list in the manager**

Five exact edits in `src/main/meow-agent-manager.ts`.

**Edit 1 — import.** FIND:
```ts
import { MonitorStore, handleMonitorResolve, type MonitorResolveInfo } from './agent/monitor-store'
```
REPLACE:
```ts
import { MonitorStore, handleMonitorResolve, type MonitorResolveInfo } from './agent/monitor-store'
import { PollMonitorStore } from './agent/poll-monitor-store'
```

**Edit 2 — the store field** (after the `monitors` field). FIND:
```ts
  private monitors = new MonitorStore({
    procs: this.backgroundProcs,
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onResolve: (info) => this.onMonitorResolve(info)
  })
```
REPLACE:
```ts
  private monitors = new MonitorStore({
    procs: this.backgroundProcs,
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onResolve: (info) => this.onMonitorResolve(info)
  })
  private pollMonitors = new PollMonitorStore({
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onResolve: (info) => this.onMonitorResolve(info)
  })
```

**Edit 3 — merge `monitorsList`.** FIND:
```ts
  monitorsList(agentId: string): { id: string; targetId: string; until: string }[] {
    return this.monitors.list(agentId)
  }
```
REPLACE:
```ts
  monitorsList(agentId: string): { id: string; targetId: string; until: string }[] {
    return [...this.monitors.list(agentId), ...this.pollMonitors.list(agentId)]
  }
```

**Edit 4 — pass the store into the `SessionRunner`** (after the `monitors` dep). FIND:
```ts
      monitors: this.monitors,
```
REPLACE:
```ts
      monitors: this.monitors,
      pollMonitors: this.pollMonitors,
```

**Edit 5 — cleanup on stop and dispose.** First, in `stop(agentId)`. FIND:
```ts
    this.monitors.cancelAllForAgent(agentId)
```
REPLACE:
```ts
    this.monitors.cancelAllForAgent(agentId)
    this.pollMonitors.cancelAllForAgent(agentId)
```
Then, in `dispose()`. FIND:
```ts
    this.monitors.cancelAll()
```
REPLACE:
```ts
    this.monitors.cancelAll()
    this.pollMonitors.cancelAll()
```

- [ ] **Step 3: Verify the whole suite and types**

Run: `npx vitest run` then `npm run typecheck`
Expected: all tests PASS; typecheck clean. (`pollMonitors` is optional on `LoopDeps`/`ToolContext`, so the subagent runner still compiles.)

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/loop.ts src/main/meow-agent-manager.ts
git commit -m "feat(agent): wire PollMonitorStore into loop and manager; merge into monitorsList"
```

---

## Self-Review

**1. Spec coverage:**
- Merged tool schema, id XOR command, poll defaults to exit 0 (spec §1) → Task 3. ✓
- `PollMonitorStore` with succeeded/matched/timeout, per-poll kill, limits (spec §2) → Task 2. ✓
- Tool dispatch + `ToolContext.pollMonitors` (spec §3) → Task 3. ✓
- Manager owns store, reuses `onMonitorResolve`, merges `monitorsList` (spec §4) → Task 4. ✓
- Resolve message omits `bash_output` for poll via `kind` (spec §5) → Task 1. ✓
- Lifecycle: cancel on resolve/timeout and stop/dispose; unref timers (spec §6) → Task 2 + Task 4 Edit 5. ✓
- Testing (spec §7) → Tasks 1–3 tests. ✓

**2. Placeholder scan:** No `TBD`/`TODO`; every code step has real code; the new store is complete.

**3. Type consistency:** `MonitorResolveInfo.kind` (`'shell' | 'poll'`) and `MonitorReason` (+`'succeeded'`) are set in `MonitorStore.resolve` (shell) and `PollMonitorStore.resolve` (poll) and consumed in `monitorResolveMessage`. `PollMonitorStore.start(agentId, command, cwd, opts)` matches the tool call and the manager owns it with `{ getSessionId, onResolve }`. `pollMonitors` threads `ToolContext` → `LoopDeps` → `toolCtx` → manager `SessionRunner` consistently. `list()` returns `{ id, targetId, until }` in both stores, so `monitorsList` concatenation is type-consistent.
```
