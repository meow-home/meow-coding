import os from 'node:os'
import type { CliCheckResult, CliTestResult } from '../../shared/types'
import { CliBinaryManager, type CliCommandRunner } from './binary-manager'
import { TEST_TIMEOUT_MS } from './constants'
import type { CliTerminalResult } from './parsers/types'
import { deriveCliPolicy } from './policy'
import { CliRunManager } from './run-manager'

export {
  CliBinaryManager,
  type CliBinaryManagerOptions,
  type CliCommandRunner,
  compareSemver,
  defaultRunCommand,
  isSemverGte,
  parseSemver
} from './binary-manager'
export {
  buildCliEnv,
  CliRunManager,
  type CliRunManagerDeps,
  type RunTaskInput,
  type SpawnFn,
  truncateUtf8
} from './run-manager'
export {
  buildAntigravityArgs,
  type CliMode,
  type CliPolicy,
  DEFAULT_CLI_TASK_TIMEOUT_MS,
  deriveCliPolicy
} from './policy'
export { ANTIGRAVITY_CLI } from './runtimes'
export type { CliTerminalResult } from './parsers/types'
export { registerCliAgentsIpc, type RegisterCliAgentsIpcOptions } from './ipc'

type PermissionMap = Record<string, 'allow' | 'ask' | 'deny'>

const DEFAULT_PERMISSIONS: PermissionMap = {
  bash: 'ask',
  write: 'allow',
  edit: 'allow',
  'apply-patch': 'allow',
  webfetch: 'allow'
}

const TEST_RUN_ID = 'cli-test'
const TEST_TASK = 'Reply with the single word OK. Do not use any tools.'
const TEST_OUTPUT_MAX_CHARS = 2000

export interface AntigravityCliOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  runManager?: CliRunManager
  binaryManager?: CliBinaryManager
  runCommand?: CliCommandRunner
  now?: () => number
  testCwd?: string
  getPermission?: () => PermissionMap
}

/**
 * The Antigravity CLI (`agy`) as a headless worker. Meow keeps no accounts or
 * sessions for it: it uses whatever `agy` install and sign-in the machine has.
 */
export class AntigravityCli {
  private readonly opts: AntigravityCliOptions
  private readonly now: () => number
  readonly binaryManager: CliBinaryManager
  readonly runManager: CliRunManager

  constructor(opts: AntigravityCliOptions = {}) {
    this.opts = opts
    this.now = opts.now ?? Date.now
    this.binaryManager = opts.binaryManager ?? new CliBinaryManager({
      env: opts.env,
      platform: opts.platform,
      runCommand: opts.runCommand
    })
    this.runManager = opts.runManager ?? new CliRunManager({ now: this.now })
  }

  /** Is `agy` installed and new enough? Does not start a model run. */
  check(): Promise<CliCheckResult> {
    return this.binaryManager.check()
  }

  /** Runs one tiny read-only prompt end to end, which also proves the sign-in works. */
  async test(): Promise<CliTestResult> {
    const startedAt = this.now()
    const fail = (error: string, text = ''): CliTestResult => ({
      ok: false,
      text,
      error: error.slice(0, TEST_OUTPUT_MAX_CHARS),
      durationMs: this.now() - startedAt
    })

    const check = await this.check()
    if (!check.ready || !check.binaryPath) {
      return fail(check.error ?? 'Antigravity CLI is not ready.')
    }
    if (this.runManager.activeCount() + this.runManager.queuedCount() > 0) {
      return fail('Antigravity is busy with a delegated task. Try again when it finishes.')
    }

    try {
      const result = await this.runManager.runTask({
        runId: TEST_RUN_ID,
        task: TEST_TASK,
        cwd: this.opts.testCwd ?? os.tmpdir(),
        policy: deriveCliPolicy('read', {}, { timeoutMs: TEST_TIMEOUT_MS }),
        binaryPath: check.binaryPath
      })
      const text = result.text.trim().slice(0, TEST_OUTPUT_MAX_CHARS)
      if (result.status !== 'completed') {
        return fail(result.error ?? `Test run ended with status "${result.status}".`, text)
      }
      return { ok: true, text, durationMs: this.now() - startedAt }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  /** Runs one delegated task in `cwd`, with permissions derived from Meow's own rules. */
  async runTask(input: { runId: string; task: string; cwd: string }): Promise<CliTerminalResult> {
    const check = await this.check()
    if (!check.ready || !check.binaryPath) {
      throw new Error(
        `[meow] Antigravity CLI is not ready: ${check.error ?? 'unknown reason'} Check Settings > Antigravity CLI.`
      )
    }
    const permissions = this.opts.getPermission?.() ?? DEFAULT_PERMISSIONS
    return this.runManager.runTask({
      runId: input.runId,
      task: input.task,
      cwd: input.cwd,
      policy: deriveCliPolicy('edit', permissions),
      binaryPath: check.binaryPath
    })
  }

  cancelTask(runId: string): boolean {
    return this.runManager.cancel(runId)
  }

  cancelAll(): Promise<void> {
    return this.runManager.cancelAll()
  }
}
