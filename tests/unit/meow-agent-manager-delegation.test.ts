import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MeowAgentManager } from '../../src/main/meow-agent-manager'
import type { MeowAgentManagerDeps } from '../../src/main/meow-agent-manager'
import { SessionStore } from '../../src/main/agent/session'
import type { StoredSession } from '../../src/main/agent/session'
import type { JsonStore } from '../../src/main/json-store'
import { createDefaultTools } from '../../src/main/agent/tools/registry'
import { SnapshotStore } from '../../src/main/agent/snapshot'
import type { SnapshotEntry } from '../../src/main/agent/snapshot'
import { TruncationStore } from '../../src/main/agent/truncation'
import { CommandStore } from '../../src/main/agent/commands'
import { SavedPermissions } from '../../src/main/agent/saved-permissions'
import type { SavedPermission } from '../../src/main/agent/saved-permissions'
import type { LlmClient, LlmStreamOptions, LlmStreamPart } from '../../src/main/agent/llm'
import { type AgentConfig, type ChatEvent } from '../../src/shared/types'
import type { Vault } from '../../src/main/vault'
import type { DelegatedTurnInput, DelegationResultInput } from '../../src/main/agent/run-context'

class FakeVault implements Vault {
  private map = new Map<string, string>()
  isAvailable(): boolean { return true }
  saveSecret(ref: string, secret: string): void { this.map.set(ref, secret) }
  saveSecretObject(ref: string, secret: unknown): void { this.map.set(ref, JSON.stringify(secret)) }
  getSecret(ref: string): string | null { return this.map.get(ref) ?? null }
  getSecretObject<T>(ref: string): T | null {
    const raw = this.getSecret(ref)
    return raw === null ? null : JSON.parse(raw) as T
  }
  hasSecret(ref: string): boolean { return this.map.has(ref) }
  deleteSecret(ref: string): void { this.map.delete(ref) }
  mask(secret: string): string { return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}…${secret.slice(-4)}` }
}

const MEOW_AGENT: AgentConfig = {
  id: 'a1', name: 'meow', templateId: 'meow', cwd: '/proj', kind: 'native'
}

interface StubLlmOptions {
  partsQueue?: LlmStreamPart[][]
  hangUntilAbort?: boolean
}

async function makeManager(opts: StubLlmOptions & {
  delegation?: MeowAgentManagerDeps['delegation']
} = {}) {
  const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-del-cfg-'))
  const defaultCfg = path.join(cfgDir, 'meow.json')
  writeFileSync(defaultCfg, JSON.stringify({
    provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
    model: 'test',
    maxContextTokens: 128000,
    maxOutputTokens: 32000
  }))
  const sessions: StoredSession[] = []
  const json: JsonStore<StoredSession> = {
    load: () => sessions,
    save: (next) => sessions.splice(0, sessions.length, ...next)
  }
  const store = new SessionStore(json)
  const snapshotEntries: SnapshotEntry[] = []
  const snapshots = new SnapshotStore({
    load: () => snapshotEntries,
    save: (next) => snapshotEntries.splice(0, snapshotEntries.length, ...next)
  })
  const permEntries: SavedPermission[] = []
  const savedPermissions = new SavedPermissions({
    load: () => permEntries,
    save: (next) => permEntries.splice(0, permEntries.length, ...next)
  })
  const events: ChatEvent[] = []
  const createLlm = vi.fn((_provider?: unknown, _apiKey?: unknown, _baseUrl?: unknown, _opts?: unknown): LlmClient => {
    return {
      async *stream(request: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
        if (opts.hangUntilAbort) {
          await new Promise<void>(resolve => {
            if (request.signal?.aborted) return resolve()
            request.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          yield { kind: 'finish' }
          return
        }
        const parts = (opts.partsQueue ?? []).shift() ??
          [{ kind: 'text', text: 'hi' }, { kind: 'finish' }]
        for (const p of parts) yield p
      }
    }
  })
  const manager = new MeowAgentManager({
    configPath: defaultCfg,
    store,
    snapshots,
    savedPermissions,
    tools: createDefaultTools(),
    createLlm,
    truncation: new TruncationStore(path.join(cfgDir, 'truncation')),
    commands: new CommandStore(path.join(cfgDir, 'commands.json')),
    prices: { 'test/test-model': { input: 1, output: 2 } },
    connections: {
      getChatEndpoint: () => ({ baseUrl: 'http://localhost:9000', apiKey: 'x' })
    } as never,
    vault: new FakeVault(),
    env: { ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv,
    delegation: opts.delegation as never
  })
  manager.setOnEvent(e => events.push(e))
  await manager.init([{ ...MEOW_AGENT }])
  return { manager, store, snapshots, events }
}

beforeEach(() => {
  rmSync(path.join(tmpdir(), 'meow-mgr-del-cfg-'), { recursive: true, force: true })
})

describe('MeowAgentManager delegation runtime', () => {
  it('resolves a delegated agent and reports busy while a turn runs', async () => {
    const { manager } = await makeManager({ hangUntilAbort: true })
    const runPromise = manager.send('a1', 'long turn')
    await new Promise(r => setTimeout(r, 20))
    expect(manager.resolveDelegationAgent('a1')).toBeDefined()
    expect(manager.isBusy('a1')).toBe(true)
    manager.stop('a1')
    await runPromise
    expect(manager.isBusy('a1')).toBe(false)
  })

  it('runs a delegated turn against the fixed target session and returns a correlated result', async () => {
    const { manager, store } = await makeManager()
    const input: DelegatedTurnInput = {
      delegationId: 'd2',
      sourceAgentId: 'src-agent',
      sourceName: 'src',
      targetAgentId: 'a1',
      targetSessionId: 'del-session-2',
      task: 'do the thing'
    }
    const result = await manager.runDelegatedTurn(input)
    expect(result.reason).toBe('completed')
    expect(result.runId).toBeTruthy()
    expect(result.touchedFiles).toEqual([])
    const session = store.get('del-session-2')
    expect(session).toBeDefined()
    const messages = session!.items
      .filter((i): i is { kind: 'message'; message: { id: string; text: string } } => i.kind === 'message')
      .map(i => i.message)
    expect(messages.some(m => m.id === 'delegation-incoming:d2')).toBe(true)
    expect(messages.some(m => m.text === 'do the thing')).toBe(true)
  })

  it('appends a deterministic result message to the source session', async () => {
    const { manager, store } = await makeManager()
    const input: DelegationResultInput = {
      delegationId: 'd3',
      sourceAgentId: 'a1',
      sourceSessionId: 'src-session-3',
      targetAgentId: 't-agent',
      targetName: 'target',
      status: 'completed',
      result: 'here is the output',
      touchedFiles: ['/proj/a.txt']
    }
    await manager.appendDelegationResult(input)
    const src = store.get('src-session-3')
    expect(src).toBeDefined()
    const messages = src!.items
      .filter((i): i is { kind: 'message'; message: { id: string; text: string; delegation?: { direction: string } } } => i.kind === 'message')
      .map(i => i.message)
    const match = messages.find(m => m.id === 'delegation-result:d3')
    expect(match).toBeDefined()
    expect(match!.delegation?.direction).toBe('result')
  })

  it('wakeDelegationSource drains the source while idle, and defers when busy', async () => {
    const { manager } = await makeManager()
    const input: DelegationResultInput = {
      delegationId: 'd4',
      sourceAgentId: 'a1',
      sourceSessionId: 'src-session-4',
      targetAgentId: 't-agent',
      targetName: 'target',
      status: 'completed',
      result: 'done',
      touchedFiles: []
    }
    await manager.appendDelegationResult(input)
    const runPromise = manager.wakeDelegationSource(input)
    // idle -> a turn starts immediately
    expect(manager.isBusy('a1')).toBe(true)
    await runPromise
    expect(manager.isBusy('a1')).toBe(false)
  })

  it('does not drop a deferred result wake when the user queue is full', async () => {
    const { manager } = await makeManager({ hangUntilAbort: true })
    manager.send('a1', 'long turn')
    await new Promise(r => setTimeout(r, 20))
    expect(manager.isBusy('a1')).toBe(true)
    // Fill the visible user queue to the 5-message cap.
    for (let i = 0; i < 5; i++) manager.send('a1', `queued ${i}`)
    const input: DelegationResultInput = {
      delegationId: 'full-wake',
      sourceAgentId: 'a1',
      sourceSessionId: 'src-full',
      targetAgentId: 't-agent',
      targetName: 'target',
      status: 'completed',
      result: 'result despite full queue',
      touchedFiles: []
    }
    await manager.appendDelegationResult(input)
    // This must not be dropped by the cap: it parks as a deferred internal entry.
    await manager.wakeDelegationSource(input)
    const queued = manager.listQueued('a1')
    expect(queued.some(q => q.id === 'full-wake')).toBe(true)
    expect(queued.filter(q => q.id === 'full-wake')).toHaveLength(1)
    expect(queued.length).toBeGreaterThan(0)
    // Do not await the long-running send (it would drain every hung queue item).
    manager.stop('a1')
  })

  it('routes all writes to the fixed run session when the UI session is switched mid-run', async () => {
    const { manager, store } = await makeManager({ hangUntilAbort: true })
    // Make the delegated target session (del-session-6) exist up front.
    store.ensure('del-session-6', 'a1', '/proj')
    const input: DelegatedTurnInput = {
      delegationId: 'd6',
      sourceAgentId: 'src-agent',
      sourceName: 'src',
      targetAgentId: 'a1',
      targetSessionId: 'del-session-6',
      task: 'work in the fixed session'
    }
    const switchTarget = store.create('a1', '/proj')
    const runPromise = manager.runDelegatedTurn(input)
    await new Promise(r => setTimeout(r, 20))
    expect(manager.isBusy('a1')).toBe(true)
    // The UI switches away to a fresh session mid-run; switching calls stop(),
    // which aborts the running turn after capture.
    manager.switchSession('a1', switchTarget.id)
    await runPromise
    expect(manager.isBusy('a1')).toBe(false)
    // The delegated prompt and its assistant answer both live on the fixed
    // session, not the one the UI switched to.
    const fixed = store.get('del-session-6')!
    const fixedMsgs = fixed.items
      .filter((i): i is { kind: 'message'; message: { id: string; text: string; role: string } } => i.kind === 'message')
      .map(i => i.message)
    expect(fixedMsgs.some(m => m.id === 'delegation-incoming:d6')).toBe(true)
    // Nothing leaked to the session the UI switched to mid-run.
    expect(store.get(switchTarget.id)!.items.filter(i => i.kind === 'message')).toHaveLength(0)
  })
})
