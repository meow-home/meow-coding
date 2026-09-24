# External Delegation (Claude → Meow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code (desktop app) hand plan tasks to Meow through a loopback HTTP API + a blocking CLI, get woken when each task ends, and send feedback into the same per-plan Meow session.

**Architecture:** A new `src/main/external-api/` module (config file, HTTP server, facade, lifecycle manager, Claude-skill installer) sits on top of the existing `SessionDelegationService`, which gains an `external` source kind. A dependency-free Node CLI (`resources/external-api/meow-delegate.mjs`) is copied into `userData/bin/` and blocks until the task is terminal, so Claude's `run_in_background` Bash wakes the model on exit.

**Tech Stack:** Electron 41 main process, `node:http`, TypeScript strict, Vitest, React 19 (settings tab), plain ESM Node ≥ 18 for the CLI.

**Spec:** `docs/superpowers/specs/2026-09-24-external-delegation-design.md`

## Global Constraints

- Server binds `127.0.0.1` only; preferred port `3929`, fallback port `0` (OS-assigned).
- Every `/v1` route requires `Authorization: Bearer <token>`; compare with `crypto.timingSafeEqual`; 401 otherwise.
- Any request carrying an `Origin` header → 403. No CORS headers are ever sent.
- Request body cap 64 KiB (413 when exceeded).
- Token: 32 random bytes, hex (64 chars); persisted in `userData/external-api.json`; kept until regenerated.
- Feature is **disabled by default**.
- Task limits reuse the service: task ≤ 32 KiB, result ≤ 64 KiB (truncated), ≤ 5 nonterminal delegations per target.
- `/wait` timeout default 60 s, max 120 s.
- External source sentinel: `sourceAgentId = sourceSessionId = 'external:claude'`; display name `Claude (external)`.
- Per-plan session name: `[claude] <title>`; title defaults to the plan file's basename without extension.
- CLI exit codes: `0` completed · `1` failed/interrupted · `2` cancelled · `3` unreachable/disabled/401 · `4` invalid args or 400/404/413.
- CLI reads task text from files only; retries transient connection failures for 30 s.
- IPC channel strings only via `Channels` in `src/shared/ipc.ts`. `src/shared` must not import Node/Electron.
- English everywhere (code, UI labels, docs). `[meow]` prefix for system-style messages.
- No unnecessary comments. Git commits must **not** include a `Co-Authored-By` trailer.
- Before completion: `npm run typecheck` and `npm test` pass.

## Deviations from the spec (decided while planning)

- **Settings storage:** instead of `MeowSettings.externalDelegation` (which round-trips through `meow.json`), `enabled` lives in `userData/external-api.json` next to port/token, mirroring `remote.json` + `RemoteTab`. The file shape becomes `{ enabled, port, token, cliPath }`.
- **CLI + skill template location:** `resources/external-api/` (packaged via `extraResources` to `external-api/`) instead of `src/main/external-api/cli/`, because the CLI is copied as a file, not bundled.
- **`TaskDto`:** only `sessionId` (the Meow agent id); the redundant `agentId` field is dropped. `POST /v1/tasks` returns `{ task: TaskDto }`.
- **Renderer refresh:** a new `workspace:changed` event (`{ runtime: WorkspaceRuntime }`) tells the renderer a project/session was created from main, since no such event exists today.
- **Manager hook:** `MeowAgentManager.ensureAgent(agent)` (awaits registration) is added so a session in a never-opened project is runnable.

Task 12 updates the spec to record these.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/external-api-types.ts` | Create | `EXTERNAL_SOURCE_ID`, `EXTERNAL_SOURCE_NAME`, `TaskDto`, `CreateTaskBody`, `ExternalApiStatus`, `isExternalPeer` |
| `src/shared/types.ts` | Modify | `SessionDelegation` gains `sourceKind?`, `externalClient?`, `planKey?` |
| `src/main/session-delegation-store.ts` | Modify | `CreateDelegationRecord` carries the new optional fields |
| `src/main/session-delegation-service.ts` | Modify | `createExternal`, external-aware pump/finish, `cancel`, `DelegationRuntime.stopRun` |
| `src/main/meow-agent-manager.ts` | Modify | `ensureAgent(agent)` |
| `src/main/external-api/config-file.ts` | Create | `ExternalApiConfigFile` (load/update/regenerate) |
| `src/main/external-api/errors.ts` | Create | `ExternalApiError(status, message)` |
| `src/main/external-api/server.ts` | Create | `ExternalApiServer` (auth, routing, long-poll) |
| `src/main/external-api/facade.ts` | Create | `ExternalDelegationFacade` (project/session resolution, DTO mapping) |
| `src/main/external-api/claude-skill.ts` | Create | `installClaudeSkill(templatePath, cliPath, skillsDir)` |
| `src/main/external-api/manager.ts` | Create | `ExternalApiManager` (enable/disable, CLI copy, status) |
| `src/main/external-api/AGENTS.md` + `CLAUDE.md` | Create | Module docs |
| `resources/external-api/meow-delegate.mjs` | Create | The CLI |
| `resources/external-api/claude-skill.md` | Create | Claude skill template with `{{CLI_PATH}}` |
| `src/main/index.ts` | Modify | Wiring, IPC handlers, `workspace:changed` push |
| `src/shared/ipc.ts` / `src/preload/index.ts` | Modify | New channels + `AgentApi` methods |
| `electron-builder.ts` | Modify | `extraResources` entry |
| `src/renderer/src/components/settings/ExternalTab.tsx` | Create | Settings UI |
| `src/renderer/src/components/settings/SettingsDialog.tsx` | Modify | Register the tab |
| `src/renderer/src/App.tsx` | Modify | Handle `workspace:changed` |
| `src/renderer/src/components/chat/ChatPanel.tsx` | Modify | "From: Claude (external)" label |
| Tests | Create/Modify | see each task |
| Docs | Modify | `docs/reference/05`, `06`, `08`, `src/main/AGENTS.md`, spec |

---

### Task 1: Shared types and store fields

**Files:**
- Create: `src/shared/external-api-types.ts`
- Modify: `src/shared/types.ts:167-188` (`SessionDelegation`)
- Modify: `src/main/session-delegation-store.ts:19-28` (`CreateDelegationRecord`), `create()` at `:104-122`
- Test: `tests/unit/session-delegation-store.test.ts`

**Interfaces:**
- Produces: `EXTERNAL_SOURCE_ID = 'external:claude'`, `EXTERNAL_SOURCE_NAME = 'Claude (external)'`, `isExternalPeer(id: string): boolean`, `TaskDto`, `CreateTaskBody`, `ExternalApiStatus`; `SessionDelegation.sourceKind?: 'session' | 'external'`, `.externalClient?: 'claude'`, `.planKey?: string`; `CreateDelegationRecord` accepts the same three optional fields.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/session-delegation-store.test.ts` inside the top-level `describe` (reuse the file's existing setup helper that builds a `SessionDelegationStore` over a temp `createJsonStore`; if the helper is named differently, adapt the two setup lines only):

```ts
  it('persists external source fields and round-trips them through load()', async () => {
    const created = store.create({
      id: 'x1',
      projectPath: 'E:\\Repo',
      sourceAgentId: 'external:claude',
      sourceSessionId: 'external:claude',
      targetAgentId: 'beta',
      targetSessionId: 'beta-s',
      targetBusyAtCreation: false,
      task: 't',
      sourceKind: 'external',
      externalClient: 'claude',
      planKey: 'e:/repo/docs/plan.md'
    })
    expect(created.sourceKind).toBe('external')
    expect(created.externalClient).toBe('claude')
    expect(created.planKey).toBe('e:/repo/docs/plan.md')
    await store.load()
    expect(store.get('x1')?.planKey).toBe('e:/repo/docs/plan.md')
  })

  it('omits external fields for ordinary session delegations', () => {
    const created = store.create({
      id: 's1', projectPath: '/p', sourceAgentId: 'a', sourceSessionId: 'a-s',
      targetAgentId: 'b', targetSessionId: 'b-s', targetBusyAtCreation: false, task: 't'
    })
    expect('sourceKind' in created).toBe(false)
    expect('planKey' in created).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/session-delegation-store.test.ts`
Expected: FAIL — TypeScript/esbuild accepts the extra keys but `created.sourceKind` is `undefined`.

- [ ] **Step 3: Create `src/shared/external-api-types.ts`**

```ts
import type { DelegationStatus } from './types'

export const EXTERNAL_SOURCE_ID = 'external:claude'
export const EXTERNAL_SOURCE_NAME = 'Claude (external)'

export function isExternalPeer(agentId: string): boolean {
  return agentId.startsWith('external:')
}

export interface CreateTaskBody {
  cwd: string
  planKey: string
  title?: string
  task: string
  sessionId?: string
}

export interface TaskDto {
  id: string
  status: DelegationStatus
  sessionId: string
  projectPath: string
  planKey: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  resultTruncated?: boolean
  error?: string
  touchedFiles: string[]
}

export interface ExternalApiStatus {
  enabled: boolean
  listening: boolean
  port: number | null
  error?: string
  cliPath: string | null
  configPath: string
}
```

- [ ] **Step 4: Extend `SessionDelegation` in `src/shared/types.ts`** — add after `wakeAt?: number`:

```ts
  sourceKind?: 'session' | 'external'
  externalClient?: 'claude'
  planKey?: string
```

- [ ] **Step 5: Extend the store** — in `src/main/session-delegation-store.ts`, add to `CreateDelegationRecord`:

```ts
  sourceKind?: 'session' | 'external'
  externalClient?: 'claude'
  planKey?: string
```

and in `create()`, after `updatedAt: now` inside the `record` literal:

```ts
      ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
      ...(input.externalClient !== undefined ? { externalClient: input.externalClient } : {}),
      ...(input.planKey !== undefined ? { planKey: input.planKey } : {})
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/session-delegation-store.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/external-api-types.ts src/shared/types.ts src/main/session-delegation-store.ts tests/unit/session-delegation-store.test.ts
git commit -m "feat(delegation): external source fields on delegation records"
```

---

### Task 2: Service support for external delegations and cancel

**Files:**
- Modify: `src/main/session-delegation-service.ts`
- Modify: `src/main/index.ts:246-259` (add `stopRun` to the runtime literal so typecheck passes)
- Test: `tests/unit/session-delegation-service.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `DelegationRuntime.stopRun(agentId: string): void`
  - `interface CreateExternalDelegationInput { projectPath: string; targetAgentId: string; task: string; planKey: string }`
  - `SessionDelegationService.createExternal(input: CreateExternalDelegationInput): SessionDelegation`
  - `SessionDelegationService.cancel(id: string): Promise<SessionDelegation>` — queued → cancelled; running/waiting → `runtime.stopRun(target)` and returns the current record (the run settles `cancelled` through the normal path); terminal → returned unchanged; unknown id → throws `[meow] Unknown delegation: <id>`.

- [ ] **Step 1: Write the failing tests** — in `tests/unit/session-delegation-service.test.ts`:

  a) Add to `FakeRuntime`:

```ts
  stopped: string[] = []
  cancelledRuns = new Set<string>()
  stopRun(agentId: string): void {
    this.stopped.push(agentId)
    for (const turn of this.turns.filter(t => t.targetAgentId === agentId)) {
      this.cancelledRuns.add(turn.delegationId)
      this.gates.get(turn.delegationId)?.release()
    }
  }
```

  and change the final `return` of the existing `FakeRuntime.runDelegatedTurn` (the non-preset branch, after `await this.gates.get(...)?.promise`) to:

```ts
    if (this.cancelledRuns.has(input.delegationId)) {
      return { runId: input.delegationId, reason: 'cancelled', touchedFiles: [] }
    }
    return { runId: input.delegationId, reason: 'completed', finalText: `done-${input.task}`, touchedFiles: ['/p/a.ts'] }
```

  b) Add a new `describe` block:

```ts
  describe('external delegations', () => {
    const ext = (over: Partial<{ projectPath: string; targetAgentId: string; task: string; planKey: string }> = {}) => ({
      projectPath: '/p', targetAgentId: 'beta', task: 'ext task', planKey: '/p/plan.md', ...over
    })

    it('creates a queued external record with the sentinel source', async () => {
      await env.service.start()
      env.runtime.gate('x')
      const rec = env.service.createExternal(ext())
      expect(rec.sourceKind).toBe('external')
      expect(rec.externalClient).toBe('claude')
      expect(rec.sourceAgentId).toBe('external:claude')
      expect(rec.sourceSessionId).toBe('external:claude')
      expect(rec.planKey).toBe('/p/plan.md')
    })

    it('runs without a resolvable source and passes the external display name', async () => {
      await env.service.start()
      const rec = env.service.createExternal(ext())
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect(env.runtime.turns[0].sourceName).toBe('Claude (external)')
      expect(env.runtime.turns[0].sourceAgentId).toBe('external:claude')
    })

    it('never appends a result or wakes a source, but marks delivered', async () => {
      await env.service.start()
      const rec = env.service.createExternal(ext())
      expect(await until(() => env.service.getStatus(rec.id)?.deliveredAt !== undefined)).toBe(true)
      expect(env.runtime.results).toHaveLength(0)
      expect(env.runtime.wakes).toHaveLength(0)
    })

    it('rejects an unknown target, a cross-project target, an empty task and an oversized task', async () => {
      await env.service.start()
      expect(() => env.service.createExternal(ext({ targetAgentId: 'nope' }))).toThrow(/does not exist/)
      expect(() => env.service.createExternal(ext({ projectPath: '/other' }))).toThrow(/project/)
      expect(() => env.service.createExternal(ext({ task: '  ' }))).toThrow(/empty/)
      expect(() => env.service.createExternal(ext({ task: 'x'.repeat(32 * 1024 + 1) }))).toThrow(/KiB/)
    })

    it('enforces the per-target nonterminal cap', async () => {
      env.runtime.busy.add('beta')
      await env.service.start()
      for (let i = 0; i < 5; i++) env.service.createExternal(ext({ task: `t${i}` }))
      expect(() => env.service.createExternal(ext({ task: 't5' }))).toThrow(/max 5/)
    })
  })

  describe('cancel', () => {
    it('cancels a queued delegation', async () => {
      env.runtime.busy.add('beta')
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      const out = await env.service.cancel(rec.id)
      expect(out.status).toBe('cancelled')
    })

    it('stops a running delegation through the runtime', async () => {
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      env.runtime.gate(rec.id)
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'running')).toBe(true)
      await env.service.cancel(rec.id)
      expect(env.runtime.stopped).toEqual(['beta'])
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'cancelled')).toBe(true)
    })

    it('returns a terminal record unchanged and throws for an unknown id', async () => {
      await env.service.start()
      const rec = env.service.createExternal({ projectPath: '/p', targetAgentId: 'beta', task: 't', planKey: 'k' })
      expect(await until(() => env.service.getStatus(rec.id)?.status === 'completed')).toBe(true)
      expect((await env.service.cancel(rec.id)).status).toBe('completed')
      await expect(env.service.cancel('missing')).rejects.toThrow(/Unknown delegation/)
    })
  })
```

  Note on the "stops a running delegation" test: `env.runtime.gate(rec.id)` must be registered before the pump reaches `runDelegatedTurn`. Because `createExternal` triggers the pump synchronously but `runDelegatedTurn` is reached only after an `await`, calling `gate()` on the line right after `createExternal` is sufficient. If it proves flaky, set `env.runtime.busy.add('beta')` first, then `gate`, then `busy.delete('beta')` + `env.service.notifyAgentAvailable('beta')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/session-delegation-service.test.ts`
Expected: FAIL — `createExternal` / `cancel` are not functions.

- [ ] **Step 3: Implement in `src/main/session-delegation-service.ts`**

  a) Imports: add

```ts
import { EXTERNAL_SOURCE_ID, EXTERNAL_SOURCE_NAME } from '../shared/external-api-types'
```

  b) `DelegationRuntime` gains `stopRun(agentId: string): void`.

  c) Add the input type after `CreateDelegationInput`:

```ts
export interface CreateExternalDelegationInput {
  projectPath: string
  targetAgentId: string
  task: string
  planKey: string
}
```

  d) Extract the task/cap validation used by `create()` into a private helper and use it from both creators. Replace the body of `create()` from `const task = ...` through the cap check with a call to it:

```ts
  private validateTask(rawTask: string, targetAgentId: string): string {
    const task = (rawTask ?? '').trim()
    if (!task) throw new Error('[meow] Delegation task must not be empty.')
    if (Buffer.byteLength(task, 'utf8') > TASK_MAX_BYTES) {
      throw new Error(`[meow] Delegation task exceeds the ${TASK_MAX_BYTES / 1024} KiB limit.`)
    }
    const active = this.store.list({ targetAgentId })
      .filter(d => d.status === 'queued' || d.status === 'running' || d.status === 'waiting_for_input')
    if (active.length >= MAX_NONTERMINAL_PER_TARGET) {
      throw new Error(`[meow] Too many queued delegations for this session (max ${MAX_NONTERMINAL_PER_TARGET}).`)
    }
    return task
  }
```

  In `create()`: `const task = this.validateTask(input.task, target.agentId)`.

  e) Add `createExternal` after `create()`:

```ts
  createExternal(input: CreateExternalDelegationInput): SessionDelegation {
    const target = this.runtime.resolveAgent(input.targetAgentId)
    if (!target) throw new Error(`[meow] Delegation target session does not exist: ${input.targetAgentId}`)
    if (normalizeProjectPath(target.projectPath) !== normalizeProjectPath(input.projectPath)) {
      throw new Error('[meow] Delegation target belongs to a different project.')
    }
    const task = this.validateTask(input.task, target.agentId)
    const record = this.store.create({
      id: this.id(),
      projectPath: target.projectPath,
      sourceAgentId: EXTERNAL_SOURCE_ID,
      sourceSessionId: EXTERNAL_SOURCE_ID,
      targetAgentId: target.agentId,
      targetSessionId: target.sessionId,
      targetBusyAtCreation: this.runtime.isBusy(target.agentId),
      task,
      sourceKind: 'external',
      externalClient: 'claude',
      planKey: input.planKey
    })
    this.emit(record)
    this.notifyAgentAvailable(target.agentId)
    return record
  }
```

  and import `normalizeProjectPath` from `./session-delegation-store`.

  f) In `driveTarget`, only check the source for session-kind records. Replace the `const source = ...` block with:

```ts
        if (next.sourceKind !== 'external') {
          const source = this.runtime.resolveAgent(next.sourceAgentId)
          if (!source || source.projectPath !== target.projectPath) {
            const failed = this.store.transition(next.id, next.revision, 'failed', {
              finishedAt: this.now(),
              error: '[meow] A participant session is no longer available.'
            })
            if (failed) this.emit(failed)
            continue
          }
        }
```

  g) In `runQueued`, the `sourceName` becomes:

```ts
      sourceName: running.sourceKind === 'external'
        ? EXTERNAL_SOURCE_NAME
        : this.runtime.resolveAgent(running.sourceAgentId)?.name ?? running.sourceAgentId,
```

  h) At the top of `finishTerminal`:

```ts
    if (record.sourceKind === 'external') {
      const delivered = this.store.markDelivered(record.id, record.revision, this.now())
      if (delivered) this.emit(delivered)
      return
    }
```

  i) Add `cancel` next to `cancelQueued`:

```ts
  async cancel(id: string): Promise<SessionDelegation> {
    const record = this.store.get(id)
    if (!record) throw new Error(`[meow] Unknown delegation: ${id}`)
    if (record.status === 'queued') return this.cancelQueued(id)
    if (record.status === 'running' || record.status === 'waiting_for_input') {
      this.runtime.stopRun(record.targetAgentId)
    }
    return this.store.get(id) ?? record
  }
```

- [ ] **Step 4: Keep the app compiling** — in `src/main/index.ts`, add to the `runtime` literal of `new SessionDelegationService({...})`:

```ts
      stopRun: (agentId) => this.meowAgent.stop(agentId),
```

  Also add `stopRun(): void {}` to any other `DelegationRuntime` fakes: run `npx tsc --noEmit -p tsconfig.node.json` and fix each reported fake (expected: `tests/unit/meow-agent-manager-delegation.test.ts` or none, depending on whether it implements the interface).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/session-delegation-service.test.ts tests/unit/session-delegation-store.test.ts`
Expected: PASS (existing tests included — the `create()` refactor must not change any existing message).

- [ ] **Step 6: Commit**

```bash
git add src/main/session-delegation-service.ts src/main/index.ts tests/unit/session-delegation-service.test.ts
git commit -m "feat(delegation): external delegations and cancel of running work"
```

---

### Task 3: Config file

**Files:**
- Create: `src/main/external-api/config-file.ts`
- Test: `tests/unit/external-api-config-file.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExternalApiConfig { enabled: boolean; port: number | null; token: string; cliPath: string | null }
export class ExternalApiConfigFile {
  constructor(filePath: string, randomToken?: () => string)
  readonly filePath: string
  load(): ExternalApiConfig          // creates + persists a token when missing/corrupt
  update(patch: Partial<Omit<ExternalApiConfig, 'token'>>): ExternalApiConfig
  regenerateToken(): ExternalApiConfig
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalApiConfigFile } from '../../src/main/external-api/config-file'

describe('ExternalApiConfigFile', () => {
  let dir: string
  let file: string
  let n = 0
  const token = () => `tok${++n}`.padEnd(64, '0')
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-extcfg-')); file = path.join(dir, 'external-api.json'); n = 0 })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a disabled config with a persisted token on first load', () => {
    const cfg = new ExternalApiConfigFile(file, token).load()
    expect(cfg).toEqual({ enabled: false, port: null, token: 'tok1'.padEnd(64, '0'), cliPath: null })
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe(cfg.token)
  })

  it('keeps the token across instances', () => {
    const a = new ExternalApiConfigFile(file, token).load()
    const b = new ExternalApiConfigFile(file, token).load()
    expect(b.token).toBe(a.token)
  })

  it('update merges fields without touching the token', () => {
    const f = new ExternalApiConfigFile(file, token)
    const before = f.load()
    const after = f.update({ enabled: true, port: 3929, cliPath: '/u/bin/meow-delegate.mjs' })
    expect(after).toEqual({ ...before, enabled: true, port: 3929, cliPath: '/u/bin/meow-delegate.mjs' })
  })

  it('regenerateToken replaces the token', () => {
    const f = new ExternalApiConfigFile(file, token)
    const before = f.load()
    expect(f.regenerateToken().token).not.toBe(before.token)
  })

  it('recovers from a corrupt file', () => {
    writeFileSync(file, '{not json')
    expect(new ExternalApiConfigFile(file, token).load().enabled).toBe(false)
  })

  it('defaults the token generator to 64 hex chars', () => {
    expect(new ExternalApiConfigFile(file).load().token).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/external-api-config-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/external-api/config-file.ts`**

```ts
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '../atomic-write'

export interface ExternalApiConfig {
  enabled: boolean
  port: number | null
  token: string
  cliPath: string | null
}

const defaultToken = (): string => randomBytes(32).toString('hex')

export class ExternalApiConfigFile {
  constructor(readonly filePath: string, private randomToken: () => string = defaultToken) {}

  load(): ExternalApiConfig {
    let raw: Partial<ExternalApiConfig> = {}
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ExternalApiConfig>
    } catch {
      raw = {}
    }
    const cfg: ExternalApiConfig = {
      enabled: raw.enabled === true,
      port: typeof raw.port === 'number' ? raw.port : null,
      token: typeof raw.token === 'string' && raw.token.length >= 32 ? raw.token : this.randomToken(),
      cliPath: typeof raw.cliPath === 'string' ? raw.cliPath : null
    }
    if (cfg.token !== raw.token) this.write(cfg)
    return cfg
  }

  update(patch: Partial<Omit<ExternalApiConfig, 'token'>>): ExternalApiConfig {
    const next = { ...this.load(), ...patch }
    this.write(next)
    return next
  }

  regenerateToken(): ExternalApiConfig {
    const next = { ...this.load(), token: this.randomToken() }
    this.write(next)
    return next
  }

  private write(cfg: ExternalApiConfig): void {
    writeFileAtomic(this.filePath, JSON.stringify(cfg, null, 2))
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/external-api-config-file.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/external-api/config-file.ts tests/unit/external-api-config-file.test.ts
git commit -m "feat(external-api): connection/config file with persistent token"
```

---

### Task 4: HTTP server

**Files:**
- Create: `src/main/external-api/errors.ts`
- Create: `src/main/external-api/server.ts`
- Test: `tests/unit/external-api-server.test.ts`

**Interfaces:**
- Consumes: `TaskDto`, `CreateTaskBody` (Task 1).
- Produces:

```ts
// errors.ts
export class ExternalApiError extends Error { constructor(readonly status: number, message: string) }

// server.ts
export interface ExternalApiHandler {
  version(): string
  createTask(body: CreateTaskBody): Promise<TaskDto>
  getTask(id: string): TaskDto | undefined
  cancelTask(id: string): Promise<TaskDto>
}
export interface ExternalApiServerDeps {
  handler: ExternalApiHandler
  getToken: () => string
  host?: string            // default '127.0.0.1'
  preferredPort?: number   // default 3929
  maxWaitMs?: number       // default 120_000
}
export class ExternalApiServer {
  constructor(deps: ExternalApiServerDeps)
  start(): Promise<number>          // returns the bound port; falls back to port 0 on EADDRINUSE
  stop(): Promise<void>             // resolves pending waits with done=false, closes the server
  notifyChanged(taskId: string): void
  get port(): number | null
}
export const TERMINAL_STATUSES: ReadonlySet<string>
```

- [ ] **Step 1: Write the failing test** — `tests/unit/external-api-server.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createServer } from 'node:net'
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
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/external-api-server.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/external-api/errors.ts`**

```ts
export class ExternalApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ExternalApiError'
  }
}
```

- [ ] **Step 4: Implement `src/main/external-api/server.ts`**

```ts
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
    const server = createServer((req, res) => { void this.handle(req, res) })
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
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  notifyChanged(taskId: string): void {
    const task = this.deps.handler.getTask(taskId)
    if (!task || !TERMINAL_STATUSES.has(task.status)) return
    for (const w of [...this.waiters]) if (w.taskId === taskId) w.finish(true)
  }

  private listen(server: Server, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => { server.removeListener('listening', onListening); reject(err) }
      const onListening = () => { server.removeListener('error', onError); resolve() }
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
    await new Promise<void>(resolve => {
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
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/unit/external-api-server.test.ts` → PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/external-api/errors.ts src/main/external-api/server.ts tests/unit/external-api-server.test.ts
git commit -m "feat(external-api): loopback HTTP server with token auth and long-poll wait"
```

---

### Task 5: Manager `ensureAgent`

**Files:**
- Modify: `src/main/meow-agent-manager.ts` (next to `addAgent`, ~`:399`)
- Test: `tests/unit/meow-agent-manager-delegation.test.ts`

**Interfaces:**
- Produces: `MeowAgentManager.ensureAgent(agent: AgentConfig): Promise<void>` — registers a native agent if it is not registered yet and awaits registration; no-op for an already-registered id. Unlike `addAgent`, it does not consume the draft model.

- [ ] **Step 1: Write the failing test** — in `tests/unit/meow-agent-manager-delegation.test.ts`, reuse the file's existing manager factory (read the top of the file first; it builds a `MeowAgentManager` with a stub LLM and a temp store). Add:

```ts
  it('ensureAgent registers an unknown native agent so it becomes resolvable', async () => {
    const agent = { id: 'ext-1', name: '[claude] plan', templateId: 'meow', cwd: projectDir, kind: 'native' as const }
    expect(manager.resolveDelegationAgent('ext-1')).toBeUndefined()
    await manager.ensureAgent(agent)
    expect(manager.resolveDelegationAgent('ext-1')?.name).toBe('[claude] plan')
    await manager.ensureAgent(agent)
    expect(manager.listAgents().filter(a => a.id === 'ext-1')).toHaveLength(1)
  })
```

  Replace `manager` / `projectDir` with the variable names the file already uses for the manager instance and the temp project directory.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/meow-agent-manager-delegation.test.ts` → FAIL (`ensureAgent` is not a function).

- [ ] **Step 3: Implement** — add after `addAgent`:

```ts
  async ensureAgent(agent: AgentConfig): Promise<void> {
    if (agent.kind !== 'native' || this.agents.has(agent.id)) return
    await this.register(agent)
  }
```

- [ ] **Step 4: Run tests** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meow-agent-manager.ts tests/unit/meow-agent-manager-delegation.test.ts
git commit -m "feat(agent): ensureAgent awaits registration of a native session"
```

---

### Task 6: Facade

**Files:**
- Create: `src/main/external-api/facade.ts`
- Test: `tests/unit/external-delegation-facade.test.ts`

**Interfaces:**
- Consumes: `ExternalApiHandler`, `ExternalApiError` (Task 4); `SessionDelegationService.createExternal/cancel/getStatus/getStore` (Task 2); `normalizeProjectPath` from `session-delegation-store`; `EXTERNAL_SOURCE_ID`, `TaskDto`, `CreateTaskBody` (Task 1).
- Produces:

```ts
export interface ExternalDelegationFacadeDeps {
  workspaces: { load(): Workspace[]; add(projectPath: string, name: string): Workspace; addAgent(projectPath: string, input: NewAgentInput): Workspace }
  ensureAgent(agent: AgentConfig): Promise<void>
  delegations: Pick<SessionDelegationService, 'createExternal' | 'cancel' | 'getStatus' | 'getStore'>
  isDirectory(p: string): boolean
  onWorkspaceChanged(ws: Workspace): void
  version: string
}
export class ExternalDelegationFacade implements ExternalApiHandler
export function toTaskDto(d: SessionDelegation): TaskDto
```

Behavior:
- `createTask({ cwd, planKey, title?, task })`: `cwd` → `path.resolve(cwd)`; 400 if `!isDirectory`. Workspace found by `normalizeProjectPath` equality over `workspaces.load()`; else `workspaces.add(resolvedCwd, path.basename(resolvedCwd))` + `onWorkspaceChanged`. `planKeyNorm = normalizeProjectPath(path.resolve(resolvedCwd, planKey))`. Reuse the target of the newest (`createdAt` desc) external record in that project with that `planKey` whose agent is still in `ws.agents`; else `workspaces.addAgent(ws.projectPath, { name: `[claude] ${title ?? basename-without-ext(planKey)}`, templateId: 'meow', cwd: ws.projectPath, kind: 'native' })` + `onWorkspaceChanged`. Then `await ensureAgent(agentConfig)` and `createExternal({ projectPath: ws.projectPath, targetAgentId, task, planKey: planKeyNorm })`.
- `createTask({ sessionId, task, ... })`: newest external record with `targetAgentId === sessionId` → reuse its `projectPath` + `planKey`; 404 `[meow] Unknown external session: <id>` if none or the agent is gone from the workspace.
- Service `Error`s → `ExternalApiError(400, message)`.
- `getTask(id)`: only external records (`sourceKind === 'external'`), else `undefined`.
- `cancelTask(id)`: 404 unless an external record; returns `toTaskDto(await cancel(id))`.

- [ ] **Step 1: Write the failing test** — `tests/unit/external-delegation-facade.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import path from 'node:path'
import { ExternalDelegationFacade, type ExternalDelegationFacadeDeps } from '../../src/main/external-api/facade'
import { ExternalApiError } from '../../src/main/external-api/errors'
import type { AgentConfig, NewAgentInput, SessionDelegation, Workspace } from '../../src/shared/types'

const ROOT = path.resolve('/repo')

class FakeDelegations {
  records: SessionDelegation[] = []
  n = 0
  createExternal(input: { projectPath: string; targetAgentId: string; task: string; planKey: string }): SessionDelegation {
    if (input.task.includes('bad')) throw new Error('[meow] Delegation task must not be empty.')
    const rec: SessionDelegation = {
      id: `d${++this.n}`, projectPath: input.projectPath, sourceAgentId: 'external:claude', sourceSessionId: 'external:claude',
      targetAgentId: input.targetAgentId, targetSessionId: `${input.targetAgentId}-s`, task: input.task, status: 'queued',
      revision: 1, targetBusyAtCreation: false, createdAt: this.n, updatedAt: this.n,
      sourceKind: 'external', externalClient: 'claude', planKey: input.planKey
    }
    this.records.push(rec)
    return rec
  }
  async cancel(id: string) { const r = this.records.find(x => x.id === id)!; r.status = 'cancelled'; return { ...r } }
  getStatus(id: string) { return this.records.find(r => r.id === id) }
  getStore() { return { list: (f?: { projectPath?: string }) => this.records.filter(r => !f?.projectPath || r.projectPath === f.projectPath) } }
}

function setup(existing: Workspace[] = []) {
  const workspaces = [...existing]
  const ensured: string[] = []
  const changed: string[] = []
  const delegations = new FakeDelegations()
  let agentN = 0
  const deps: ExternalDelegationFacadeDeps = {
    workspaces: {
      load: () => workspaces,
      add: (projectPath, name) => { const ws = { projectPath, name, agents: [] as AgentConfig[] }; workspaces.push(ws); return ws },
      addAgent: (projectPath, input: NewAgentInput) => {
        const ws = workspaces.find(w => w.projectPath === projectPath)!
        ws.agents.push({ id: `a${++agentN}`, ...input })
        return ws
      }
    },
    ensureAgent: async (a) => { ensured.push(a.id) },
    delegations: delegations as unknown as ExternalDelegationFacadeDeps['delegations'],
    isDirectory: (p) => p !== path.resolve('/missing'),
    onWorkspaceChanged: (ws) => { changed.push(ws.projectPath) },
    version: '1.2.3'
  }
  return { facade: new ExternalDelegationFacade(deps), workspaces, ensured, changed, delegations }
}

describe('ExternalDelegationFacade', () => {
  let env: ReturnType<typeof setup>
  beforeEach(() => { env = setup() })

  it('auto-adds the project and creates a [claude] session named after the plan', async () => {
    const task = await env.facade.createTask({ cwd: ROOT, planKey: 'docs/plans/2026-x-feature.md', task: 'T1' })
    expect(env.workspaces).toHaveLength(1)
    expect(env.workspaces[0].agents[0].name).toBe('[claude] 2026-x-feature')
    expect(env.ensured).toEqual(['a1'])
    expect(env.changed.length).toBeGreaterThanOrEqual(1)
    expect(task.sessionId).toBe('a1')
    expect(task.status).toBe('queued')
  })

  it('uses the title when given', async () => {
    await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', title: 'My plan', task: 'T1' })
    expect(env.workspaces[0].agents[0].name).toBe('[claude] My plan')
  })

  it('reuses the session for the same plan and creates a new one for another plan', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const b = await env.facade.createTask({ cwd: ROOT, planKey: './p.md', task: 'T2' })
    const c = await env.facade.createTask({ cwd: ROOT, planKey: 'q.md', task: 'T3' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(c.sessionId).not.toBe(a.sessionId)
  })

  it('creates a new session when the previous one was removed', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    env.workspaces[0].agents = []
    const b = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T2' })
    expect(b.sessionId).not.toBe(a.sessionId)
  })

  it('matches an existing workspace regardless of path style', async () => {
    const e = setup([{ projectPath: ROOT, name: 'repo', agents: [] }])
    await e.facade.createTask({ cwd: ROOT + path.sep, planKey: 'p.md', task: 'T1' })
    expect(e.workspaces).toHaveLength(1)
  })

  it('send queues into the same session with the same plan key', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    const b = await env.facade.createTask({ cwd: ROOT, planKey: '', sessionId: a.sessionId, task: 'fix it' })
    expect(b.sessionId).toBe(a.sessionId)
    expect(b.planKey).toBe(a.planKey)
  })

  it('send to an unknown session is a 404', async () => {
    await expect(env.facade.createTask({ cwd: ROOT, planKey: '', sessionId: 'zzz', task: 'x' }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('a missing cwd is a 400', async () => {
    await expect(env.facade.createTask({ cwd: '/missing', planKey: 'p.md', task: 'x' }))
      .rejects.toBeInstanceOf(ExternalApiError)
  })

  it('maps service validation errors to 400', async () => {
    await expect(env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'bad' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('getTask and cancelTask only expose external records', async () => {
    const a = await env.facade.createTask({ cwd: ROOT, planKey: 'p.md', task: 'T1' })
    env.delegations.records.push({ ...env.delegations.records[0], id: 'internal', sourceKind: undefined })
    expect(env.facade.getTask(a.id)?.id).toBe(a.id)
    expect(env.facade.getTask('internal')).toBeUndefined()
    await expect(env.facade.cancelTask('internal')).rejects.toMatchObject({ status: 404 })
    expect((await env.facade.cancelTask(a.id)).status).toBe('cancelled')
  })

  it('reports the version', () => {
    expect(env.facade.version()).toBe('1.2.3')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/external-delegation-facade.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/external-api/facade.ts`**

```ts
import path from 'node:path'
import type { AgentConfig, NewAgentInput, SessionDelegation, Workspace } from '../../shared/types'
import type { CreateTaskBody, TaskDto } from '../../shared/external-api-types'
import type { SessionDelegationService } from '../session-delegation-service'
import { normalizeProjectPath } from '../session-delegation-store'
import { ExternalApiError } from './errors'
import type { ExternalApiHandler } from './server'

export interface ExternalDelegationFacadeDeps {
  workspaces: {
    load(): Workspace[]
    add(projectPath: string, name: string): Workspace
    addAgent(projectPath: string, input: NewAgentInput): Workspace
  }
  ensureAgent(agent: AgentConfig): Promise<void>
  delegations: Pick<SessionDelegationService, 'createExternal' | 'cancel' | 'getStatus' | 'getStore'>
  isDirectory(p: string): boolean
  onWorkspaceChanged(ws: Workspace): void
  version: string
}

export function toTaskDto(d: SessionDelegation): TaskDto {
  return {
    id: d.id,
    status: d.status,
    sessionId: d.targetAgentId,
    projectPath: d.projectPath,
    planKey: d.planKey ?? '',
    createdAt: d.createdAt,
    ...(d.startedAt !== undefined ? { startedAt: d.startedAt } : {}),
    ...(d.finishedAt !== undefined ? { finishedAt: d.finishedAt } : {}),
    ...(d.result !== undefined ? { result: d.result } : {}),
    ...(d.resultTruncated ? { resultTruncated: true } : {}),
    ...(d.error !== undefined ? { error: d.error } : {}),
    touchedFiles: d.touchedFiles ?? []
  }
}

export class ExternalDelegationFacade implements ExternalApiHandler {
  constructor(private deps: ExternalDelegationFacadeDeps) {}

  version(): string {
    return this.deps.version
  }

  async createTask(body: CreateTaskBody): Promise<TaskDto> {
    const { ws, agent, planKey } = body.sessionId !== undefined
      ? this.resolveSession(body.sessionId)
      : this.resolvePlanSession(body)
    await this.deps.ensureAgent(agent)
    try {
      const rec = this.deps.delegations.createExternal({
        projectPath: ws.projectPath,
        targetAgentId: agent.id,
        task: body.task,
        planKey
      })
      return toTaskDto(rec)
    } catch (err) {
      throw new ExternalApiError(400, err instanceof Error ? err.message : String(err))
    }
  }

  getTask(id: string): TaskDto | undefined {
    const rec = this.deps.delegations.getStatus(id)
    return rec && rec.sourceKind === 'external' ? toTaskDto(rec) : undefined
  }

  async cancelTask(id: string): Promise<TaskDto> {
    if (!this.getTask(id)) throw new ExternalApiError(404, `[meow] Unknown task: ${id}`)
    return toTaskDto(await this.deps.delegations.cancel(id))
  }

  private externalRecords(projectPath?: string): SessionDelegation[] {
    return this.deps.delegations.getStore()
      .list(projectPath ? { projectPath } : undefined)
      .filter(d => d.sourceKind === 'external')
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  private resolveSession(sessionId: string): { ws: Workspace; agent: AgentConfig; planKey: string } {
    const rec = this.externalRecords().find(d => d.targetAgentId === sessionId)
    const ws = rec && this.findWorkspace(rec.projectPath)
    const agent = ws?.agents.find(a => a.id === sessionId)
    if (!rec || !ws || !agent) throw new ExternalApiError(404, `[meow] Unknown external session: ${sessionId}`)
    return { ws, agent, planKey: rec.planKey ?? '' }
  }

  private resolvePlanSession(body: CreateTaskBody): { ws: Workspace; agent: AgentConfig; planKey: string } {
    const cwd = path.resolve(body.cwd)
    if (!this.deps.isDirectory(cwd)) throw new ExternalApiError(400, `[meow] cwd does not exist: ${body.cwd}`)
    let ws = this.findWorkspace(cwd)
    if (!ws) {
      ws = this.deps.workspaces.add(cwd, path.basename(cwd))
      this.deps.onWorkspaceChanged(ws)
    }
    const planKey = normalizeProjectPath(path.resolve(cwd, body.planKey))
    const reused = this.externalRecords(ws.projectPath)
      .filter(d => d.planKey === planKey)
      .map(d => ws!.agents.find(a => a.id === d.targetAgentId))
      .find((a): a is AgentConfig => a !== undefined)
    if (reused) return { ws, agent: reused, planKey }
    const title = body.title?.trim() || path.basename(body.planKey, path.extname(body.planKey)) || 'plan'
    const updated = this.deps.workspaces.addAgent(ws.projectPath, {
      name: `[claude] ${title}`,
      templateId: 'meow',
      cwd: ws.projectPath,
      kind: 'native'
    })
    this.deps.onWorkspaceChanged(updated)
    return { ws: updated, agent: updated.agents[updated.agents.length - 1], planKey }
  }

  private findWorkspace(projectPath: string): Workspace | undefined {
    const key = normalizeProjectPath(path.resolve(projectPath))
    return this.deps.workspaces.load().find(w => normalizeProjectPath(path.resolve(w.projectPath)) === key)
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/unit/external-delegation-facade.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/external-api/facade.ts tests/unit/external-delegation-facade.test.ts
git commit -m "feat(external-api): facade resolving projects and per-plan sessions"
```

---

### Task 7: CLI

**Files:**
- Create: `resources/external-api/meow-delegate.mjs`
- Test: `tests/integration/external-api-cli.test.ts`

**Interfaces:**
- Consumes: HTTP API (Task 4) and `external-api.json` shape (Task 3).
- Produces: the command line in Global Constraints; the result block below; exit codes.

Result block (exact):

```
=== MEOW TASK RESULT ===
task: <id>   session: <sessionId>   status: <status>
touched_files:
- <path>            (or "(none)")
--- final answer ---
<result, else error, else "(no output)">
```

`--no-wait` prints `queued: <id>   session: <sessionId>` and exits 0.

- [ ] **Step 1: Write the failing test** — `tests/integration/external-api-cli.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalApiServer, type ExternalApiHandler } from '../../src/main/external-api/server'
import type { CreateTaskBody, TaskDto } from '../../src/shared/external-api-types'

const CLI = path.resolve('resources/external-api/meow-delegate.mjs')
const TOKEN = 'b'.repeat(64)

function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, MEOW_DELEGATE_RETRY_MS: '300' } })
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
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/integration/external-api-cli.test.ts` → FAIL (CLI file missing, exit code ≠ expected).

- [ ] **Step 3: Implement `resources/external-api/meow-delegate.mjs`**

```js
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
  return cfg
}

async function request(cfg, method, route, body) {
  const deadline = Date.now() + RETRY_MS
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
      continue
    }
    const json = await res.json().catch(() => ({}))
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
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/integration/external-api-cli.test.ts` → PASS. If the "wrong token" test fails because `stop()`+`start()` on the same instance is not supported, change that test to create a second `ExternalApiServer` with `getToken: () => TOKEN` instead.

- [ ] **Step 5: Commit**

```bash
git add resources/external-api/meow-delegate.mjs tests/integration/external-api-cli.test.ts
git commit -m "feat(external-api): meow-delegate CLI that blocks until a task ends"
```

---

### Task 8: Claude skill template and installer

**Files:**
- Create: `resources/external-api/claude-skill.md`
- Create: `src/main/external-api/claude-skill.ts`
- Test: `tests/unit/external-api-claude-skill.test.ts`

**Interfaces:**
- Produces: `installClaudeSkill(opts: { templatePath: string; cliPath: string; skillsDir: string }): string` — renders `{{CLI_PATH}}` (with forward slashes) into the template, writes `<skillsDir>/meow-delegate/SKILL.md` atomically, returns the written path.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installClaudeSkill } from '../../src/main/external-api/claude-skill'

describe('installClaudeSkill', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-skill-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes SKILL.md with the CLI path substituted using forward slashes', () => {
    const out = installClaudeSkill({
      templatePath: path.resolve('resources/external-api/claude-skill.md'),
      cliPath: 'C:\\Users\\me\\AppData\\Roaming\\Meow Coding\\bin\\meow-delegate.mjs',
      skillsDir: dir
    })
    expect(out).toBe(path.join(dir, 'meow-delegate', 'SKILL.md'))
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^---\nname: meow-delegate\n/)
    expect(text).toContain('node "C:/Users/me/AppData/Roaming/Meow Coding/bin/meow-delegate.mjs"')
    expect(text).not.toContain('{{CLI_PATH}}')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/external-api-claude-skill.test.ts` → FAIL.

- [ ] **Step 3: Create `resources/external-api/claude-skill.md`**

````markdown
---
name: meow-delegate
description: Use when a written implementation plan exists and the user wants Meow (the local Meow Coding app) to execute its tasks — delegates one task at a time, waits in the background, then verifies Meow's work before moving on.
---

# Delegate plan tasks to Meow

Meow is a local coding agent app. This skill hands one plan task at a time to a Meow session,
lets Claude Code wake you when Meow finishes, and makes you verify the result yourself.

CLI: `node "{{CLI_PATH}}"`

## Per task

1. Write the task to a temp file in your scratchpad: the full task text from the plan, the plan
   path, the files it touches, and the exact verification commands the plan lists.
2. Run with the Bash tool and `run_in_background: true`:
   ```bash
   node "{{CLI_PATH}}" start --cwd "<repo root>" --plan "<plan path relative to repo>" --title "<plan title>" --task-file "<temp file>"
   ```
   The first task of a plan creates a Meow session named `[claude] <title>`; later tasks and
   feedback go to the same session.
3. Do not edit any file in that task's scope while it runs. You may read files or plan ahead.
4. You are re-invoked when the command exits. Read its output block:
   `task`, `session`, `status`, `touched_files`, `final answer`.
   - Exit 3: Meow is not open or external delegation is disabled. Tell the user to open Meow and
     enable Settings → External delegation, then stop.
   - Exit 2: the task was cancelled. Ask the user how to proceed.
   - Exit 4: fix your command (bad path or argument) and retry once.
5. Verify independently — never trust the final answer alone:
   - `git diff` on the touched files and compare against the task's requirements.
   - Run the plan's verification commands (tests, typecheck) yourself.
6. If verification fails, write concrete feedback (what is wrong, file:line, failing output) to a
   temp file and run in the background:
   ```bash
   node "{{CLI_PATH}}" send --session "<session id>" --message-file "<feedback file>"
   ```
   At most 3 feedback rounds per task; after that, stop and ask the user.
7. When the task verifies, move to the next task. When all tasks are done, summarize what Meow
   changed and what you verified.

## Other commands

- `node "{{CLI_PATH}}" status <taskId>` — current status.
- `node "{{CLI_PATH}}" cancel <taskId>` — stop a task.

Meow may pause for permission approval; the user approves it in the Meow app. Keep waiting — the
background command does not exit until the task ends.
````

- [ ] **Step 4: Implement `src/main/external-api/claude-skill.ts`**

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../atomic-write'

export function installClaudeSkill(opts: { templatePath: string; cliPath: string; skillsDir: string }): string {
  const template = readFileSync(opts.templatePath, 'utf8')
  const rendered = template.replaceAll('{{CLI_PATH}}', opts.cliPath.replace(/\\/g, '/'))
  const target = path.join(opts.skillsDir, 'meow-delegate', 'SKILL.md')
  writeFileAtomic(target, rendered)
  return target
}
```

- [ ] **Step 5: Run tests** → PASS

- [ ] **Step 6: Commit**

```bash
git add resources/external-api/claude-skill.md src/main/external-api/claude-skill.ts tests/unit/external-api-claude-skill.test.ts
git commit -m "feat(external-api): Claude skill template and installer"
```

---

### Task 9: Lifecycle manager

**Files:**
- Create: `src/main/external-api/manager.ts`
- Test: `tests/unit/external-api-manager.test.ts`

**Interfaces:**
- Consumes: `ExternalApiConfigFile` (Task 3), `ExternalApiServer` + `ExternalApiHandler` (Task 4), `installClaudeSkill` (Task 8), `ExternalApiStatus` (Task 1).
- Produces:

```ts
export interface ExternalApiManagerDeps {
  config: ExternalApiConfigFile
  handler: ExternalApiHandler
  cliSource: string        // resources/external-api/meow-delegate.mjs
  skillTemplate: string    // resources/external-api/claude-skill.md
  binDir: string           // <userData>/bin
  claudeSkillsDir: string  // ~/.claude/skills
  preferredPort?: number
  onStatus?: (s: ExternalApiStatus) => void
  log?: (msg: string) => void
}
export class ExternalApiManager {
  start(): Promise<void>                       // on app ready: installs CLI; listens if enabled
  stop(): Promise<void>                        // on quit
  setEnabled(enabled: boolean): Promise<ExternalApiStatus>
  regenerateToken(): ExternalApiStatus
  installClaudeSkill(): string
  getStatus(): ExternalApiStatus
  notifyChanged(taskId: string): void
}
```

Behavior: `start()` copies `cliSource` → `<binDir>/meow-delegate.mjs` (mkdir -p) and records `cliPath`; if `enabled`, starts the server and records `port`. A listen failure is caught, stored as `error`, logged, and never thrown. `setEnabled(false)` stops the server and sets `port: null`. The server reads the token through `() => config.load().token`, so regeneration applies to the next request without a restart.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalApiManager } from '../../src/main/external-api/manager'
import { ExternalApiConfigFile } from '../../src/main/external-api/config-file'
import type { ExternalApiHandler } from '../../src/main/external-api/server'

const handler: ExternalApiHandler = {
  version: () => '1',
  createTask: async () => { throw new Error('unused') },
  getTask: () => undefined,
  cancelTask: async () => { throw new Error('unused') }
}

describe('ExternalApiManager', () => {
  let dir: string
  let config: ExternalApiConfigFile
  let mgr: ExternalApiManager
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-extmgr-'))
    config = new ExternalApiConfigFile(path.join(dir, 'external-api.json'))
    mgr = new ExternalApiManager({
      config, handler,
      cliSource: path.resolve('resources/external-api/meow-delegate.mjs'),
      skillTemplate: path.resolve('resources/external-api/claude-skill.md'),
      binDir: path.join(dir, 'bin'),
      claudeSkillsDir: path.join(dir, 'claude-skills'),
      preferredPort: 0
    })
  })
  afterEach(async () => { await mgr.stop(); rmSync(dir, { recursive: true, force: true }) })

  it('installs the CLI on start and stays off by default', async () => {
    await mgr.start()
    const s = mgr.getStatus()
    expect(s.enabled).toBe(false)
    expect(s.listening).toBe(false)
    expect(s.cliPath).toBe(path.join(dir, 'bin', 'meow-delegate.mjs'))
    expect(existsSync(s.cliPath!)).toBe(true)
    expect(config.load().cliPath).toBe(s.cliPath)
  })

  it('enabling starts the server and records the port; disabling stops it', async () => {
    await mgr.start()
    const on = await mgr.setEnabled(true)
    expect(on.listening).toBe(true)
    expect(on.port).toBeGreaterThan(0)
    expect(config.load()).toMatchObject({ enabled: true, port: on.port })
    const token = config.load().token
    const res = await fetch(`http://127.0.0.1:${on.port}/v1/health`, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const off = await mgr.setEnabled(false)
    expect(off.listening).toBe(false)
    expect(config.load()).toMatchObject({ enabled: false, port: null })
  })

  it('starts listening on start when previously enabled', async () => {
    config.update({ enabled: true })
    await mgr.start()
    expect(mgr.getStatus().listening).toBe(true)
  })

  it('regenerated tokens apply to the next request', async () => {
    await mgr.start()
    const { port } = await mgr.setEnabled(true)
    const old = config.load().token
    mgr.regenerateToken()
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { authorization: `Bearer ${old}` } })
    expect(res.status).toBe(401)
  })

  it('installs the Claude skill pointing at the installed CLI', async () => {
    await mgr.start()
    const out = mgr.installClaudeSkill()
    expect(readFileSync(out, 'utf8')).toContain(mgr.getStatus().cliPath!.replace(/\\/g, '/'))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/external-api-manager.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/main/external-api/manager.ts`**

```ts
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ExternalApiStatus } from '../../shared/external-api-types'
import type { ExternalApiConfigFile } from './config-file'
import { ExternalApiServer, type ExternalApiHandler } from './server'
import { installClaudeSkill } from './claude-skill'

export interface ExternalApiManagerDeps {
  config: ExternalApiConfigFile
  handler: ExternalApiHandler
  cliSource: string
  skillTemplate: string
  binDir: string
  claudeSkillsDir: string
  preferredPort?: number
  onStatus?: (s: ExternalApiStatus) => void
  log?: (msg: string) => void
}

export class ExternalApiManager {
  private server: ExternalApiServer | null = null
  private error: string | undefined
  private cliPath: string | null = null

  constructor(private deps: ExternalApiManagerDeps) {}

  async start(): Promise<void> {
    this.installCli()
    if (this.deps.config.load().enabled) await this.listen()
    this.emit()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    await server?.stop()
  }

  async setEnabled(enabled: boolean): Promise<ExternalApiStatus> {
    this.deps.config.update({ enabled })
    if (enabled) await this.listen()
    else {
      await this.stop()
      this.error = undefined
      this.deps.config.update({ port: null })
    }
    this.emit()
    return this.getStatus()
  }

  regenerateToken(): ExternalApiStatus {
    this.deps.config.regenerateToken()
    this.emit()
    return this.getStatus()
  }

  installClaudeSkill(): string {
    if (!this.cliPath) this.installCli()
    return installClaudeSkill({
      templatePath: this.deps.skillTemplate,
      cliPath: this.cliPath!,
      skillsDir: this.deps.claudeSkillsDir
    })
  }

  getStatus(): ExternalApiStatus {
    const cfg = this.deps.config.load()
    return {
      enabled: cfg.enabled,
      listening: this.server !== null,
      port: this.server?.port ?? null,
      ...(this.error ? { error: this.error } : {}),
      cliPath: this.cliPath ?? cfg.cliPath,
      configPath: this.deps.config.filePath
    }
  }

  notifyChanged(taskId: string): void {
    this.server?.notifyChanged(taskId)
  }

  private installCli(): void {
    mkdirSync(this.deps.binDir, { recursive: true })
    const target = path.join(this.deps.binDir, 'meow-delegate.mjs')
    copyFileSync(this.deps.cliSource, target)
    this.cliPath = target
    this.deps.config.update({ cliPath: target })
  }

  private async listen(): Promise<void> {
    if (this.server) return
    const server = new ExternalApiServer({
      handler: this.deps.handler,
      getToken: () => this.deps.config.load().token,
      preferredPort: this.deps.preferredPort
    })
    try {
      const port = await server.start()
      this.server = server
      this.error = undefined
      this.deps.config.update({ port })
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`[meow] external API failed to start: ${this.error}`)
    }
  }

  private emit(): void {
    this.deps.onStatus?.(this.getStatus())
  }
}
```

  Note: `getToken` calls `config.load()` per request — a small sync file read on loopback-only traffic; acceptable, and it is what makes regeneration immediate.

- [ ] **Step 4: Run tests** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/external-api/manager.ts tests/unit/external-api-manager.test.ts
git commit -m "feat(external-api): lifecycle manager (enable, CLI install, status)"
```

---

### Task 10: Main wiring, IPC, preload, packaging

**Files:**
- Modify: `src/shared/ipc.ts` (Channels + `AgentApi`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `electron-builder.ts:49-52`
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - Channels: `ExternalApiGetStatus: 'external-api:get-status'`, `ExternalApiSetEnabled: 'external-api:set-enabled'`, `ExternalApiRegenerateToken: 'external-api:regenerate-token'`, `ExternalApiInstallClaudeSkill: 'external-api:install-claude-skill'`, `EventExternalApiStatus: 'external-api:status'`, `EventWorkspaceChanged: 'workspace:changed'`.
  - `AgentApi`: `getExternalApiStatus(): Promise<ExternalApiStatus>`, `setExternalApiEnabled(enabled: boolean): Promise<ExternalApiStatus>`, `regenerateExternalApiToken(): Promise<ExternalApiStatus>`, `installClaudeSkill(): Promise<string>`, `onExternalApiStatus(cb: (s: ExternalApiStatus) => void): () => void`, `onWorkspaceChanged(cb: (e: WorkspaceChangedEvent) => void): () => void`.
  - `export interface WorkspaceChangedEvent { runtime: WorkspaceRuntime }` in `src/shared/ipc.ts`.

- [ ] **Step 1: Write the failing test** — in `tests/unit/ipc-contract.test.ts`, append to the `required` array:

```ts
      'getExternalApiStatus', 'setExternalApiEnabled', 'regenerateExternalApiToken', 'installClaudeSkill', 'onExternalApiStatus',
      'onWorkspaceChanged'
```

  and add matching stubs to the `api: AgentApi` literal in the same test:

```ts
      getExternalApiStatus: async () => ({ enabled: false, listening: false, port: null, cliPath: null, configPath: '' }),
      setExternalApiEnabled: async () => ({ enabled: false, listening: false, port: null, cliPath: null, configPath: '' }),
      regenerateExternalApiToken: async () => ({ enabled: false, listening: false, port: null, cliPath: null, configPath: '' }),
      installClaudeSkill: async () => '',
      onExternalApiStatus: () => () => {},
      onWorkspaceChanged: () => () => {},
```

  If the file also asserts each `Channels` value is unique or matches a pattern, the new channel strings above satisfy `<area>:<action>`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/ipc-contract.test.ts` → FAIL (type errors surface via `npm run typecheck`; vitest fails on missing keys if the test checks `Object.keys`). Also run `npm run typecheck` → FAIL on the `AgentApi` literal.

- [ ] **Step 3: `src/shared/ipc.ts`** — add to `Channels` (near the Remote entries):

```ts
  ExternalApiGetStatus: 'external-api:get-status',
  ExternalApiSetEnabled: 'external-api:set-enabled',
  ExternalApiRegenerateToken: 'external-api:regenerate-token',
  ExternalApiInstallClaudeSkill: 'external-api:install-claude-skill',
  EventExternalApiStatus: 'external-api:status',
  EventWorkspaceChanged: 'workspace:changed',
```

  add the import `import type { ExternalApiStatus } from './external-api-types'`, the event type:

```ts
export interface WorkspaceChangedEvent {
  runtime: WorkspaceRuntime
}
```

  (import `WorkspaceRuntime` from `./types` if not already imported), and the `AgentApi` methods listed in Interfaces.

- [ ] **Step 4: `src/preload/index.ts`** — next to the Remote methods:

```ts
  getExternalApiStatus: () => ipcRenderer.invoke(Channels.ExternalApiGetStatus),
  setExternalApiEnabled: (enabled: boolean) => ipcRenderer.invoke(Channels.ExternalApiSetEnabled, enabled),
  regenerateExternalApiToken: () => ipcRenderer.invoke(Channels.ExternalApiRegenerateToken),
  installClaudeSkill: () => ipcRenderer.invoke(Channels.ExternalApiInstallClaudeSkill),
  onExternalApiStatus: (cb: (s: ExternalApiStatus) => void) => subscribe(Channels.EventExternalApiStatus, cb),
  onWorkspaceChanged: (cb: (e: WorkspaceChangedEvent) => void) => subscribe(Channels.EventWorkspaceChanged, cb),
```

  with type imports for `ExternalApiStatus` (from `../shared/external-api-types`) and `WorkspaceChangedEvent` (from `../shared/ipc`).

- [ ] **Step 5: `src/main/index.ts` wiring**

  a) Imports:

```ts
import os from 'node:os'
import { statSync } from 'node:fs'
import { ExternalApiConfigFile } from './external-api/config-file'
import { ExternalApiManager } from './external-api/manager'
import { ExternalDelegationFacade } from './external-api/facade'
```

  (skip any already imported; `statSync` may need adding to an existing `node:fs` import.)

  b) Pass `onChanged` to the delegation service constructor:

```ts
    onChanged: (d) => { if (d.sourceKind === 'external') this.externalApi.notifyChanged(d.id) },
```

  c) Add fields after `delegationService` (the arrow in (b) is only invoked after construction, so field order is safe):

```ts
  externalApiResources = app.isPackaged
    ? path.join(process.resourcesPath, 'external-api')
    : path.join(app.getAppPath(), 'resources', 'external-api')
  externalApi = new ExternalApiManager({
    config: new ExternalApiConfigFile(path.join(app.getPath('userData'), 'external-api.json')),
    handler: new ExternalDelegationFacade({
      workspaces: this.workspaces,
      ensureAgent: (agent) => this.meowAgent.ensureAgent(agent),
      delegations: this.delegationService,
      isDirectory: (p) => { try { return statSync(p).isDirectory() } catch { return false } },
      onWorkspaceChanged: (ws) => win?.webContents.send(Channels.EventWorkspaceChanged, { runtime: this.runtimeFor(ws) }),
      version: app.getVersion()
    }),
    cliSource: path.join(this.externalApiResources, 'meow-delegate.mjs'),
    skillTemplate: path.join(this.externalApiResources, 'claude-skill.md'),
    binDir: path.join(app.getPath('userData'), 'bin'),
    claudeSkillsDir: path.join(os.homedir(), '.claude', 'skills'),
    onStatus: (s) => win?.webContents.send(Channels.EventExternalApiStatus, s),
    log: (msg) => mainApp.systemLogger.log('ERROR', 'main', msg)
  })
```

  Verify `this.workspaces` exposes `load()`, `add()`, `addAgent()` (it does — `WorkspaceStore`). If `systemLogger.log`'s second argument type does not accept `'main'`, use the value the file already uses for main-process logs.

  d) App ready — right after `mainApp.delegationService.start()` (`~:1041`):

```ts
  void mainApp.externalApi.start().catch(err => console.error('[meow] external API:', err))
```

  e) Quit — next to `mainApp.delegationService.suspend()` (`~:1102`):

```ts
  void mainApp.externalApi.stop()
```

  f) IPC handlers — next to the Remote handlers (`~:1017`):

```ts
  ipcMain.handle(Channels.ExternalApiGetStatus, () => mainApp.externalApi.getStatus())
  ipcMain.handle(Channels.ExternalApiSetEnabled, (_e, enabled: boolean) => mainApp.externalApi.setEnabled(enabled))
  ipcMain.handle(Channels.ExternalApiRegenerateToken, () => mainApp.externalApi.regenerateToken())
  ipcMain.handle(Channels.ExternalApiInstallClaudeSkill, () => mainApp.externalApi.installClaudeSkill())
```

- [ ] **Step 6: `electron-builder.ts`** — add to `extraResources` after the skills entry:

```ts
    { from: 'resources/external-api', to: 'external-api' },
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → PASS
Run: `npx vitest run tests/unit/ipc-contract.test.ts` → PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts electron-builder.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(external-api): wire manager, IPC channels and packaging"
```

---

### Task 11: Renderer — settings tab, workspace refresh, incoming label

**Files:**
- Create: `src/renderer/src/components/settings/ExternalTab.tsx`
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx` (imports `:2-21`, `TabId` `:24-33`, `TAB_GROUPS` "Controls & Context" group, render switch near `:298`)
- Modify: `src/renderer/src/App.tsx` (effect block that subscribes to `onAgentConfig`, `~:424`)
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx:175-180`

**Interfaces:**
- Consumes: `window.api.getExternalApiStatus / setExternalApiEnabled / regenerateExternalApiToken / installClaudeSkill / onExternalApiStatus / onWorkspaceChanged`; `isExternalPeer` from `@shared/external-api-types`.

- [ ] **Step 1: Create `ExternalTab.tsx`** (follows `RemoteTab`'s structure and classes):

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { ExternalApiStatus } from '@shared/external-api-types'

export default function ExternalTab() {
  const [status, setStatus] = useState<ExternalApiStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [skillPath, setSkillPath] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.getExternalApiStatus()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(err => { if (!cancelled) setError(String(err)) })
    const unsub = window.api.onExternalApiStatus(setStatus)
    return () => { cancelled = true; unsub() }
  }, [])

  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (err) { setError(String(err)) } finally { setBusy(false) }
  }, [])

  if (!status) return <div className="settings-tab external-tab">Loading…</div>

  const line = !status.enabled
    ? 'Disabled'
    : status.listening
      ? `Listening on 127.0.0.1:${status.port}`
      : `Not listening${status.error ? ` — ${status.error}` : ''}`

  return (
    <div className="settings-tab external-tab">
      <p className="settings-hint">
        Lets a local coding agent such as Claude Code delegate plan tasks to Meow through a loopback API.
        Requests need the token stored in the config file below.
      </p>
      <div className="settings-row">
        <span>Allow external delegation</span>
        <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setStatus(await window.api.setExternalApiEnabled(!status.enabled))
        })}>
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <div className="settings-row"><span>Status</span><span>{line}</span></div>
      <div className="settings-row"><span>Config file</span><code>{status.configPath}</code></div>
      <div className="settings-row"><span>CLI</span><code>{status.cliPath ?? '—'}</code></div>
      <div className="settings-row">
        <span>Token</span>
        <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setStatus(await window.api.regenerateExternalApiToken())
        })}>Regenerate token</button>
      </div>
      <div className="settings-row">
        <span>Claude skill</span>
        <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setSkillPath(await window.api.installClaudeSkill())
        })}>Install Claude skill</button>
      </div>
      {skillPath && <div className="settings-hint">Installed to <code>{skillPath}</code></div>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
```

  Check `RemoteTab.tsx` for the actual hint/error class names it uses (`settings-hint`, `settings-error`, or similar) and use the same ones.

- [ ] **Step 2: Register in `SettingsDialog.tsx`**
  - Add `Share2` to the `lucide-react` import list.
  - `import ExternalTab from './ExternalTab'`
  - Add `| 'external'` to `TabId`.
  - In the `'Controls & Context'` group `items`, append `{ id: 'external', label: 'External delegation', icon: Share2 }`.
  - Next to `{tab === 'remote' && <RemoteTab />}` add `{tab === 'external' && <ExternalTab />}`.

- [ ] **Step 3: Handle `workspace:changed` in `App.tsx`** — inside the same `useEffect` that registers `offConfig`, add:

```tsx
    const offWorkspaceChanged = window.api.onWorkspaceChanged(({ runtime }) => {
      void refreshWorkspaces()
      const path = runtime.workspace.projectPath
      if (!runtimesRef.current[path]) return
      setRuntimes(prev => {
        const current = prev[path]
        if (!current) return prev
        return {
          ...prev,
          [path]: {
            ...current,
            workspace: runtime.workspace,
            agents: runtime.agents.map(a => current.agents.find(x => x.agentId === a.agentId) ?? a)
          }
        }
      })
    })
```

  and call `offWorkspaceChanged()` in that effect's cleanup next to `offConfig()`. Add `refreshWorkspaces` to the effect's dependency array if the linter/type rules require it (it is a stable `useCallback`).

- [ ] **Step 4: Incoming label in `ChatPanel.tsx`** — import `isExternalPeer` from `@shared/external-api-types` and change:

```tsx
              <span>From session: {delegation.peerName}</span>
```

  to

```tsx
              <span>{isExternalPeer(delegation.peerAgentId) ? 'From' : 'From session'}: {delegation.peerName}</span>
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → PASS
Run: `npm test` → PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/ExternalTab.tsx src/renderer/src/components/settings/SettingsDialog.tsx src/renderer/src/App.tsx src/renderer/src/components/chat/ChatPanel.tsx
git commit -m "feat(ui): external delegation settings tab and live session refresh"
```

---

### Task 12: Documentation

**Files:**
- Create: `src/main/external-api/AGENTS.md`, `src/main/external-api/CLAUDE.md`
- Modify: `src/main/AGENTS.md`, `docs/reference/08-integrations.md`, `docs/reference/05-ipc-contract.md`, `docs/reference/06-data-and-storage.md`, `docs/superpowers/specs/2026-09-24-external-delegation-design.md`

Follow the Documentation Sync Rule in the root `AGENTS.md`: change only affected entries, keep each file's existing format.

- [ ] **Step 1: `src/main/external-api/CLAUDE.md`** — single line `@AGENTS.md`.

- [ ] **Step 2: `src/main/external-api/AGENTS.md`**

```markdown
# AGENTS.md — src/main/external-api

Loopback API that lets an external coding agent (Claude Code) delegate plan tasks to Meow. Built on
`SessionDelegationService` with `sourceKind: 'external'`. Disabled by default.

## Key files

| File | Responsibility |
|---|---|
| `config-file.ts` | `ExternalApiConfigFile`: `userData/external-api.json` `{ enabled, port, token, cliPath }`; 32-byte hex token created once, `regenerateToken()`. |
| `server.ts` | `ExternalApiServer`: `node:http` on `127.0.0.1` (preferred 3929, fallback 0); bearer auth with `timingSafeEqual`; rejects any `Origin` header (403); 64 KiB body cap; `/v1/health`, `POST /v1/tasks`, `GET /v1/tasks/:id`, `GET /v1/tasks/:id/wait` (long-poll ≤ 120 s, woken by `notifyChanged`), `POST /v1/tasks/:id/cancel`. |
| `facade.ts` | `ExternalDelegationFacade`: resolves/auto-adds the project for `cwd`, reuses or creates the `[claude] <title>` session per `planKey`, `ensureAgent` before `createExternal`, maps records to `TaskDto`. |
| `manager.ts` | `ExternalApiManager`: copies the CLI to `userData/bin/` on start, starts/stops the server with the setting, status for the Settings tab, `installClaudeSkill()`. |
| `claude-skill.ts` | Renders `resources/external-api/claude-skill.md` with the CLI path into `~/.claude/skills/meow-delegate/SKILL.md`. |
| `errors.ts` | `ExternalApiError(status, message)` mapped to HTTP status by the server. |

The CLI itself is `resources/external-api/meow-delegate.mjs` (plain Node ≥ 18, no deps; packaged via
`extraResources` to `external-api/`). It reads `../external-api.json` relative to itself.

## Conventions

- Loopback only; never add CORS headers; never accept a request with `Origin`.
- External records use the sentinel `external:claude` for `sourceAgentId`/`sourceSessionId`; they are
  never appended to or woken on the Meow side — results are read back through the API.
- Permission prompts of a delegated run are answered in the Meow UI only.

## TODOs

- MCP server / Claude Code Channels wrapper over the same API (out of scope for v1).
```

- [ ] **Step 3: `src/main/AGENTS.md`** — in "Key files":
  - `index.ts` entry: append a sentence: "Owns the `ExternalApiManager` (`external-api/`): starts it after the delegation service, stops it on quit, forwards external delegation changes to its long-poll waiters, and pushes `workspace:changed` when the facade adds a project or session."
  - `meow-agent-manager.ts` entry: append "`ensureAgent(agent)` awaits registration of a native session (used by external delegation for projects that were never opened)."
  - `session-delegation-service.ts` entry: append "`createExternal` (source-less `sourceKind: 'external'` records: no source checks, no result append/wake, only `markDelivered`) and `cancel(id)` (queued → cancelled; running → `runtime.stopRun`)."
  - Add a bullet: "`external-api/` — loopback API + CLI for delegation from Claude Code; see its AGENTS.md."

- [ ] **Step 4: `docs/reference/08-integrations.md`** — add a new numbered section after the last one (use the next free `8.N` number and the file's heading style) titled "External delegation (Claude Code → Meow)", covering: purpose; the flow diagram from the spec §4; config file; routes table; CLI usage, output block and exit codes; security rules (loopback, token, Origin rejection, disabled by default); the Claude skill install path.

- [ ] **Step 5: `docs/reference/05-ipc-contract.md`** — add the six new channels and `WorkspaceChangedEvent` to the channel tables in the file's existing format.

- [ ] **Step 6: `docs/reference/06-data-and-storage.md`** — add `external-api.json` (shape + token semantics) and `userData/bin/meow-delegate.mjs` to the userData file list; in the delegation record section (§6.4b) add `sourceKind`, `externalClient`, `planKey`.

- [ ] **Step 7: Spec** — update the spec to match the "Deviations from the spec" section of this plan (§7 `TaskDto` without `agentId`, `POST` returns `{ task }`; §8 CLI location; §9 settings in `external-api.json`; §4 file table; mention `workspace:changed` and `ensureAgent`). Change the status line to `Status: approved — implemented per plan 2026-09-24-external-delegation.md`.

- [ ] **Step 8: Final verification**

Run: `npm run typecheck` → PASS
Run: `npm test` → PASS

- [ ] **Step 9: Commit**

```bash
git add src/main/external-api/AGENTS.md src/main/external-api/CLAUDE.md src/main/AGENTS.md docs/reference/05-ipc-contract.md docs/reference/06-data-and-storage.md docs/reference/08-integrations.md docs/superpowers/specs/2026-09-24-external-delegation-design.md
git commit -m "docs: external delegation reference, module AGENTS.md and spec sync"
```

---

### Task 13: Manual end-to-end check (desktop)

No code. Confirms the real flow the spec promises.

- [ ] **Step 1:** `npm run dev`. Settings → External delegation → Enable. Note the status line port and the CLI path. Click "Install Claude skill".
- [ ] **Step 2:** In a scratch git repo, write `task.md` containing "Create hello.txt with the text hi". From a terminal:

```bash
node "<cli path>" start --cwd "<scratch repo>" --plan docs/plan.md --title "Smoke" --task-file task.md
```

  Expected: the sidebar shows the scratch project with a `[claude] Smoke` session; the incoming bubble reads "From: Claude (external)"; approving the write prompt in Meow lets it finish; the CLI prints the result block with `status: completed` and `- hello.txt`, exit code 0.
- [ ] **Step 3:** Run `send --session <id> --message-file task.md` and confirm it lands in the same session.
- [ ] **Step 4:** Start another task and run `cancel <taskId>` from a second terminal while it runs; the first CLI exits 2.
- [ ] **Step 5:** Disable the feature; `status <taskId>` exits 3 with the `[meow]` message.
- [ ] **Step 6:** Record the outcome in the final report (pass/fail per step, with output for any failure).
