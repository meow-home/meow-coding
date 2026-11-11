import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { CliTranscriptItem } from '../../src/shared/types'
import type { CliPolicy } from '../../src/main/cli-agents/policy'
import {
  RESULT_MAX_BYTES,
  STDERR_MAX_BYTES,
  TASK_MAX_BYTES
} from '../../src/main/cli-agents/constants'
import {
  buildCliEnv,
  CliRunManager,
  truncateUtf8
} from '../../src/main/cli-agents/run-manager'

function createFakeProcess(pid = 1234) {
  const proc = new EventEmitter() as any
  proc.pid = pid
  proc.stdin = new PassThrough()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.kill = vi.fn()
  return proc
}

const basePolicy: CliPolicy = {
  mode: 'edit',
  allowCommands: true,
  allowWrites: true,
  allowUrl: true,
  timeoutMs: 60000
}

describe('CliRunManager', () => {
  it('successful Antigravity run with init/text/tool/result -> items + completed result', async () => {
    const proc = createFakeProcess(1001)
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stdout.write(JSON.stringify({ event: 'init', conversation_id: 'conv-101' }) + '\n')
        proc.stdout.write(
          JSON.stringify({
            event: 'step_update',
            step_update: { step_index: 1, step_type: 'agent_response', text_delta: 'Hello world' }
          }) + '\n'
        )
        proc.stdout.write(
          JSON.stringify({
            event: 'step_update',
            step_update: {
              step_index: 2,
              state: 'DONE',
              step_type: 'tool',
              tool_name: 'read_file',
              tool_info: { name: 'read_file', parameters: { path: 'test.txt' }, output: 'content' }
            }
          }) + '\n'
        )
        proc.stdout.write(
          JSON.stringify({
            event: 'result',
            result: {
              status: 'SUCCESS',
              response: 'All tasks completed',
              usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 }
            }
          }) + '\n'
        )
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const events: CliTranscriptItem[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item)
    })

    const result = await manager.runTask({
      runId: 's-success',
      task: 'Run inspection',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('completed')
    expect(result.text).toBe('All tasks completed')
    expect(result.usage).toEqual({ input: 50, output: 25, total: 75 })


    const assistantItems = events.filter((e) => e.kind === 'assistant')
    expect(assistantItems.length).toBeGreaterThan(0)
    expect(assistantItems[0].text).toBe('Hello world')

    const toolItems = events.filter((e) => e.kind === 'tool')
    expect(toolItems.length).toBeGreaterThan(0)
    expect((toolItems[0] as any).tool).toBe('read_file')

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('completed')
  })

  it('missing terminal event with exit 0 -> completed + notice', async () => {
    const proc = createFakeProcess(1002)
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stdout.write('Some stdout with no terminal event\n')
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const events: CliTranscriptItem[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item)
    })

    const result = await manager.runTask({
      runId: 's-no-terminal',
      task: 'Run without result event',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('completed')

    const notices = events.filter((e) => e.kind === 'notice')
    expect(notices.length).toBeGreaterThan(0)
    expect(notices[0].text).toContain('code 0')

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('completed')
  })

  it('non-zero exit -> failed + stderr notice', async () => {
    const proc = createFakeProcess(1003)
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stderr.write('Fatal error in CLI command\n')
        proc.emit('exit', 2, null)
      })
      return proc
    })

    const events: CliTranscriptItem[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item)
    })

    const result = await manager.runTask({
      runId: 's-fail',
      task: 'Failing command',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('code 2')
    expect(result.error).toContain('Fatal error in CLI command')

    const warnNotices = events.filter((e) => e.kind === 'notice' && e.level === 'warn')
    expect(warnNotices.length).toBe(1)
    expect(warnNotices[0].text).toContain('Fatal error in CLI command')

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('failed')
  })

  it('timeout -> timeout + killTree called', async () => {
    const proc = createFakeProcess(1004)
    const killTree = vi.fn().mockImplementation(async () => {
      proc.emit('exit', null, 'SIGTERM')
    })
    const spawn = vi.fn().mockReturnValue(proc)

    const events: CliTranscriptItem[] = []

    const manager = new CliRunManager({
      spawn,
      killTree,
      timeoutMs: 25,
      onEvent: (_sid, item) => events.push(item)
    })

    const result = await manager.runTask({
      runId: 's-timeout',
      task: 'Hanging command',
      cwd: '/test/dir',
      policy: { ...basePolicy, timeoutMs: 25 },
      binaryPath: 'agy'
    })

    expect(result.status).toBe('timeout')
    expect(killTree).toHaveBeenCalledWith(1004)

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('timeout')
  })

  it('cancel -> cancelled + killTree called', async () => {
    const proc = createFakeProcess(1005)
    const killTree = vi.fn().mockImplementation(async () => {
      proc.emit('exit', null, 'SIGTERM')
    })
    const spawn = vi.fn().mockReturnValue(proc)

    const events: CliTranscriptItem[] = []

    const manager = new CliRunManager({
      spawn,
      killTree,
      onEvent: (_sid, item) => events.push(item)
    })

    const runPromise = manager.runTask({
      runId: 's-cancel',
      task: 'Task to cancel',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(manager.activeCount()).toBe(1)
    const cancelled = manager.cancel('s-cancel')
    expect(cancelled).toBe(true)

    const result = await runPromise
    expect(result.status).toBe('cancelled')
    expect(killTree).toHaveBeenCalledWith(1005)

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('cancelled')
  })

  it('runs one task at a time by default and keeps FIFO order', async () => {
    const proc1 = createFakeProcess(2001)
    const proc2 = createFakeProcess(2002)

    let callCount = 0
    const spawn = vi.fn().mockImplementation(() => {
      callCount++
      return callCount === 1 ? proc1 : proc2
    })

    const manager = new CliRunManager({
      spawn,
      maxConcurrent: 1
    })

    const run1 = manager.runTask({
      runId: 's-c1',
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const run2 = manager.runTask({
      runId: 's-c2',
      task: 'Task 2',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(manager.activeCount()).toBe(1)
    expect(manager.queuedCount()).toBe(1)

    // Complete run 1
    proc1.stdout.write(
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Task 1 done' } }) +
        '\n'
    )
    proc1.emit('exit', 0, null)

    const res1 = await run1
    expect(res1.status).toBe('completed')
    expect(res1.text).toBe('Task 1 done')

    // Run 2 starts
    expect(manager.activeCount()).toBe(1)
    expect(manager.queuedCount()).toBe(0)

    // Complete run 2
    proc2.stdout.write(
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Task 2 done' } }) +
        '\n'
    )
    proc2.emit('exit', 0, null)

    const res2 = await run2
    expect(res2.status).toBe('completed')
    expect(res2.text).toBe('Task 2 done')
    expect(manager.activeCount()).toBe(0)
  })

  it('a second runTask for the same run id rejects', async () => {
    const proc = createFakeProcess(6001)
    const spawn = vi.fn().mockReturnValue(proc)
    const manager = new CliRunManager({ spawn })

    const runPromise1 = manager.runTask({
      runId: 'same-session',
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    await expect(
      manager.runTask({
        runId: 'same-session',
        task: 'Task 2',
        cwd: '/test',
        policy: basePolicy,
        binaryPath: 'agy'
      })
    ).rejects.toThrow('already has an active task')

    proc.emit('exit', 0, null)
    await runPromise1
  })

  it('task size limit', async () => {
    const manager = new CliRunManager({
      resolveBinary: () => 'agy'
    })

    await expect(
      manager.runTask({
        runId: 's-empty',
        task: '   ',
        cwd: '/test',
        policy: basePolicy
      })
    ).rejects.toThrow('Task must not be empty')

    const oversized = 'x'.repeat(TASK_MAX_BYTES + 1)
    await expect(
      manager.runTask({
        runId: 's-oversized',
        task: oversized,
        cwd: '/test',
        policy: basePolicy
      })
    ).rejects.toThrow('exceeds maximum size')
  })

  it('cancels queued tasks via cancel and cancelAll', async () => {
    const proc1 = createFakeProcess(7001)
    const spawn = vi.fn().mockReturnValue(proc1)

    const manager = new CliRunManager({
      spawn,
      maxConcurrent: 1
    })

    const run1 = manager.runTask({
      runId: 's-run-1',
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const run2 = manager.runTask({
      runId: 's-run-2',
      task: 'Task 2',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(manager.queuedCount()).toBe(1)
    const cancelledQueued = manager.cancel('s-run-2')
    expect(cancelledQueued).toBe(true)
    expect(manager.queuedCount()).toBe(0)

    const res2 = await run2
    expect(res2.status).toBe('cancelled')

    // Add another task to queue
    const run3 = manager.runTask({
      runId: 's-run-3',
      task: 'Task 3',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })
    expect(manager.queuedCount()).toBe(1)

    await manager.cancelAll()
    expect(manager.queuedCount()).toBe(0)

    proc1.emit('exit', null, 'SIGTERM')
    const [res1, res3] = await Promise.all([run1, run3])
    expect(res1.status).toBe('cancelled')
    expect(res3.status).toBe('cancelled')
  })

  it('truncates result text and stderr when exceeding byte limits', async () => {
    const proc = createFakeProcess(9001)
    const hugeStderr = 'E'.repeat(STDERR_MAX_BYTES + 500)
    const hugeResultText = 'R'.repeat(RESULT_MAX_BYTES + 500)

    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stderr.write(hugeStderr)
        proc.stdout.write(
          JSON.stringify({
            event: 'result',
            result: {
              status: 'SUCCESS',
              response: hugeResultText
            }
          }) + '\n'
        )
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const events: CliTranscriptItem[] = []
    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item)
    })

    const result = await manager.runTask({
      runId: 's-truncate',
      task: 'Task with huge output',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.text).toContain('... [truncated]')
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(RESULT_MAX_BYTES + 50)

    const stderrNotice = events.find(
      (e) => e.kind === 'notice' && e.text.includes('... [stderr truncated]')
    )
    expect(stderrNotice).toBeDefined()
    expect(stderrNotice?.level).toBe('info')
  })

  it('passes windowsVerbatimArguments: true when resolved command is cmd.exe', async () => {
    let capturedOptions: any
    const proc = createFakeProcess(9902)
    const spawn = vi.fn().mockImplementation((_cmd, _args, opts) => {
      capturedOptions = opts
      queueMicrotask(() => {
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const manager = new CliRunManager({ spawn })
    await manager.runTask({
      runId: 's-cmd-exe',
      task: 'Say hello',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'cmd.exe'
    })

    expect(capturedOptions).toBeDefined()
    expect(capturedOptions.windowsVerbatimArguments).toBe(true)
  })

  it('disables timer when timeoutMs is 0', async () => {
    const proc = createFakeProcess(9903)
    const spawn = vi.fn().mockReturnValue(proc)
    const killTree = vi.fn()

    const manager = new CliRunManager({
      spawn,
      killTree,
      timeoutMs: 50
    })

    const runPromise = manager.runTask({
      runId: 's-zero-timeout',
      task: 'Task with zero timeout',
      cwd: '/test',
      policy: { ...basePolicy, timeoutMs: 0 },
      binaryPath: 'agy'
    })

    await new Promise((r) => setTimeout(r, 70))
    expect(killTree).not.toHaveBeenCalled()
    expect(manager.activeCount()).toBe(1)

    proc.emit('exit', 0, null)
    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('cancelAll waits for the kill callback of active runs before resolving', async () => {
    const proc = createFakeProcess(9904)
    const spawn = vi.fn().mockReturnValue(proc)

    let finishKill: () => void = () => {}
    const killTree = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        finishKill = resolve
      })
    })

    const manager = new CliRunManager({
      spawn,
      killTree
    })

    const runPromise = manager.runTask({
      runId: 's-kill-wait',
      task: 'Task to cancel with slow kill',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    let cancelAllSettled = false
    const cancelAllPromise = manager.cancelAll().then(() => {
      cancelAllSettled = true
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(killTree).toHaveBeenCalledWith(9904)
    expect(cancelAllSettled).toBe(false)

    finishKill()
    await cancelAllPromise
    expect(cancelAllSettled).toBe(true)

    proc.emit('exit', null, 'SIGTERM')
    const res = await runPromise
    expect(res.status).toBe('cancelled')
  })

  it('emits stderr notice as info on exit code 0 and warn on non-zero exit', async () => {
    const proc = createFakeProcess(9905)
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stderr.write('Diagnostic info on stderr\n')
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const events: CliTranscriptItem[] = []
    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item)
    })

    await manager.runTask({
      runId: 's-stderr-info',
      task: 'Task with benign stderr',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const infoNotice = events.find(
      (e) => e.kind === 'notice' && e.level === 'info' && e.text.includes('Diagnostic info')
    )
    expect(infoNotice).toBeDefined()
  })
})

describe('buildCliEnv', () => {
  it('keeps allowlisted variables and drops everything else, including API keys', () => {
    const env = buildCliEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      LC_ALL: 'en_US.UTF-8',
      OPENAI_API_KEY: 'sk-secret',
      GEMINI_API_KEY: 'gm-secret',
      RANDOM_VAR: 'x'
    }, 'linux')

    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user', LC_ALL: 'en_US.UTF-8' })
  })

  it('matches allowlisted names case-insensitively on Windows', () => {
    const env = buildCliEnv({ Path: 'C:\\bin', userprofile: 'C:\\Users\\u', SECRET: 'x' }, 'win32')
    expect(env).toEqual({ Path: 'C:\\bin', userprofile: 'C:\\Users\\u' })
  })
})

describe('truncateUtf8', () => {
  it('safely truncates text on UTF-8 code point boundaries', () => {
    const emoji = '😀'
    const text = 'abc' + emoji
    expect(truncateUtf8(text, 5)).toBe('abc... [truncated]')
    expect(truncateUtf8(text, 7)).toBe(text)
  })
})
