import type { ChildProcess } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import kill from 'tree-kill'
import type { CliTranscriptItem } from '../../shared/types'
import { buildSpawnCommand } from '../pty-manager'
import {
  DEFAULT_TASK_TIMEOUT_MS,
  isEnvAllowed,
  RESULT_MAX_BYTES,
  STDERR_MAX_BYTES,
  TASK_MAX_BYTES
} from './constants'
import { createAntigravityParser } from './parsers/antigravity'
import type { CliTerminalResult } from './parsers/types'
import type { CliPolicy } from './policy'
import { buildAntigravityArgs } from './policy'

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
  maxConcurrent?: number
  timeoutMs?: number
  onEvent?: (runId: string, item: CliTranscriptItem) => void
}

export interface RunTaskInput {
  runId: string
  task: string
  cwd: string
  policy: CliPolicy
  binaryPath: string
}

interface QueuedTask {
  input: RunTaskInput
  resolve: (result: CliTerminalResult) => void
  reject: (err: unknown) => void
  cancelled: boolean
}

interface ActiveRun {
  runId: string
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

/** Minimal environment for the CLI: only allowlisted variables are inherited. */
export function buildCliEnv(
  sourceProcessEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const resultEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(sourceProcessEnv)) {
    if (value !== undefined && isEnvAllowed(key, platform)) {
      resultEnv[key] = value
    }
  }
  return resultEnv
}

export class CliRunManager {
  private deps: CliRunManagerDeps
  private killTree: (pid: number) => Promise<void>
  private now: () => number
  private maxConcurrent: number
  private activeIds = new Set<string>()
  private activeRuns = new Map<string, ActiveRun>()
  private queue: QueuedTask[] = []

  constructor(deps: CliRunManagerDeps = {}) {
    this.deps = deps
    this.killTree = deps.killTree ?? defaultKillTree
    this.now = deps.now ?? Date.now
    this.maxConcurrent = deps.maxConcurrent ?? 1
  }

  async runTask(input: RunTaskInput): Promise<CliTerminalResult> {
    if (!input.task || !input.task.trim()) {
      throw new Error('Task must not be empty')
    }
    if (Buffer.byteLength(input.task, 'utf8') > TASK_MAX_BYTES) {
      throw new Error(`Task exceeds maximum size of ${TASK_MAX_BYTES} bytes`)
    }
    if (this.activeIds.has(input.runId)) {
      throw new Error(`Session ${input.runId} already has an active task`)
    }

    if (!input.binaryPath || !input.binaryPath.trim()) {
      throw new Error('[meow] Antigravity CLI binary path is missing')
    }

    this.activeIds.add(input.runId)

    return new Promise<CliTerminalResult>((resolve, reject) => {
      const queuedTask: QueuedTask = {
        input,
        resolve,
        reject,
        cancelled: false
      }
      this.queue.push(queuedTask)
      this.drainQueue()
    })
  }

  cancel(runId: string): boolean {
    const queueIndex = this.queue.findIndex(item => item.input.runId === runId)
    if (queueIndex !== -1) {
      const [item] = this.queue.splice(queueIndex, 1)
      item.cancelled = true
      this.activeIds.delete(runId)

      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'info',
        text: 'Task was cancelled',
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'cancelled',
        text: '',
        at: this.now()
      })

      item.resolve({
        status: 'cancelled',
        text: '',
        error: 'Task was cancelled'
      })
      return true
    }

    const run = this.activeRuns.get(runId)
    if (run) {
      run.cancel().catch(() => {})
      return true
    }

    return false
  }

  async cancelAll(): Promise<void> {
    const killPromises: Promise<void>[] = []

    const queuedIds = this.queue.map(item => item.input.runId)
    for (const id of queuedIds) {
      this.cancel(id)
    }

    const activeRuns = [...this.activeRuns.values()]
    for (const run of activeRuns) {
      killPromises.push(run.cancel())
    }

    await Promise.all(killPromises)
  }

  activeCount(): number {
    return this.activeRuns.size
  }

  queuedCount(): number {
    return this.queue.filter(item => !item.cancelled).length
  }

  private drainQueue(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i]
      if (item.cancelled) {
        this.queue.splice(i, 1)
        i--
        continue
      }

      if (this.activeRuns.size >= this.maxConcurrent) {
        break
      }

      this.queue.splice(i, 1)
      i--

      this.executeTask(item)
    }
  }

  private async executeTask(item: QueuedTask): Promise<void> {
    const { input, resolve } = item
    const runId = input.runId

    let timer: NodeJS.Timeout | undefined
    let isCancelled = false
    let isTimeout = false
    let terminalResult: CliTerminalResult | null = null

    try {
      const args = buildAntigravityArgs({ task: input.task, policy: input.policy })
      const env = buildCliEnv()
      const { command: spawnCmd, args: spawnArgs } = buildSpawnCommand(input.binaryPath, args)
      const isCmdWrap = spawnCmd.toLowerCase() === 'cmd.exe'
      const parser = createAntigravityParser()

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
        runId,
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
      this.activeRuns.set(runId, activeRun)


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
              this.deps.onEvent?.(runId, evItem)
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
          this.deps.onEvent?.(runId, evItem)
        }
        stdoutRemainder = ''
      }

      if (stderrBuffer.trim()) {
        const text = stderrTruncated
          ? `${stderrBuffer.trim()}\n... [stderr truncated]`
          : stderrBuffer.trim()
        const level = exitResult.code === 0 && !exitResult.signal ? 'info' : 'warn'
        this.deps.onEvent?.(runId, {
          kind: 'notice',
          level,
          text,
          at: this.now()
        })
      }

      const finalResult = this.finalizeResult({
        runId,
        terminalResult,
        isCancelled,
        isTimeout,
        exitCode: exitResult.code,
        signal: exitResult.signal,
        timeoutMs,
        stderr: stderrBuffer.trim()
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
      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'error',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'failed',
        text: '',
        at: this.now()
      })
      resolve(errResult)
    } finally {
      this.activeRuns.delete(runId)
      this.activeIds.delete(runId)

      this.drainQueue()
    }
  }

  private finalizeResult(opts: {
    runId: string
    terminalResult: CliTerminalResult | null
    isCancelled: boolean
    isTimeout: boolean
    exitCode: number | null
    signal: string | null
    timeoutMs: number
    stderr: string
  }): CliTerminalResult {
    const { runId, terminalResult, isCancelled, isTimeout, exitCode, signal, timeoutMs, stderr } = opts
    let finalResult: CliTerminalResult

    if (isCancelled) {
      finalResult = {
        status: 'cancelled',
        text: '',
        error: 'Task was cancelled'
      }
      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'info',
        text: 'Task was cancelled',
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'cancelled',
        text: '',
        at: this.now()
      })
    } else if (isTimeout) {
      const errorText = `Task timed out after ${timeoutMs}ms`
      finalResult = {
        status: 'timeout',
        text: '',
        error: errorText
      }
      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'warn',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'timeout',
        text: '',
        at: this.now()
      })
    } else if (terminalResult) {
      finalResult = { ...terminalResult }
      if (finalResult.text && Buffer.byteLength(finalResult.text, 'utf8') > RESULT_MAX_BYTES) {
        finalResult.text = truncateUtf8(finalResult.text, RESULT_MAX_BYTES)
      }

    } else if (exitCode === 0 && !signal) {
      finalResult = {
        status: 'completed',
        text: ''
      }
      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'info',
        text: 'CLI process exited with code 0 with no terminal event',
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'completed',
        text: '',
        at: this.now()
      })
    } else {
      const errorText = signal
        ? `CLI process killed with signal ${signal}`
        : `CLI process exited with code ${exitCode ?? 'unknown'}`
      finalResult = {
        status: 'failed',
        text: '',
        error: stderr ? `${errorText}
${stderr}` : errorText
      }
      this.deps.onEvent?.(runId, {
        kind: 'notice',
        level: 'error',
        text: errorText,
        at: this.now()
      })
      this.deps.onEvent?.(runId, {
        kind: 'result',
        status: 'failed',
        text: '',
        at: this.now()
      })
    }

    return finalResult
  }
}
