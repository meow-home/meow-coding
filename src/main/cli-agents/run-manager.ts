import type { ChildProcess } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import kill from 'tree-kill'
import type {
  CliAgent,
  CliRuntimeId,
  CliSessionStatus,
  CliTaskStatus,
  CliTranscriptItem
} from '../../shared/types'
import { buildSpawnCommand } from '../pty-manager'
import {
  DEFAULT_TASK_TIMEOUT_MS,
  isEnvAllowed,
  MAX_CONCURRENT,
  RESULT_MAX_BYTES,
  STDERR_MAX_BYTES,
  TASK_MAX_BYTES
} from './constants'
import { createAntigravityParser } from './parsers/antigravity'
import { createOpenCodeParser } from './parsers/opencode'
import type { CliTerminalResult } from './parsers/types'
import type { CliPolicy } from './policy'
import { buildAntigravityArgs, buildOpenCodeArgs } from './policy'

export type SpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    windowsHide?: boolean
    windowsVerbatimArguments?: boolean
    stdio?: any
  }
) => ChildProcess

export interface CliRunManagerDeps {
  spawn?: SpawnFn
  killTree?: (pid: number) => Promise<void>
  now?: () => number
  maxConcurrent?: Partial<Record<CliRuntimeId, number>>
  timeoutMs?: number
  onEvent?: (sessionId: string, item: CliTranscriptItem) => void
  onStatus?: (sessionId: string, status: CliSessionStatus) => void
  resolveBinary?: (runtime: CliRuntimeId, agent: CliAgent) => string | null
}

export interface RunTaskInput {
  sessionId: string
  agent: CliAgent
  task: string
  cwd: string
  policy: CliPolicy
  binaryPath?: string
  env?: Record<string, string>
}

interface QueuedTask {
  input: RunTaskInput
  resolve: (result: CliTerminalResult) => void
  reject: (err: unknown) => void
  cancelled: boolean
}

interface ActiveRun {
  sessionId: string
  runtime: CliRuntimeId
  isGoogle: boolean
  child: ChildProcess
  pid?: number
  timer?: NodeJS.Timeout
  cancel: () => Promise<void>
}

function defaultKillTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    kill(pid, () => {
      resolve()
    })
  })
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text

  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--
  }
  if (end > 0) {
    const lead = buf[end]
    let seqLen = 1
    if ((lead & 0x80) === 0) seqLen = 1
    else if ((lead & 0xe0) === 0xc0) seqLen = 2
    else if ((lead & 0xf0) === 0xe0) seqLen = 3
    else if ((lead & 0xf8) === 0xf0) seqLen = 4

    if (end + seqLen <= maxBytes) {
      end = end + seqLen
    }
  }

  return buf.subarray(0, end).toString('utf8') + '... [truncated]'
}

export const ALLOWED_INPUT_ENV_KEYS = new Set([
  'GEMINI_API_KEY',
  'XDG_DATA_HOME',
  'OPENCODE_DB',
  'OPENCODE_CONFIG_CONTENT'
])

export function buildCliEnv(
  agent: CliAgent,
  inputEnv?: Record<string, string>,
  sourceProcessEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const resultEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(sourceProcessEnv)) {
    if (value !== undefined && isEnvAllowed(key, platform)) {
      resultEnv[key] = value
    }
  }

  if (inputEnv) {
    if (agent.kind === 'gemini-key' && inputEnv.GEMINI_API_KEY !== undefined) {
      resultEnv.GEMINI_API_KEY = inputEnv.GEMINI_API_KEY
    }

    if (agent.runtime === 'opencode') {
      if (inputEnv.XDG_DATA_HOME !== undefined) {
        resultEnv.XDG_DATA_HOME = inputEnv.XDG_DATA_HOME
      }
      if (inputEnv.OPENCODE_DB !== undefined) {
        resultEnv.OPENCODE_DB = inputEnv.OPENCODE_DB
      }
      if (inputEnv.OPENCODE_CONFIG_CONTENT !== undefined) {
        resultEnv.OPENCODE_CONFIG_CONTENT = inputEnv.OPENCODE_CONFIG_CONTENT
      }
    }
  }

  for (const key of Object.keys(resultEnv)) {
    if (/_API_KEY$/i.test(key)) {
      if (key.toUpperCase() === 'GEMINI_API_KEY' && agent.kind === 'gemini-key') {
        continue
      }
      delete resultEnv[key]
    }
  }

  return resultEnv
}

export class CliRunManager {
  private deps: CliRunManagerDeps
  private killTree: (pid: number) => Promise<void>
  private now: () => number
  private maxConcurrent: Record<CliRuntimeId, number>
  private activeSessions = new Set<string>()
  private activeRuns = new Map<string, ActiveRun>()
  private queue: QueuedTask[] = []
  private googleLockHeld = false

  constructor(deps: CliRunManagerDeps = {}) {
    this.deps = deps
    this.killTree = deps.killTree ?? defaultKillTree
    this.now = deps.now ?? Date.now
    this.maxConcurrent = {
      antigravity: deps.maxConcurrent?.antigravity ?? MAX_CONCURRENT.antigravity,
      opencode: deps.maxConcurrent?.opencode ?? MAX_CONCURRENT.opencode
    }
  }

  async runTask(input: RunTaskInput): Promise<CliTerminalResult> {
    if (!input.task || !input.task.trim()) {
      throw new Error('Task must not be empty')
    }
    if (Buffer.byteLength(input.task, 'utf8') > TASK_MAX_BYTES) {
      throw new Error(`Task exceeds maximum size of ${TASK_MAX_BYTES} bytes`)
    }
    if (this.activeSessions.has(input.sessionId)) {
      throw new Error(`Session ${input.sessionId} already has an active task`)
    }

    const binary = input.binaryPath?.trim() || this.deps.resolveBinary?.(input.agent.runtime, input.agent)
    if (!binary) {
      throw new Error(`[meow] Cannot find binary for runtime: ${input.agent.runtime}`)
    }

    this.activeSessions.add(input.sessionId)

    return new Promise<CliTerminalResult>((resolve, reject) => {
      const queuedTask: QueuedTask = {
        input: { ...input, binaryPath: binary },
        resolve,
        reject,
        cancelled: false
      }
      this.queue.push(queuedTask)
      this.drainQueue()
    })
  }

  cancel(sessionId: string): boolean {
    const queueIndex = this.queue.findIndex(item => item.input.sessionId === sessionId)
    if (queueIndex !== -1) {
      const [item] = this.queue.splice(queueIndex, 1)
      item.cancelled = true
      this.activeSessions.delete(sessionId)

      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'info',
        text: 'Task was cancelled',
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'cancelled',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'idle')

      item.resolve({
        status: 'cancelled',
        text: '',
        error: 'Task was cancelled'
      })
      return true
    }

    const run = this.activeRuns.get(sessionId)
    if (run) {
      run.cancel().catch(() => {})
      return true
    }

    return false
  }

  async cancelAll(): Promise<void> {
    const killPromises: Promise<void>[] = []

    const queuedIds = this.queue.map(item => item.input.sessionId)
    for (const id of queuedIds) {
      this.cancel(id)
    }

    const activeRuns = [...this.activeRuns.values()]
    for (const run of activeRuns) {
      killPromises.push(run.cancel())
    }

    await Promise.all(killPromises)
  }

  activeCount(runtime?: CliRuntimeId): number {
    if (!runtime) {
      return this.activeRuns.size
    }
    let count = 0
    for (const run of this.activeRuns.values()) {
      if (run.runtime === runtime) {
        count++
      }
    }
    return count
  }

  queuedCount(runtime?: CliRuntimeId): number {
    let count = 0
    for (const item of this.queue) {
      if (!item.cancelled) {
        if (!runtime || item.input.agent.runtime === runtime) {
          count++
        }
      }
    }
    return count
  }

  private drainQueue(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i]
      if (item.cancelled) {
        this.queue.splice(i, 1)
        i--
        continue
      }

      const runtime = item.input.agent.runtime
      const isGoogle = runtime === 'antigravity' && item.input.agent.kind === 'google'
      const max = this.maxConcurrent[runtime] ?? MAX_CONCURRENT[runtime]
      const currentActive = this.activeCount(runtime)

      if (currentActive >= max) {
        continue
      }

      if (isGoogle && this.googleLockHeld) {
        continue
      }

      this.queue.splice(i, 1)
      i--

      if (isGoogle) {
        this.googleLockHeld = true
      }

      this.executeTask(item)
    }
  }

  private async executeTask(item: QueuedTask): Promise<void> {
    const { input, resolve } = item
    const sessionId = input.sessionId
    const runtime = input.agent.runtime
    const isGoogle = runtime === 'antigravity' && input.agent.kind === 'google'

    let timer: NodeJS.Timeout | undefined
    let isCancelled = false
    let isTimeout = false
    let terminalResult: CliTerminalResult | null = null

    try {
      const binary = input.binaryPath!

      let args: string[]
      if (runtime === 'antigravity') {
        args = buildAntigravityArgs({
          task: input.task,
          model: input.agent.model,
          policy: input.policy
        })
      } else if (runtime === 'opencode') {
        args = buildOpenCodeArgs({
          task: input.task,
          model: input.agent.model,
          policy: input.policy
        })
      } else {
        throw new Error(`[meow] Unsupported runtime: ${runtime}`)
      }

      const env = buildCliEnv(input.agent, input.env)
      const { command: spawnCmd, args: spawnArgs } = buildSpawnCommand(binary, args)
      const isCmdWrap = spawnCmd.toLowerCase() === 'cmd.exe'

      const parser = runtime === 'antigravity'
        ? createAntigravityParser()
        : createOpenCodeParser()

      const spawnFn = this.deps.spawn ?? nodeSpawn
      const child = spawnFn(spawnCmd, spawnArgs, {
        cwd: input.cwd,
        env,
        windowsHide: true,
        ...(isCmdWrap ? { windowsVerbatimArguments: true } : {}),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let cancelPromise: Promise<void> | undefined
      const activeRun: ActiveRun = {
        sessionId,
        runtime,
        isGoogle,
        child,
        pid: child.pid,
        cancel: () => {
          isCancelled = true
          if (!cancelPromise) {
            if (child.pid) {
              cancelPromise = this.killTree(child.pid).catch(() => {})
            } else {
              cancelPromise = Promise.resolve()
            }
          }
          return cancelPromise
        }
      }
      this.activeRuns.set(sessionId, activeRun)

      this.deps.onStatus?.(sessionId, 'running')

      if (child.stdin) {
        try {
          child.stdin.end()
        } catch {
          // ignore
        }
      }

      const timeoutMs = input.policy.timeoutMs ?? this.deps.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          isTimeout = true
          if (child.pid) {
            this.killTree(child.pid).catch(() => {})
          }
        }, timeoutMs)
        activeRun.timer = timer
      }

      let stdoutRemainder = ''
      let stderrBuffer = ''
      let stderrTruncated = false

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer | string) => {
          const text = stdoutRemainder + chunk.toString('utf8')
          const lines = text.split(/\r?\n/)
          stdoutRemainder = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const parsed = parser.parseLine(line, this.now())
            if (parsed.terminal) {
              terminalResult = parsed.terminal
            }
            for (const evItem of parsed.items) {
              this.deps.onEvent?.(sessionId, evItem)
            }
          }
        })
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer | string) => {
          const str = chunk.toString('utf8')
          const currentBytes = Buffer.byteLength(stderrBuffer, 'utf8')
          if (currentBytes < STDERR_MAX_BYTES) {
            const chunkBytes = Buffer.byteLength(str, 'utf8')
            if (currentBytes + chunkBytes <= STDERR_MAX_BYTES) {
              stderrBuffer += str
            } else {
              const allowed = STDERR_MAX_BYTES - currentBytes
              stderrBuffer += Buffer.from(str, 'utf8').subarray(0, allowed).toString('utf8')
              stderrTruncated = true
            }
          } else {
            stderrTruncated = true
          }
        })
      }

      const exitResult = await new Promise<{ code: number | null; signal: string | null }>((resExit) => {
        child.on('error', () => {
          resExit({ code: 1, signal: null })
        })
        child.on('exit', (code, signal) => {
          resExit({ code, signal })
        })
      })

      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }

      if (stdoutRemainder.trim()) {
        const parsed = parser.parseLine(stdoutRemainder, this.now())
        if (parsed.terminal) {
          terminalResult = parsed.terminal
        }
        for (const evItem of parsed.items) {
          this.deps.onEvent?.(sessionId, evItem)
        }
        stdoutRemainder = ''
      }

      if (stderrBuffer.trim()) {
        const text = stderrTruncated
          ? `${stderrBuffer.trim()}\n... [stderr truncated]`
          : stderrBuffer.trim()
        const level = exitResult.code === 0 && !exitResult.signal ? 'info' : 'warn'
        this.deps.onEvent?.(sessionId, {
          kind: 'notice',
          level,
          text,
          at: this.now()
        })
      }

      const finalResult = this.finalizeResult({
        sessionId,
        terminalResult,
        isCancelled,
        isTimeout,
        exitCode: exitResult.code,
        signal: exitResult.signal,
        timeoutMs
      })

      resolve(finalResult)
    } catch (err: unknown) {
      if (timer) {
        clearTimeout(timer)
      }
      const errorText = err instanceof Error ? err.message : String(err)
      const errResult: CliTerminalResult = {
        status: 'failed',
        text: '',
        error: errorText
      }
      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'error',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'failed',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'failed')
      resolve(errResult)
    } finally {
      this.activeRuns.delete(sessionId)
      this.activeSessions.delete(sessionId)

      if (isGoogle) {
        this.googleLockHeld = false
      }

      this.drainQueue()
    }
  }

  private finalizeResult(opts: {
    sessionId: string
    terminalResult: CliTerminalResult | null
    isCancelled: boolean
    isTimeout: boolean
    exitCode: number | null
    signal: string | null
    timeoutMs: number
  }): CliTerminalResult {
    const { sessionId, terminalResult, isCancelled, isTimeout, exitCode, signal, timeoutMs } = opts
    let finalResult: CliTerminalResult

    if (isCancelled) {
      finalResult = {
        status: 'cancelled',
        text: '',
        error: 'Task was cancelled'
      }
      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'info',
        text: 'Task was cancelled',
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'cancelled',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'idle')
    } else if (isTimeout) {
      const errorText = `Task timed out after ${timeoutMs}ms`
      finalResult = {
        status: 'timeout',
        text: '',
        error: errorText
      }
      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'warn',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'timeout',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'failed')
    } else if (terminalResult) {
      finalResult = { ...terminalResult }
      if (finalResult.text && Buffer.byteLength(finalResult.text, 'utf8') > RESULT_MAX_BYTES) {
        finalResult.text = truncateUtf8(finalResult.text, RESULT_MAX_BYTES)
      }

      let sessionStatus: CliSessionStatus = 'idle'
      if (finalResult.deniedActions && finalResult.deniedActions.length > 0) {
        sessionStatus = 'needs-attention'
      } else if (finalResult.status === 'failed' || finalResult.status === 'timeout') {
        sessionStatus = 'failed'
      } else {
        sessionStatus = 'idle'
      }
      this.deps.onStatus?.(sessionId, sessionStatus)
    } else if (exitCode === 0 && !signal) {
      finalResult = {
        status: 'completed',
        text: ''
      }
      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'info',
        text: 'CLI process exited with code 0 with no terminal event',
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'completed',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'idle')
    } else {
      const errorText = signal
        ? `CLI process killed with signal ${signal}`
        : `CLI process exited with code ${exitCode ?? 'unknown'}`
      finalResult = {
        status: 'failed',
        text: '',
        error: errorText
      }
      this.deps.onEvent?.(sessionId, {
        kind: 'notice',
        level: 'error',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(sessionId, {
        kind: 'result',
        status: 'failed',
        text: '',
        at: this.now()
      })
      this.deps.onStatus?.(sessionId, 'failed')
    }

    return finalResult
  }
}
