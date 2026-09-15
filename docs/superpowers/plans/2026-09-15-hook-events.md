# Extended Hook Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five hook events — `UserPromptSubmit`, `SessionStart`, `SubagentStop`, `PreCompact`, `SessionEnd` — to Meow's hook system, wired to their fire sites.

**Architecture:** `HooksExecutor` gains a `runX` method per event (mirroring `runStop`/`runPreToolUse`); the `HooksRunner` interface and `HooksConfig`/`HOOK_EVENTS`/`DEFAULT_TIMEOUT_S` gain the events. Fire sites: the loop fires `PreCompact` before compaction, the task tool fires `SubagentStop` after a subagent finishes (bounded block-resume), and the manager fires `UserPromptSubmit`/`SessionStart` on user submit and `SessionEnd` on delete/dispose.

**Tech Stack:** TypeScript, Node child_process, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-hook-events-design.md`

## Global Constraints

- Reuse the existing engine: `execute(hook, event, payload)`, `hookOutput(exec.json)`, `asString`, exit-code semantics (exit 2 = block). Do NOT add a new execution path.
- Payloads always include `hook_event_name` and `cwd`, plus the event's fields.
- `UserPromptSubmit`, `SessionStart`, `SubagentStop`, `PreCompact`, `SessionEnd` ignore the matcher (all configured hooks fire), like `Stop`.
- Block semantics: exit 2 OR `decision === 'block'` OR `ok === false`.
- No `Notification` event, no config-UI changes.
- Tests live under `tests/unit/*.test.ts`; stub hook processes with `fakeSpawn` + `spawnFn`, following `tests/unit/agent-hooks.test.ts`.

## How to apply this plan (no inference required)

- Every **"Create"** step gives the file's full contents — write it verbatim.
- Every **"Modify"** step is a set of exact **FIND → REPLACE** edits. The `FIND` block exists verbatim in the current source; locate it and swap in the `REPLACE`. Do not hand-merge.
- Line numbers are **hints as of 2026-09-15**; match by the verbatim `FIND` text.
- Run each "Run:" command and confirm the Expected result. Commit at the end of each task with the message given.

---

### Task 1: Add the five events to the hook engine

**Files:**
- Modify: `src/main/agent/hooks.ts`
- Test: `tests/unit/agent-hooks.test.ts`

**Interfaces:**
- Produces on `HooksRunner` / `HooksExecutor`: `runUserPromptSubmit(prompt)`, `runSessionStart(source)`, `runSubagentStop(lastAssistantMessage, stopHookActive, subagentType)`, `runPreCompact(trigger)`, `runSessionEnd(reason)`; result types `UserPromptSubmitResult`, `SessionStartResult`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/agent-hooks.test.ts`, immediately before the final top-level line (append a new `describe` at end of file):

```ts
describe('extended hook events', () => {
  const cfg = (event: string) => ({ [event]: [{ matcher: '*', hooks: [{ type: 'command', command: 'h.sh' }] }] } as unknown as HooksConfig)

  it('runUserPromptSubmit blocks on exit 2 and carries the prompt', async () => {
    const spawned = fakeSpawn({ stderr: 'nope', exitCode: 2 })
    const ex = new HooksExecutor(cfg('UserPromptSubmit'), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runUserPromptSubmit('do the thing')
    expect(r.block).toBe(true)
    expect(r.reason).toContain('nope')
    expect(spawned.calls[0].stdin).toContain('do the thing')
  })

  it('runUserPromptSubmit aggregates additionalContext on success', async () => {
    const spawned = fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'branch=main' } }), exitCode: 0 })
    const ex = new HooksExecutor(cfg('UserPromptSubmit'), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runUserPromptSubmit('hi')
    expect(r.block).toBeFalsy()
    expect(r.additionalContext).toContain('branch=main')
  })

  it('runSessionStart injects context and cannot block', async () => {
    const spawned = fakeSpawn({ stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'ctx' } }), exitCode: 2 })
    const ex = new HooksExecutor(cfg('SessionStart'), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runSessionStart('startup')
    expect(r.additionalContext).toContain('ctx')
    expect(spawned.calls[0].stdin).toContain('startup')
  })

  it('runSubagentStop blocks on decision block', async () => {
    const spawned = fakeSpawn({ stdout: JSON.stringify({ decision: 'block', reason: 'keep going' }), exitCode: 0 })
    const ex = new HooksExecutor(cfg('SubagentStop'), { cwd: '/proj', spawnFn: spawned.fn as never })
    const r = await ex.runSubagentStop('done', false, 'research')
    expect(r.block).toBe(true)
    expect(r.reason).toContain('keep going')
    expect(spawned.calls[0].stdin).toContain('research')
  })

  it('runPreCompact and runSessionEnd fire without throwing', async () => {
    const spawned = fakeSpawn({ exitCode: 0 })
    const ex = new HooksExecutor({ ...cfg('PreCompact'), ...cfg('SessionEnd') } as HooksConfig, { cwd: '/proj', spawnFn: spawned.fn as never })
    await expect(ex.runPreCompact('auto')).resolves.toBeUndefined()
    await expect(ex.runSessionEnd('exit')).resolves.toBeUndefined()
    expect(spawned.calls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/agent-hooks.test.ts -t "extended hook events"`
Expected: FAIL — `runUserPromptSubmit` etc. are not functions.

- [ ] **Step 3a: Event names, config, timeouts**

Three exact edits in `src/main/agent/hooks.ts`.

**Edit 1 — `HookEventName` + `HOOK_EVENTS`.** FIND:
```ts
export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'Stop'

export const HOOK_EVENTS: readonly HookEventName[] = ['PreToolUse', 'PostToolUse', 'Stop']
```
REPLACE:
```ts
export type HookEventName =
  | 'PreToolUse' | 'PostToolUse' | 'Stop'
  | 'UserPromptSubmit' | 'SessionStart' | 'SubagentStop' | 'PreCompact' | 'SessionEnd'

export const HOOK_EVENTS: readonly HookEventName[] = [
  'PreToolUse', 'PostToolUse', 'Stop',
  'UserPromptSubmit', 'SessionStart', 'SubagentStop', 'PreCompact', 'SessionEnd'
]
```

**Edit 2 — `HooksConfig`.** FIND:
```ts
export interface HooksConfig {
  PreToolUse?: HookGroup[]
  PostToolUse?: HookGroup[]
  // Stop hooks always fire; their matcher is ignored.
  Stop?: HookGroup[]
}
```
REPLACE:
```ts
export interface HooksConfig {
  PreToolUse?: HookGroup[]
  PostToolUse?: HookGroup[]
  // Stop hooks always fire; their matcher is ignored.
  Stop?: HookGroup[]
  // These also ignore the matcher (all configured hooks fire).
  UserPromptSubmit?: HookGroup[]
  SessionStart?: HookGroup[]
  SubagentStop?: HookGroup[]
  PreCompact?: HookGroup[]
  SessionEnd?: HookGroup[]
}
```

**Edit 3 — `DEFAULT_TIMEOUT_S` (it is `Record<HookEventName, number>`, so every event needs an entry).** FIND:
```ts
const DEFAULT_TIMEOUT_S: Record<HookEventName, number> = {
  PreToolUse: 60,
  PostToolUse: 600,
  Stop: 600
}
```
REPLACE:
```ts
const DEFAULT_TIMEOUT_S: Record<HookEventName, number> = {
  PreToolUse: 60,
  PostToolUse: 600,
  Stop: 600,
  UserPromptSubmit: 60,
  SessionStart: 60,
  SubagentStop: 600,
  PreCompact: 60,
  SessionEnd: 60
}
```

- [ ] **Step 3b: Result types + `HooksRunner` interface**

**Edit 1 — result types** (after `StopResult`). FIND:
```ts
export interface StopResult {
  block: boolean
  reason?: string
}
```
REPLACE:
```ts
export interface StopResult {
  block: boolean
  reason?: string
}

export interface UserPromptSubmitResult {
  block?: boolean
  reason?: string
  additionalContext?: string
}

export interface SessionStartResult {
  additionalContext?: string
}
```

**Edit 2 — `HooksRunner` interface.** FIND:
```ts
  runStop(lastAssistantMessage: string, stopHookActive: boolean): Promise<StopResult>
}
```
REPLACE:
```ts
  runStop(lastAssistantMessage: string, stopHookActive: boolean): Promise<StopResult>
  runUserPromptSubmit(prompt: string): Promise<UserPromptSubmitResult>
  runSessionStart(source: 'startup' | 'resume'): Promise<SessionStartResult>
  runSubagentStop(lastAssistantMessage: string, stopHookActive: boolean, subagentType: string): Promise<StopResult>
  runPreCompact(trigger: 'auto' | 'manual'): Promise<void>
  runSessionEnd(reason: 'delete' | 'exit'): Promise<void>
}
```

- [ ] **Step 3c: Implement the five methods in `HooksExecutor`**

Add them right after `runStop`. FIND:
```ts
      if (exec.exitCode === 2 || out.decision === 'block' || out.ok === false) {
        return { block: true, reason: asString(out.reason) ?? asString(exec.stderr) }
      }
    }
    return { block: false }
  }
}
```
REPLACE:
```ts
      if (exec.exitCode === 2 || out.decision === 'block' || out.ok === false) {
        return { block: true, reason: asString(out.reason) ?? asString(exec.stderr) }
      }
    }
    return { block: false }
  }

  async runUserPromptSubmit(prompt: string): Promise<UserPromptSubmitResult> {
    const result: UserPromptSubmitResult = {}
    for (const hook of (this.config.UserPromptSubmit ?? []).flatMap(group => group.hooks)) {
      const exec = await this.execute(hook, 'UserPromptSubmit', {
        hook_event_name: 'UserPromptSubmit', cwd: this.deps.cwd, prompt
      })
      const out = hookOutput(exec.json)
      if (exec.exitCode === 2 || out.decision === 'block' || out.ok === false) {
        result.block = true
        result.reason = asString(out.reason) ?? asString(exec.stderr)
        return result
      }
      const context = asString(out.additionalContext)
      if (context) result.additionalContext = result.additionalContext ? `${result.additionalContext}\n${context}` : context
    }
    return result
  }

  async runSessionStart(source: 'startup' | 'resume'): Promise<SessionStartResult> {
    const result: SessionStartResult = {}
    for (const hook of (this.config.SessionStart ?? []).flatMap(group => group.hooks)) {
      const exec = await this.execute(hook, 'SessionStart', {
        hook_event_name: 'SessionStart', cwd: this.deps.cwd, source
      })
      const out = hookOutput(exec.json)
      const context = asString(out.additionalContext)
      if (context) result.additionalContext = result.additionalContext ? `${result.additionalContext}\n${context}` : context
    }
    return result
  }

  async runSubagentStop(lastAssistantMessage: string, stopHookActive: boolean, subagentType: string): Promise<StopResult> {
    for (const hook of (this.config.SubagentStop ?? []).flatMap(group => group.hooks)) {
      const exec = await this.execute(hook, 'SubagentStop', {
        hook_event_name: 'SubagentStop', cwd: this.deps.cwd,
        last_assistant_message: lastAssistantMessage, stop_hook_active: stopHookActive, subagent_type: subagentType
      })
      const out = hookOutput(exec.json)
      if (exec.exitCode === 2 || out.decision === 'block' || out.ok === false) {
        return { block: true, reason: asString(out.reason) ?? asString(exec.stderr) }
      }
    }
    return { block: false }
  }

  async runPreCompact(trigger: 'auto' | 'manual'): Promise<void> {
    for (const hook of (this.config.PreCompact ?? []).flatMap(group => group.hooks)) {
      await this.execute(hook, 'PreCompact', { hook_event_name: 'PreCompact', cwd: this.deps.cwd, trigger })
    }
  }

  async runSessionEnd(reason: 'delete' | 'exit'): Promise<void> {
    for (const hook of (this.config.SessionEnd ?? []).flatMap(group => group.hooks)) {
      await this.execute(hook, 'SessionEnd', { hook_event_name: 'SessionEnd', cwd: this.deps.cwd, reason })
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-hooks.test.ts`
Expected: PASS (existing + the five new tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/hooks.ts tests/unit/agent-hooks.test.ts
git commit -m "feat(hooks): add UserPromptSubmit/SessionStart/SubagentStop/PreCompact/SessionEnd to the engine"
```

---

### Task 2: Fire `PreCompact` in the loop

**Files:**
- Modify: `src/main/agent/loop.ts`

**Interfaces:**
- Consumes: `this.hooks.runPreCompact` (Task 1).

- [ ] **Step 1: Add the fire call**

One exact edit in `src/main/agent/loop.ts`, in the compaction path (just before `compactTranscript`). FIND:
```ts
    this.deps.onEvent({ type: 'compaction-start', agentId: this.deps.agentId })
    const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
```
REPLACE:
```ts
    await this.hooks?.runPreCompact('auto')
    this.deps.onEvent({ type: 'compaction-start', agentId: this.deps.agentId })
    const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`this.hooks` is `HooksRunner | undefined`, which now declares `runPreCompact`.)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/loop.ts
git commit -m "feat(hooks): fire PreCompact before compaction"
```

---

### Task 3: Fire `SubagentStop` in the task tool

**Files:**
- Modify: `src/main/agent/tools/task.ts`

**Interfaces:**
- Consumes: `opts.hooks().runSubagentStop` (Task 1).

- [ ] **Step 1: Add a bounded block-resume after the subagent finishes**

One exact edit in `src/main/agent/tools/task.ts`. FIND:
```ts
    await runner.run(signal)

    let text = ''
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') {
        text = item.message.text
        break
      }
    }
```
REPLACE:
```ts
    await runner.run(signal)

    // SubagentStop hooks fire when the subagent finishes; a block resumes it,
    // bounded so a misbehaving hook cannot loop forever.
    const lastText = (): string => {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') return item.message.text
      }
      return ''
    }
    const hooks = opts.hooks?.()
    if (hooks) {
      const MAX_SUBAGENT_STOP_BLOCKS = 3
      for (let blocks = 0; blocks < MAX_SUBAGENT_STOP_BLOCKS && !signal?.aborted; blocks++) {
        const stop = await hooks.runSubagentStop(lastText(), blocks > 0, input.role.name)
        if (!stop.block) break
        items.push({ kind: 'message', message: { id: randomUUID(), role: 'user', text: stop.reason ?? 'Please continue.', createdAt: Date.now() } })
        await runner.run(signal)
      }
    }

    let text = ''
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'message' && item.message.role === 'assistant' && item.message.text.trim() !== '') {
        text = item.message.text
        break
      }
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`randomUUID` is already imported at the top of `task.ts`; `input.role.name` is the `SubagentRole` passed into `runSubagent`.)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/task.ts
git commit -m "feat(hooks): fire SubagentStop when a subagent finishes (bounded block-resume)"
```

---

### Task 4: Fire `UserPromptSubmit`/`SessionStart`/`SessionEnd` in the manager

**Files:**
- Modify: `src/main/meow-agent-manager.ts`

**Interfaces:**
- Consumes: `HooksExecutor.runUserPromptSubmit` / `runSessionStart` / `runSessionEnd` (Task 1); the local `hooks` factory built in `register`.

- [ ] **Step 1: Add fields to hold the per-agent hooks factory and started-session set**

FIND:
```ts
  private turnCounters = new Map<string, number>()
```
REPLACE:
```ts
  private turnCounters = new Map<string, number>()
  // Per-agent hooks factory (built in register) so lifecycle events can fire
  // outside the tool loop; and which sessions have already fired SessionStart.
  private agentHooks = new Map<string, () => HooksExecutor>()
  private startedSessions = new Set<string>()
```

- [ ] **Step 2: Store the factory in `register`**

FIND:
```ts
    const hooks = (): HooksExecutor => new HooksExecutor(
      mergeHooksConfig(loadMeowConfig(this.deps.configPath).hooks, loadProjectHooks(agent.cwd)),
      {
        cwd: agent.cwd,
        callMcpTool: (server, tool, input) => this.mcp.callTool(server, tool, input),
        getModel: () => ({ llm: llmClient, model: resolved.model })
      }
    )
```
REPLACE:
```ts
    const hooks = (): HooksExecutor => new HooksExecutor(
      mergeHooksConfig(loadMeowConfig(this.deps.configPath).hooks, loadProjectHooks(agent.cwd)),
      {
        cwd: agent.cwd,
        callMcpTool: (server, tool, input) => this.mcp.callTool(server, tool, input),
        getModel: () => ({ llm: llmClient, model: resolved.model })
      }
    )
    this.agentHooks.set(agent.id, hooks)
```

- [ ] **Step 3: Fire `SessionStart` + `UserPromptSubmit` in `send`**

FIND:
```ts
  async send(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (this.running.has(agentId)) {
      this.enqueueMessage(agentId, text, images, displayText)
      return
    }
    await this.runTurn(agentId, text, images, displayText)
    await this.drainQueue(agentId)
  }
```
REPLACE:
```ts
  async send(agentId: string, text: string, images?: ImageAttachment[], displayText?: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return

    // Lifecycle hooks fire at submit time (genuine user prompts only; internal
    // nudges use enqueueMessage directly and never reach here).
    const runner = this.agentHooks.get(agentId)?.()
    let injected = ''
    if (runner) {
      const sessionId = this.activeSessionId(agentId)
      if (!this.startedSessions.has(sessionId)) {
        this.startedSessions.add(sessionId)
        const source = (this.deps.store.get(sessionId)?.items?.length ?? 0) > 0 ? 'resume' : 'startup'
        const start = await runner.runSessionStart(source)
        if (start.additionalContext) injected += `${start.additionalContext}\n`
      }
      const ups = await runner.runUserPromptSubmit(text)
      if (ups.block) {
        this.emit({ type: 'error', agentId, message: `[hook] prompt blocked${ups.reason ? `: ${ups.reason}` : ''}` })
        return
      }
      if (ups.additionalContext) injected += `${ups.additionalContext}\n`
    }
    const finalText = injected ? `<system-reminder>\n${injected.trim()}\n</system-reminder>\n${text}` : text
    const finalDisplay = injected ? (displayText ?? text) : displayText

    if (this.running.has(agentId)) {
      this.enqueueMessage(agentId, finalText, images, finalDisplay)
      return
    }
    await this.runTurn(agentId, finalText, images, finalDisplay)
    await this.drainQueue(agentId)
  }
```

- [ ] **Step 4: Fire `SessionEnd` on delete and dispose**

**Edit 1 — `removeAgent`.** FIND:
```ts
  removeAgent(agentId: string): void {
    this.registrationVersion.set(agentId, (this.registrationVersion.get(agentId) ?? 0) + 1)
    this.stop(agentId)
```
REPLACE:
```ts
  removeAgent(agentId: string): void {
    void this.agentHooks.get(agentId)?.().runSessionEnd('delete')
    this.startedSessions.delete(this.activeSessionId(agentId))
    this.agentHooks.delete(agentId)
    this.registrationVersion.set(agentId, (this.registrationVersion.get(agentId) ?? 0) + 1)
    this.stop(agentId)
```

**Edit 2 — `dispose`.** FIND:
```ts
  async dispose(): Promise<void> {
    if (this.idleCompactTimer) { clearInterval(this.idleCompactTimer); this.idleCompactTimer = null }
    this.stopAll()
```
REPLACE:
```ts
  async dispose(): Promise<void> {
    if (this.idleCompactTimer) { clearInterval(this.idleCompactTimer); this.idleCompactTimer = null }
    for (const factory of this.agentHooks.values()) void factory().runSessionEnd('exit')
    this.stopAll()
```

- [ ] **Step 5: Verify the whole suite and types**

Run: `npx vitest run` then `npm run typecheck`
Expected: all tests PASS; typecheck clean. (`HooksExecutor` is already imported in the manager; `this.emit` and `this.activeSessionId` already exist.)

- [ ] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts
git commit -m "feat(hooks): fire UserPromptSubmit/SessionStart on submit and SessionEnd on delete/dispose"
```

---

## Self-Review

**1. Spec coverage:**
- Types/config/timeouts + result types (spec §1) → Task 1 Steps 3a–3b. ✓
- Five runner methods with payloads + control (spec §2) → Task 1 Step 3c. ✓
- Fire sites: PreCompact→loop (§3) Task 2; SubagentStop→task (§3) Task 3; UserPromptSubmit/SessionStart/SessionEnd→manager (§3) Task 4. ✓
- Safety: SubagentStop bounded + `stop_hook_active`; PreCompact/UserPromptSubmit cannot loop (spec §4) → Task 3 (MAX_SUBAGENT_STOP_BLOCKS) + Task 1. ✓
- Testing (spec §5) → Task 1 unit tests; Tasks 2–4 typecheck + full suite. ✓

**2. Placeholder scan:** No `TBD`/`TODO`; every code step has real code. Tests read the hook's stdin via `spawned.calls[i].stdin`, matching the existing `SpawnRecord` shape in `agent-hooks.test.ts`.

**3. Type consistency:** `HookEventName` additions match `HOOK_EVENTS`, `HooksConfig`, and `DEFAULT_TIMEOUT_S` (all five in each). `runUserPromptSubmit`/`runSessionStart`/`runSubagentStop`/`runPreCompact`/`runSessionEnd` signatures match between the `HooksRunner` interface and `HooksExecutor`. `UserPromptSubmitResult`/`SessionStartResult` are defined in Task 1 and consumed in Task 4. The manager's `agentHooks` holds `() => HooksExecutor` (the exact type of the `hooks` factory in `register`), and `runSessionEnd('delete'|'exit')` / `runSessionStart('startup'|'resume')` literals match the method signatures.
```
