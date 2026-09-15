# Background Bash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the native Meow agent run long-lived shell commands in the background — starting them without blocking a turn, reading their incremental output, killing them, and being notified/woken when they exit.

**Architecture:** A single in-memory `BackgroundProcessStore` (owned by `MeowAgentManager`) spawns piped `child_process` shells via the existing `buildShellCommand` (Git Bash on Windows) and keeps a per-process ring buffer. The `bash` tool gains a `run_in_background` flag; two new tools `bash_output` and `kill_shell` read and stop processes through `ctx.backgroundProcs`. On exit, a small pure handler appends a message to the originating session, fires a desktop notification, and — only if the agent is idle — enqueues a nudge and drains the queue to wake it.

**Tech Stack:** TypeScript, Node `child_process` + `tree-kill`, Electron main process, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-background-bash-design.md`

## Global Constraints

- Reuse `buildShellCommand(command, cwd)` from `src/main/agent/tools/bash.ts` for spawning — do NOT reimplement shell selection.
- Kill via `tree-kill` (already a dependency) — kill the whole process tree, never a bare `child.kill()`.
- No persistence across app restart. No new `ChatEvent` types and no renderer changes (surface completion by appending a normal assistant message + existing `NotificationService`).
- Defaults: max **10** running background processes per agent; ring buffer **256 KB** and **2000 lines** (whichever trims first).
- Tools reach the store only through `ToolContext.backgroundProcs`, never through the manager directly.
- Tests live under `tests/unit/*.test.ts` (Vitest, `include: ['tests/**/*.test.ts']`). Mock `ToolContext` as a plain object literal, following `tests/unit/agent-tools-bash.test.ts`.

---

### Task 1: `BackgroundProcessStore`

**Files:**
- Create: `src/main/agent/background-process-store.ts`
- Test: `tests/unit/background-process-store.test.ts`

**Interfaces:**
- Consumes: `buildShellCommand` from `src/main/agent/tools/bash.ts`; `tree-kill`.
- Produces:
  - `interface BgExitInfo { id: string; agentId: string; sessionId: string; command: string; exitCode: number | null }`
  - `interface BackgroundProcessStoreOpts { getSessionId: (agentId: string) => string; onExit: (info: BgExitInfo) => void; maxPerAgent?: number; maxBufferBytes?: number; maxBufferLines?: number }`
  - `class BackgroundProcessStore` with:
    - `start(agentId: string, command: string, cwd: string): { id: string } | { error: string }`
    - `readNew(id: string, filter?: string): { text: string; status: 'running' | 'exited'; exitCode: number | null } | { error: string }`
    - `kill(id: string): { killed: boolean } | { error: string }`
    - `count(agentId: string): number`
    - `killAllForAgent(agentId: string): void`
    - `killAll(): void`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/background-process-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore, type BgExitInfo } from '../../src/main/agent/background-process-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bg-'))

function makeStore(over: Partial<ConstructorParameters<typeof BackgroundProcessStore>[0]> = {}) {
  const exits: BgExitInfo[] = []
  const store = new BackgroundProcessStore({
    getSessionId: () => 'sess-1',
    onExit: (i) => exits.push(i),
    ...over
  })
  return { store, exits }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('BackgroundProcessStore', () => {
  it('captures output and advances the read offset', async () => {
    const { store } = makeStore()
    const r = store.start('a1', 'echo BG_MARKER', dir)
    expect('id' in r).toBe(true)
    const id = (r as { id: string }).id
    await waitFor(() => {
      const out = store.readNew(id)
      return 'text' in out && out.text.includes('BG_MARKER')
    })
  }, 20000)

  it('fires onExit with the captured sessionId and exit code', async () => {
    const { store, exits } = makeStore({ getSessionId: () => 'sess-42' })
    const r = store.start('a1', process.platform === 'win32' ? 'exit 2' : 'exit 2', dir) as { id: string }
    await waitFor(() => exits.length === 1)
    expect(exits[0].sessionId).toBe('sess-42')
    expect(exits[0].exitCode).toBe(2)
    expect(exits[0].id).toBe(r.id)
  }, 20000)

  it('enforces the per-agent limit', () => {
    const { store } = makeStore({ maxPerAgent: 2 })
    const cmd = process.platform === 'win32' ? 'ping -n 20 127.0.0.1' : 'sleep 20'
    store.start('a1', cmd, dir)
    store.start('a1', cmd, dir)
    const third = store.start('a1', cmd, dir)
    expect('error' in third).toBe(true)
    store.killAllForAgent('a1')
  })

  it('filters output lines by regex', async () => {
    const { store } = makeStore()
    const cmd = 'printf "alpha\\nbeta\\ngamma\\n"'
    const r = store.start('a1', cmd, dir) as { id: string }
    await waitFor(() => {
      const out = store.readNew(r.id, 'beta')
      return 'text' in out && out.text.includes('beta') && !out.text.includes('alpha')
    })
  }, 20000)

  it('trims the buffer and marks truncation', async () => {
    const { store } = makeStore({ maxBufferBytes: 40, maxBufferLines: 1000 })
    const cmd = process.platform === 'win32'
      ? 'for /L %i in (1,1,50) do @echo LINE%i'
      : 'for i in $(seq 1 50); do echo LINE$i; done'
    const r = store.start('a1', cmd, dir) as { id: string }
    await waitFor(() => {
      const out = store.readNew(r.id)
      return 'text' in out && out.text.includes('…truncated…')
    })
  }, 20000)

  it('unknown ids return errors', () => {
    const { store } = makeStore()
    expect('error' in store.readNew('nope')).toBe(true)
    expect('error' in store.kill('nope')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/background-process-store.test.ts`
Expected: FAIL — cannot find module `background-process-store`.

- [ ] **Step 3: Implement `BackgroundProcessStore`**

Create `src/main/agent/background-process-store.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import kill from 'tree-kill'
import { buildShellCommand } from './tools/bash'

export interface BgExitInfo {
  id: string
  agentId: string
  sessionId: string
  command: string
  exitCode: number | null
}

export interface BackgroundProcessStoreOpts {
  getSessionId: (agentId: string) => string
  onExit: (info: BgExitInfo) => void
  maxPerAgent?: number
  maxBufferBytes?: number
  maxBufferLines?: number
}

interface Entry {
  id: string
  agentId: string
  sessionId: string
  command: string
  child: ChildProcess
  status: 'running' | 'exited'
  exitCode: number | null
  buffer: string
  readOffset: number
  truncatedMarked: boolean
}

const DEFAULT_MAX_PER_AGENT = 10
const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_LINES = 2000
const EXITED_TTL_MS = 5 * 60_000

export class BackgroundProcessStore {
  private entries = new Map<string, Entry>()

  constructor(private opts: BackgroundProcessStoreOpts) {}

  private get maxPerAgent(): number { return this.opts.maxPerAgent ?? DEFAULT_MAX_PER_AGENT }
  private get maxBytes(): number { return this.opts.maxBufferBytes ?? DEFAULT_MAX_BYTES }
  private get maxLines(): number { return this.opts.maxBufferLines ?? DEFAULT_MAX_LINES }

  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'running') n++
    return n
  }

  start(agentId: string, command: string, cwd: string): { id: string } | { error: string } {
    if (!command || typeof command !== 'string') return { error: 'bash: missing "command" (string)' }
    if (this.count(agentId) >= this.maxPerAgent) {
      return { error: `bash: too many background processes (max ${this.maxPerAgent}). Stop one with kill_shell first.` }
    }
    const dir = existsSync(cwd) ? cwd : homedir()
    const resolved = buildShellCommand(command, dir)
    const child = spawn(resolved.command, resolved.args, {
      cwd: dir,
      env: process.env as Record<string, string>,
      windowsHide: true,
      windowsVerbatimArguments: resolved.verbatim ?? false
    })
    const id = randomUUID().slice(0, 8)
    const entry: Entry = {
      id, agentId, sessionId: this.opts.getSessionId(agentId), command,
      child, status: 'running', exitCode: null, buffer: '', readOffset: 0, truncatedMarked: false
    }
    this.entries.set(id, entry)
    const append = (d: Buffer) => this.appendOutput(entry, d.toString())
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (err) => this.appendOutput(entry, `\n[error] ${err.message}\n`))
    child.on('close', (code) => {
      entry.status = 'exited'
      entry.exitCode = code
      this.opts.onExit({ id, agentId, sessionId: entry.sessionId, command, exitCode: code })
      const timer = setTimeout(() => this.entries.delete(id), EXITED_TTL_MS)
      timer.unref?.()
    })
    return { id }
  }

  private appendOutput(entry: Entry, text: string): void {
    entry.buffer += text
    let dropped = 0
    if (entry.buffer.length > this.maxBytes) {
      const d = entry.buffer.length - this.maxBytes
      entry.buffer = entry.buffer.slice(d)
      dropped += d
    }
    const lines = entry.buffer.split('\n')
    if (lines.length > this.maxLines) {
      const kept = lines.slice(lines.length - this.maxLines).join('\n')
      dropped += entry.buffer.length - kept.length
      entry.buffer = kept
    }
    if (dropped > 0) {
      entry.readOffset = Math.max(0, entry.readOffset - dropped)
      if (!entry.truncatedMarked) {
        entry.buffer = '[…truncated…]\n' + entry.buffer
        entry.truncatedMarked = true
      }
    }
  }

  readNew(id: string, filter?: string): { text: string; status: 'running' | 'exited'; exitCode: number | null } | { error: string } {
    const entry = this.entries.get(id)
    if (!entry) return { error: `bash_output: unknown id "${id}"` }
    let text = entry.buffer.slice(entry.readOffset)
    entry.readOffset = entry.buffer.length
    if (filter) {
      let re: RegExp
      try { re = new RegExp(filter) } catch { return { error: 'bash_output: invalid filter regex' } }
      text = text.split('\n').filter(l => re.test(l)).join('\n')
    }
    const out = { text, status: entry.status, exitCode: entry.exitCode }
    if (entry.status === 'exited') this.entries.delete(id)
    return out
  }

  kill(id: string): { killed: boolean } | { error: string } {
    const entry = this.entries.get(id)
    if (!entry) return { error: `kill_shell: unknown id "${id}"` }
    if (entry.status === 'exited') return { killed: false }
    if (entry.child.pid) { try { kill(entry.child.pid) } catch { /* already dead */ } }
    return { killed: true }
  }

  killAllForAgent(agentId: string): void {
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'running' && e.child.pid) {
        try { kill(e.child.pid) } catch { /* already dead */ }
      }
    }
  }

  killAll(): void {
    for (const e of this.entries.values()) {
      if (e.status === 'running' && e.child.pid) {
        try { kill(e.child.pid) } catch { /* already dead */ }
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/background-process-store.test.ts`
Expected: PASS (all 6). If the truncation test is flaky on line counting, confirm the byte cap path triggers the marker.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/background-process-store.ts tests/unit/background-process-store.test.ts
git commit -m "feat(agent): add BackgroundProcessStore for long-lived shell processes"
```

---

### Task 2: `bash.run_in_background` + `bash_output` + `kill_shell` tools

**Files:**
- Modify: `src/main/agent/tools/types.ts` (add `backgroundProcs` to `ToolContext`)
- Modify: `src/main/agent/tools/bash.ts` (add flag; add two tools)
- Modify: `src/main/agent/tools/registry.ts` (register the two tools)
- Test: `tests/unit/agent-tools-background-bash.test.ts`

**Interfaces:**
- Consumes: `BackgroundProcessStore` from Task 1.
- Produces: `bashOutputTool`, `killShellTool` (both `ToolDefinition`) exported from `bash.ts`; `ToolContext.backgroundProcs?: BackgroundProcessStore`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/agent-tools-background-bash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bashTool, bashOutputTool, killShellTool } from '../../src/main/agent/tools/bash'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'
import type { ToolContext } from '../../src/main/agent/tools/types'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bgtool-'))

function ctxWithStore(): { ctx: ToolContext; store: BackgroundProcessStore } {
  const store = new BackgroundProcessStore({ getSessionId: () => 'sess-1', onExit: () => {} })
  const ctx: ToolContext = { cwd: dir, ask: async () => null, agentId: 'a1', backgroundProcs: store }
  return { ctx, store }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('background bash tools', () => {
  it('run_in_background returns immediately with an id and background flag', async () => {
    const { ctx } = ctxWithStore()
    const r = await bashTool.run({ command: 'echo BGT_OK', run_in_background: true }, ctx)
    expect(r.background).toBe(true)
    expect(r.output).toMatch(/id=[0-9a-f]{8}/)
  }, 20000)

  it('bash_output returns the captured output', async () => {
    const { ctx } = ctxWithStore()
    const started = await bashTool.run({ command: 'echo BGT_OUT', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    // Poll bash_output, accumulating output, until the marker appears.
    let seen = ''
    const start = Date.now()
    while (!seen.includes('BGT_OUT')) {
      if (Date.now() - start > 8000) throw new Error('no output from background shell')
      const out = await bashOutputTool.run({ id }, ctx)
      seen += out.output ?? ''
      if (!seen.includes('BGT_OUT')) await new Promise(r => setTimeout(r, 100))
    }
    expect(seen).toContain('BGT_OUT')
  }, 20000)

  it('bash_output and kill_shell error on unknown id', async () => {
    const { ctx } = ctxWithStore()
    const out = await bashOutputTool.run({ id: 'deadbeef' }, ctx)
    expect(out.error).toMatch(/unknown id/)
    const k = await killShellTool.run({ id: 'deadbeef' }, ctx)
    expect(k.error).toMatch(/unknown id/)
  })

  it('foreground bash still works without a store', async () => {
    const ctx: ToolContext = { cwd: dir, ask: async () => null }
    const r = await bashTool.run({ command: 'echo FG_OK' }, ctx)
    expect(r.output).toContain('FG_OK')
  }, 20000)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/agent-tools-background-bash.test.ts`
Expected: FAIL — `bashOutputTool`/`killShellTool` are not exported; `run_in_background` is ignored.

- [ ] **Step 3a: Add `backgroundProcs` to `ToolContext`**

In `src/main/agent/tools/types.ts`, add the import and field:

```ts
import type { BackgroundProcessStore } from '../background-process-store'
```

Inside `interface ToolContext`, add:

```ts
  // Long-lived background shell processes (bash run_in_background / bash_output / kill_shell).
  backgroundProcs?: BackgroundProcessStore
```

- [ ] **Step 3b: Extend the `bash` tool and add the two tools**

In `src/main/agent/tools/bash.ts`, extend `BashInput`:

```ts
interface BashInput {
  command: string
  timeoutMs?: number
  run_in_background?: boolean
}
```

Update the `bash` tool's `description` to mention background mode, add the schema field, and handle the flag at the top of `run` (before the foreground `spawn`):

```ts
  // in schema:
  run_in_background: z.boolean().optional()
    .describe('Run the command in the background and return immediately; read output with bash_output, stop with kill_shell.'),
```

```ts
  async run(input, ctx): Promise<ToolRunResult> {
    const { command, timeoutMs = 120_000, run_in_background } = input as unknown as BashInput
    if (!command || typeof command !== 'string') {
      return { error: 'bash: missing "command" (string)' }
    }
    if (run_in_background) {
      if (!ctx.backgroundProcs || !ctx.agentId) {
        return { error: 'bash: background execution is not available in this context' }
      }
      const res = ctx.backgroundProcs.start(ctx.agentId, command, ctx.cwd)
      if ('error' in res) return { error: res.error }
      return {
        output: `Background bash started. id=${res.id}. Read new output with bash_output({ id: "${res.id}" }); stop it with kill_shell({ id: "${res.id}" }).`,
        background: true
      }
    }
    // ...existing foreground implementation unchanged...
```

Append the two new tools at the end of `bash.ts` (after `bashTool`):

```ts
export const bashOutputTool: ToolDefinition = {
  name: 'bash_output',
  description:
    'Read new stdout/stderr produced by a background shell (started with bash run_in_background) since your last read. ' +
    'Optionally pass a regex filter to keep only matching lines.',
  schema: z.object({
    id: z.string().describe('The background shell id returned by bash run_in_background.'),
    filter: z.string().optional().describe('Optional regex; only matching lines are returned.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id, filter } = input as unknown as { id: string; filter?: string }
    if (!ctx.backgroundProcs) return { error: 'bash_output: background processes are not available here' }
    const r = ctx.backgroundProcs.readNew(id, filter)
    if ('error' in r) return { error: r.error }
    const attrs = r.status === 'exited'
      ? `status="exited" exit_code="${r.exitCode ?? 'null'}"`
      : 'status="running"'
    return { output: `<bash id="${id}" ${attrs}>\n${r.text || '(no new output)'}\n</bash>` }
  }
}

export const killShellTool: ToolDefinition = {
  name: 'kill_shell',
  description: 'Stop a background shell (started with bash run_in_background), killing its whole process tree.',
  schema: z.object({
    id: z.string().describe('The background shell id to stop.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id } = input as unknown as { id: string }
    if (!ctx.backgroundProcs) return { error: 'kill_shell: background processes are not available here' }
    const r = ctx.backgroundProcs.kill(id)
    if ('error' in r) return { error: r.error }
    return { output: r.killed ? `Killed background shell ${id}.` : `Background shell ${id} was already stopped.` }
  }
}
```

- [ ] **Step 3c: Register the tools**

In `src/main/agent/tools/registry.ts`, change the import and the tools array:

```ts
import { bashTool, bashOutputTool, killShellTool } from './bash'
```

```ts
  const tools = [
    bashTool,
    bashOutputTool,
    killShellTool,
    readTool,
    // ...rest unchanged...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-tools-background-bash.test.ts tests/unit/agent-tools-bash.test.ts`
Expected: PASS (new file + the existing bash suite still green).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/types.ts src/main/agent/tools/bash.ts src/main/agent/tools/registry.ts tests/unit/agent-tools-background-bash.test.ts
git commit -m "feat(agent): bash run_in_background plus bash_output and kill_shell tools"
```

---

### Task 3: Completion handler + loop/manager wiring (notify + auto-wake)

**Files:**
- Create: `src/main/agent/background-exit.ts`
- Test: `tests/unit/background-exit.test.ts`
- Modify: `src/main/agent/loop.ts` (add `backgroundProcs` to `LoopDeps` and to the `toolCtx`)
- Modify: `src/main/meow-agent-manager.ts` (own the store, pass it to the runner, handle exit, clean up)

**Interfaces:**
- Consumes: `BgExitInfo` (Task 1); `BackgroundProcessStore` (Task 1); manager internals `activeSessionId`, `running`, `enqueueMessage`, `drainQueue`, `deps.store.appendMessage`, `deps.notify`, `deps.onActivateAgent`, `agents`.
- Produces:
  - `interface BackgroundExitDeps { appendMessage: (sessionId: string, text: string) => void; notify?: (info: BgExitInfo) => void; isRunning: (agentId: string) => boolean; wake: (agentId: string, text: string) => void }`
  - `function backgroundExitMessage(info: BgExitInfo): string`
  - `function handleBackgroundExit(info: BgExitInfo, deps: BackgroundExitDeps): void`
  - `LoopDeps.backgroundProcs?: BackgroundProcessStore`

- [ ] **Step 1: Write the failing test for the handler**

Create `tests/unit/background-exit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { handleBackgroundExit, backgroundExitMessage } from '../../src/main/agent/background-exit'
import type { BgExitInfo } from '../../src/main/agent/background-process-store'

const info: BgExitInfo = { id: 'abc12345', agentId: 'a1', sessionId: 's9', command: 'npm run build', exitCode: 0 }

describe('handleBackgroundExit', () => {
  it('builds a message that names the id and command', () => {
    const msg = backgroundExitMessage(info)
    expect(msg).toContain('abc12345')
    expect(msg).toContain('npm run build')
    expect(msg).toContain('bash_output')
  })

  it('appends to the originating session and notifies', () => {
    const appendMessage = vi.fn()
    const notify = vi.fn()
    handleBackgroundExit(info, { appendMessage, notify, isRunning: () => true, wake: vi.fn() })
    expect(appendMessage).toHaveBeenCalledWith('s9', expect.stringContaining('abc12345'))
    expect(notify).toHaveBeenCalledWith(info)
  })

  it('wakes the agent only when idle', () => {
    const wakeIdle = vi.fn()
    handleBackgroundExit(info, { appendMessage: vi.fn(), isRunning: () => false, wake: wakeIdle })
    expect(wakeIdle).toHaveBeenCalledTimes(1)

    const wakeBusy = vi.fn()
    handleBackgroundExit(info, { appendMessage: vi.fn(), isRunning: () => true, wake: wakeBusy })
    expect(wakeBusy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/background-exit.test.ts`
Expected: FAIL — module `background-exit` not found.

- [ ] **Step 3a: Implement the handler**

Create `src/main/agent/background-exit.ts`:

```ts
import type { BgExitInfo } from './background-process-store'

export interface BackgroundExitDeps {
  appendMessage: (sessionId: string, text: string) => void
  notify?: (info: BgExitInfo) => void
  isRunning: (agentId: string) => boolean
  wake: (agentId: string, text: string) => void
}

export function backgroundExitMessage(info: BgExitInfo): string {
  const status = info.exitCode === null ? 'was stopped' : `exited (code ${info.exitCode})`
  return `[background bash ${info.id}] \`${info.command}\` ${status}. ` +
    `Read its output with bash_output({ id: "${info.id}" }).`
}

export function handleBackgroundExit(info: BgExitInfo, deps: BackgroundExitDeps): void {
  deps.appendMessage(info.sessionId, backgroundExitMessage(info))
  deps.notify?.(info)
  // Auto-wake only when the agent is idle; a mid-turn agent picks the message
  // up on its next step, and the drainQueue guard would ignore a wake anyway.
  if (!deps.isRunning(info.agentId)) {
    deps.wake(
      info.agentId,
      `A background shell (${info.id}) just finished. If it is relevant, read its output with bash_output and continue.`
    )
  }
}
```

- [ ] **Step 3b: Run the handler test to verify it passes**

Run: `npx vitest run tests/unit/background-exit.test.ts`
Expected: PASS (3).

- [ ] **Step 3c: Wire `backgroundProcs` through the loop**

In `src/main/agent/loop.ts`, add to the `LoopDeps` interface (near `snapshots`/`onArtifact`), with the import at the top:

```ts
import type { BackgroundProcessStore } from './background-process-store'
```

```ts
  /** Long-lived background shell processes for bash run_in_background. */
  backgroundProcs?: BackgroundProcessStore
```

In the `toolCtx` object (currently ends with `onArtifact: (entry) => this.deps.onArtifact?.(entry)`), add:

```ts
          backgroundProcs: this.deps.backgroundProcs,
```

- [ ] **Step 3d: Own the store and handle exits in the manager**

In `src/main/meow-agent-manager.ts`:

Add imports:

```ts
import { BackgroundProcessStore, type BgExitInfo } from './agent/background-process-store'
import { handleBackgroundExit } from './agent/background-exit'
```

Add a field near the other private maps (e.g. after `private backgrounds = new Map<string, boolean>()`):

```ts
  private backgroundProcs = new BackgroundProcessStore({
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onExit: (info) => this.onBackgroundBashExit(info)
  })
```

Add the exit handler method (place it near `enqueueMessage`/`drainQueue`):

```ts
  private onBackgroundBashExit(info: BgExitInfo): void {
    handleBackgroundExit(info, {
      appendMessage: (sessionId, text) => this.deps.store.appendMessage(sessionId, {
        id: randomUUID(),
        role: 'assistant',
        text,
        createdAt: Date.now()
      }),
      notify: (i) => {
        if (this.deps.notifications?.onDone === false) return
        const status = i.exitCode === null ? 'stopped' : `code ${i.exitCode}`
        this.deps.notify?.notify({
          title: '[meow] Background task finished',
          body: `${this.agents.get(i.agentId)?.name ?? i.agentId}: ${i.command} (${status})`,
          agentId: i.agentId,
          kind: 'done',
          onActivate: () => this.deps.onActivateAgent?.(i.agentId)
        })
      },
      isRunning: (agentId) => this.running.has(agentId),
      wake: (agentId, text) => {
        this.enqueueMessage(agentId, text)
        void this.drainQueue(agentId)
      }
    })
  }
```

Pass the store into the main `SessionRunner` (the `new SessionRunner({ ... })` around line 1183, alongside `snapshots`/`onEvent`):

```ts
      backgroundProcs: this.backgroundProcs,
```

Clean up on agent stop — inside the `stop(agentId: string)` method, before/after killing the runner, add:

```ts
    this.backgroundProcs.killAllForAgent(agentId)
```

Clean up on dispose — in the shutdown method that already loops `this.stop(id)` for all controllers/backgroundTasks (around line 505), add after the loop:

```ts
    this.backgroundProcs.killAll()
```

> `randomUUID` is already imported in this file (used by `onBackgroundResult`); if a linter reports it unused/missing, reuse the existing import.

- [ ] **Step 4: Verify the whole suite and types**

Run: `npx vitest run` then `npm run typecheck`
Expected: all tests PASS; typecheck clean. (`backgroundProcs` is optional on `LoopDeps`/`ToolContext`, so the subagent runner in `task.ts`, which does not pass it, still compiles — background bash is intentionally unavailable inside subagents and returns the clear "not available in this context" error.)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/background-exit.ts tests/unit/background-exit.test.ts src/main/agent/loop.ts src/main/meow-agent-manager.ts
git commit -m "feat(agent): notify and auto-wake on background bash exit; wire store into loop and manager"
```

---

## Self-Review

**1. Spec coverage:**
- `BackgroundProcessStore` (spec §1) → Task 1. ✓ (ring buffer, `readNew`/offset, `kill`/tree-kill, limit, `killAllForAgent`/`killAll`, TTL cleanup.)
- Tool surface `run_in_background` / `bash_output` / `kill_shell` (spec §2) → Task 2. ✓
- Wiring via `ToolContext` (spec §3) → Task 2 (type) + Task 3 (loop/manager). ✓
- Completion flow notify + auto-wake if idle (spec §4) → Task 3 `handleBackgroundExit`. ✓
- Lifecycle & cleanup on stop/dispose (spec §5) → Task 3 Step 3d. ✓
- Permission decided before spawn (spec §5) → unchanged loop permission path gates `bash`; `run_in_background` is only a flag on the same tool, so no new surface. ✓
- UI feed-only via appended message + notification (spec §6) → Task 3, no renderer/ChatEvent changes. ✓
- Testing strategy (spec §7) → Tasks 1–3 tests. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"implement later" remain; every code step contains real code, and each test uses a concrete poll loop rather than a sketch.

**3. Type consistency:** `BgExitInfo`, `BackgroundProcessStoreOpts`, `BackgroundProcessStore` method signatures, `BackgroundExitDeps`, `handleBackgroundExit`, and `backgroundExitMessage` are used identically across Tasks 1–3. `ctx.backgroundProcs` / `LoopDeps.backgroundProcs` names match. Tool names `bash_output` / `kill_shell` are consistent between `bash.ts`, `registry.ts`, and the tests.
