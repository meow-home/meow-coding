import path from 'node:path'
import type {
  CliAgent,
  CliAgentKind,
  CliAgentMode,
  CliAgentsStatus,
  CliAgentStatus,
  CliRuntimeDetectResult,
  CliRuntimeId,
  CliSessionMeta,
  CliSessionStatus,
  CliTranscriptItem
} from '../../shared/types'
import { CliAgentStore } from './agents'
import { CliBinaryManager, type CliCommandRunner, defaultRunCommand } from './binary-manager'
import { CliProfileManager, type VaultLike } from './profiles'
import { CliRunManager } from './run-manager'
import type { CliTerminalResult } from './parsers/types'
import { deriveCliPolicy } from './policy'
import { getCliRuntime } from './runtimes'
import { CliSessionStore } from './session-store'

export {
  assertValidSessionId,
  CliSessionStore,
  type CliSessionStoreOptions,
  TRANSCRIPT_MAX_BYTES,
  TRANSCRIPT_TRUNCATE_BYTES
} from './session-store'
export { CliAgentStore, type CliAgentsData } from './agents'
export {
  CliBinaryManager,
  type CliBinaryManagerOptions,
  type CliCommandRunner,
  compareSemver,
  defaultRunCommand,
  isSemverGte,
  parseSemver
} from './binary-manager'
export { CliProfileManager, type VaultLike } from './profiles'
export {
  ALLOWED_INPUT_ENV_KEYS,
  buildCliEnv,
  CliRunManager,
  type CliRunManagerDeps,
  type RunTaskInput,
  type SpawnFn,
  truncateUtf8
} from './run-manager'
export {
  buildAntigravityArgs,
  buildOpenCodeArgs,
  type CliPolicy,
  DEFAULT_CLI_TASK_TIMEOUT_MS,
  deriveCliPolicy
} from './policy'
export { CLI_RUNTIMES, type CliRuntimeDefinition, getCliRuntime } from './runtimes'
export type { CliTerminalResult } from './parsers/types'

const DEFAULT_PERMISSIONS: Record<string, 'allow' | 'ask' | 'deny'> = {
  bash: 'ask',
  write: 'allow',
  edit: 'allow',
  'apply-patch': 'allow',
  webfetch: 'allow'
}

export interface AddCliAgentInput {
  runtime: CliRuntimeId
  kind: CliAgentKind
  label: string
  provider?: string
  secret?: string
  mode?: CliAgentMode
  model?: string
}

export interface CliAgentsManagerOptions {
  userDataDir: string
  vault: VaultLike
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  runManager?: CliRunManager
  binaryManager?: CliBinaryManager
  runCommand?: CliCommandRunner
  now?: () => number
  getPermission?: () => Record<string, 'allow' | 'ask' | 'deny'>
  onEvent?: (sessionId: string, item: CliTranscriptItem) => void
  onStatus?: (sessionId: string, status: CliSessionStatus) => void
  onAgentsChanged?: () => void
  onSessionsChanged?: () => void
}

export class CliAgentsManager {
  private readonly opts: CliAgentsManagerOptions
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly runCommand: CliCommandRunner
  private readonly inFlightTasks = new Map<string, Promise<CliTerminalResult>>()

  readonly agentStore: CliAgentStore
  readonly profileManager: CliProfileManager
  readonly sessionStore: CliSessionStore
  readonly binaryManager: CliBinaryManager
  readonly runManager: CliRunManager

  constructor(opts: CliAgentsManagerOptions) {
    this.opts = opts
    this.env = opts.env ?? process.env
    this.platform = opts.platform ?? process.platform
    this.now = opts.now ?? Date.now
    this.runCommand = opts.runCommand ?? ((file, args, env, platform = this.platform) => defaultRunCommand(file, args, env, platform))

    this.profileManager = new CliProfileManager(opts.userDataDir, opts.vault)
    this.agentStore = new CliAgentStore(opts.userDataDir, {
      onRemove: (id) => this.profileManager.removeProfile(id)
    })
    this.sessionStore = new CliSessionStore(opts.userDataDir, { now: this.now })

    this.binaryManager = opts.binaryManager ?? new CliBinaryManager({
      userDataDir: opts.userDataDir,
      env: this.env,
      platform: this.platform,
      runCommand: this.runCommand
    })

    this.runManager = opts.runManager ?? new CliRunManager({
      now: this.now,
      resolveBinary: (runtime) => {
        const cfg = this.agentStore.getRuntimeConfig(runtime)
        return this.binaryManager.resolveBinary(runtime, cfg.binaryPath)
      },
      onEvent: (sessionId, item) => {
        if (!this.sessionStore.get(sessionId)) return
        this.sessionStore.appendItem(sessionId, item)
        this.opts.onEvent?.(sessionId, item)
      },
      onStatus: (sessionId, status) => {
        if (!this.sessionStore.get(sessionId)) return
        this.sessionStore.setStatus(sessionId, status)
        this.opts.onStatus?.(sessionId, status)
        this.opts.onSessionsChanged?.()
      }
    })
  }

  getStatus(): CliAgentsStatus {
    return this.agentStore.getStatus()
  }

  async detectRuntime(runtime: CliRuntimeId): Promise<CliRuntimeDetectResult> {
    const config = this.agentStore.getRuntimeConfig(runtime)
    const res = await this.binaryManager.detect(runtime, config.binaryPath)
    this.agentStore.setRuntimeDetection(runtime, { binaryPath: res.binaryPath, version: res.version })
    this.opts.onAgentsChanged?.()
    return res
  }

  async setRuntimePath(runtime: CliRuntimeId, binaryPath: string | null): Promise<void> {
    this.agentStore.setRuntimePath(runtime, binaryPath)
    const res = await this.binaryManager.detect(runtime, binaryPath)
    this.agentStore.setRuntimeDetection(runtime, { binaryPath: res.binaryPath, version: res.version })
    this.opts.onAgentsChanged?.()
  }

  setRuntimeEnabled(runtime: CliRuntimeId, enabled: boolean): void {
    this.agentStore.setRuntimeEnabled(runtime, enabled)
    this.opts.onAgentsChanged?.()
  }

  async listModels(runtime: CliRuntimeId, agentId?: string): Promise<string[]> {
    try {
      const config = this.agentStore.getRuntimeConfig(runtime)
      const binaryPath = this.binaryManager.resolveBinary(runtime, config.binaryPath)
      if (!binaryPath) return []

      const runtimeDef = getCliRuntime(runtime)
      const cmd = runtimeDef.modelsCommand(binaryPath)

      let agent: CliAgent | null = null
      if (agentId) {
        agent = this.agentStore.getAgent(agentId)
      }

      const envMap: Record<string, string> = {}
      if (agent) {
        if (agent.kind === 'gemini-key') {
          const secret = this.profileManager.getAgentSecret(agent.id)
          if (secret) envMap.GEMINI_API_KEY = secret
        }
        if (agent.runtime === 'opencode') {
          const profileDir = this.profileManager.ensureOpenCodeProfileDir(agent.id)
          envMap.XDG_DATA_HOME = profileDir
          envMap.OPENCODE_DB = path.join(profileDir, 'opencode.db')
        }
      }

      const cmdEnv = agent ? this.buildEnvForAgent(agent, envMap) : this.env
      const res = await this.runCommand(cmd.file, cmd.args, cmdEnv, this.platform)
      if (res.exitCode !== 0 && !res.stdout.trim()) {
        return []
      }

      const lines = res.stdout.split(/\r?\n/)
      const slugs = new Set<string>()
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (/^(fetching|loading)/i.test(line)) continue
        if (/^[-=_\s]+$/.test(line)) continue
        if (/^model\s+(id|name)/i.test(line)) continue
        if (/^(id|slug|name|provider)\s+/i.test(line)) continue

        const parts = line.split(/\s+/)
        const slug = parts[0]
        if (slug && /^[a-zA-Z0-9_\-\.\/:]+$/.test(slug)) {
          if (!['model', 'models', 'id', 'slug', 'name'].includes(slug.toLowerCase())) {
            slugs.add(slug)
          }
        }
      }
      return Array.from(slugs)
    } catch {
      return []
    }
  }

  private buildEnvForAgent(agent: CliAgent, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
    const result: Record<string, string> = {}
    for (const [key, val] of Object.entries(this.env)) {
      if (val !== undefined) result[key] = val
    }
    if (extraEnv) {
      for (const [key, val] of Object.entries(extraEnv)) {
        if (val !== undefined) result[key] = val
      }
    }
    return result
  }

  addAgent(input: AddCliAgentInput): CliAgent {
    const prefix = input.runtime === 'antigravity' ? 'agy_' : 'oc_'
    const rand = Math.random().toString(36).slice(2, 10)
    const id = `${prefix}${rand}`

    let status: CliAgentStatus
    if (input.kind === 'gemini-key') {
      if (!input.secret || !input.secret.trim()) {
        throw new Error('[meow] Secret is required for gemini-key agent')
      }
      status = 'ready'
      this.profileManager.saveAgentSecret(id, input.secret.trim())
    } else {
      status = 'needs-login'
    }

    let profileDir: string | undefined
    if (input.runtime === 'opencode') {
      this.profileManager.ensureOpenCodeProfileDir(id)
      profileDir = this.profileManager.getRelativeOpenCodeProfileDir(id)
    }

    const agent: CliAgent = {
      id,
      runtime: input.runtime,
      kind: input.kind,
      label: input.label,
      provider: input.provider,
      profileDir,
      model: input.model,
      mode: input.mode ?? 'edit',
      status,
      createdAt: this.now()
    }

    const created = this.agentStore.addAgent(agent)
    this.opts.onAgentsChanged?.()
    return created
  }

  renameAgent(id: string, label: string): CliAgent {
    const updated = this.agentStore.updateAgent(id, { label })
    this.opts.onAgentsChanged?.()
    return updated
  }

  async removeAgent(id: string): Promise<void> {
    const sessions = this.sessionStore.list().filter(s => s.agentId === id)
    for (const session of sessions) {
      await this.deleteSession(session.id)
    }
    await this.agentStore.removeAgent(id)
    this.opts.onAgentsChanged?.()
  }

  activateAgent(id: string): void {
    this.agentStore.activateAgent(id)
    this.opts.onAgentsChanged?.()
  }

  setDefaultAgent(id: string): void {
    this.agentStore.setDefaultAgent(id)
    this.opts.onAgentsChanged?.()
  }

  createSession(agentId: string, projectPath: string, cwd?: string): CliSessionMeta {
    const agent = this.agentStore.getAgent(agentId)
    if (!agent) {
      throw new Error(`[meow] Agent not found: ${agentId}`)
    }

    const id = `clis_${Math.random().toString(36).slice(2, 10)}`
    const now = this.now()
    const meta: CliSessionMeta = {
      id,
      agentId,
      projectPath,
      cwd: cwd || projectPath,
      title: 'New session',
      status: 'idle',
      createdAt: now,
      updatedAt: now
    }

    const created = this.sessionStore.create(meta)
    this.opts.onSessionsChanged?.()
    return created
  }

  renameSession(id: string, title: string): CliSessionMeta {
    const updated = this.sessionStore.rename(id, title)
    this.opts.onSessionsChanged?.()
    return updated
  }

  async deleteSession(id: string): Promise<void> {
    const inFlight = this.inFlightTasks.get(id)
    this.cancelTask(id)
    if (inFlight) {
      try {
        await Promise.race([
          inFlight,
          new Promise((resolve) => setTimeout(resolve, 5000))
        ])
      } catch {
        /* best effort on waiting for in-flight task to end */
      }
    }
    this.sessionStore.delete(id)
    this.opts.onSessionsChanged?.()
  }

  listSessions(projectPath?: string): CliSessionMeta[] {
    return this.sessionStore.list(projectPath)
  }

  getTranscript(id: string, limit?: number): CliTranscriptItem[] {
    return this.sessionStore.readTranscript(id, limit)
  }

  async sendTask(sessionId: string, task: string): Promise<CliTerminalResult> {
    const session = this.sessionStore.get(sessionId)
    if (!session) {
      throw new Error(`[meow] Session not found: ${sessionId}`)
    }
    const agent = this.agentStore.getAgent(session.agentId)
    if (!agent) {
      throw new Error(`[meow] Agent not found: ${session.agentId}`)
    }
    if (agent.status !== 'ready') {
      throw new Error(`[meow] Agent "${agent.label}" (${agent.id}) is not ready (status: ${agent.status})`)
    }

    const permissions = this.opts.getPermission ? this.opts.getPermission() : DEFAULT_PERMISSIONS
    const policy = deriveCliPolicy(agent.mode, permissions)

    const runtimeConfig = this.agentStore.getRuntimeConfig(agent.runtime)
    const binaryPath = this.binaryManager.resolveBinary(agent.runtime, runtimeConfig.binaryPath)
    if (!binaryPath) {
      throw new Error(`[meow] Cannot find binary for runtime: ${agent.runtime}`)
    }

    const env: Record<string, string> = {}
    if (agent.kind === 'gemini-key') {
      const secret = this.profileManager.getAgentSecret(agent.id)
      if (!secret) {
        throw new Error(`[meow] Secret not found in vault for agent: ${agent.id}`)
      }
      env.GEMINI_API_KEY = secret
    }
    if (agent.runtime === 'opencode') {
      const profileDir = this.profileManager.ensureOpenCodeProfileDir(agent.id)
      env.XDG_DATA_HOME = profileDir
      env.OPENCODE_DB = path.join(profileDir, 'opencode.db')
    }

    const userItem: CliTranscriptItem = {
      kind: 'user',
      text: task,
      at: this.now()
    }
    this.sessionStore.appendItem(sessionId, userItem)
    this.opts.onEvent?.(sessionId, userItem)

    if (!session.title || session.title === 'New session' || session.title === 'New Session') {
      const title = task.trim().slice(0, 60)
      this.sessionStore.rename(sessionId, title)
      this.opts.onSessionsChanged?.()
    }

    this.sessionStore.setStatus(sessionId, 'running')
    this.opts.onStatus?.(sessionId, 'running')
    this.opts.onSessionsChanged?.()

    const execute = async (): Promise<CliTerminalResult> => {
      try {
        const result = await this.runManager.runTask({
          sessionId,
          agent,
          task,
          cwd: session.cwd || session.projectPath,
          policy,
          binaryPath,
          env
        })

        if (!this.sessionStore.get(sessionId)) {
          return result
        }

        const resultItem: CliTranscriptItem = {
          kind: 'result',
          status: result.status,
          text: result.text,
          usage: result.usage,
          deniedActions: result.deniedActions,
          at: this.now()
        }
        const recent = this.sessionStore.readTranscript(sessionId, 1)
        if (recent.length === 0 || recent[recent.length - 1].kind !== 'result') {
          this.sessionStore.appendItem(sessionId, resultItem)
          this.opts.onEvent?.(sessionId, resultItem)
        }

        let finalStatus: CliSessionStatus = 'idle'
        if (result.deniedActions && result.deniedActions.length > 0) {
          finalStatus = 'needs-attention'
        } else if (result.status === 'failed' || result.status === 'timeout' || result.status === 'interrupted') {
          finalStatus = 'failed'
        } else {
          finalStatus = 'idle'
        }
        this.sessionStore.setStatus(sessionId, finalStatus)
        this.opts.onStatus?.(sessionId, finalStatus)
        this.opts.onSessionsChanged?.()

        return result
      } catch (err) {
        if (this.sessionStore.get(sessionId)) {
          const errorText = err instanceof Error ? err.message : String(err)
          const noticeItem: CliTranscriptItem = {
            kind: 'notice',
            level: 'error',
            text: errorText,
            at: this.now()
          }
          const errorItem: CliTranscriptItem = {
            kind: 'result',
            status: 'failed',
            text: errorText,
            at: this.now()
          }
          this.sessionStore.appendItem(sessionId, noticeItem)
          this.opts.onEvent?.(sessionId, noticeItem)
          this.sessionStore.appendItem(sessionId, errorItem)
          this.opts.onEvent?.(sessionId, errorItem)
          this.sessionStore.setStatus(sessionId, 'failed')
          this.opts.onStatus?.(sessionId, 'failed')
          this.opts.onSessionsChanged?.()
        }
        throw err
      }
    }

    const runPromise = execute()
    this.inFlightTasks.set(sessionId, runPromise)
    try {
      return await runPromise
    } finally {
      this.inFlightTasks.delete(sessionId)
    }
  }

  cancelTask(sessionId: string): boolean {
    const cancelled = this.runManager.cancel(sessionId)
    if (cancelled) {
      this.opts.onSessionsChanged?.()
    }
    return cancelled
  }

  async cancelAll(): Promise<void> {
    await this.runManager.cancelAll()
  }

  restore(): void {
    const sessions = this.sessionStore.list()
    let changed = false
    for (const session of sessions) {
      if (session.status === 'running') {
        this.sessionStore.setStatus(session.id, 'failed')
        this.sessionStore.appendItem(session.id, {
          kind: 'notice',
          level: 'warn',
          text: 'Session was interrupted by restart',
          at: this.now()
        })
        this.sessionStore.appendItem(session.id, {
          kind: 'result',
          status: 'interrupted',
          text: '',
          at: this.now()
        })
        changed = true
      }
    }
    if (changed) {
      this.opts.onSessionsChanged?.()
    }
  }
}
