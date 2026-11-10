import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type {
  CliAgent,
  CliPolicy,
  CliSessionStatus,
  CliTranscriptItem
} from '../../src/shared/types'
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

const baseAgent: CliAgent = {
  id: 'agy-1',
  runtime: 'antigravity',
  kind: 'google',
  label: 'Antigravity Google',
  mode: 'edit',
  status: 'ready',
  createdAt: 1000
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
    const statuses: CliSessionStatus[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item),
      onStatus: (_sid, status) => statuses.push(status)
    })

    const result = await manager.runTask({
      sessionId: 's-success',
      agent: baseAgent,
      task: 'Run inspection',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('completed')
    expect(result.text).toBe('All tasks completed')
    expect(result.usage).toEqual({ input: 50, output: 25, total: 75 })

    expect(statuses).toEqual(['running', 'idle'])

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
    const statuses: CliSessionStatus[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item),
      onStatus: (_sid, status) => statuses.push(status)
    })

    const result = await manager.runTask({
      sessionId: 's-no-terminal',
      agent: baseAgent,
      task: 'Run without result event',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('completed')
    expect(statuses).toEqual(['running', 'idle'])

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
    const statuses: CliSessionStatus[] = []

    const manager = new CliRunManager({
      spawn,
      onEvent: (_sid, item) => events.push(item),
      onStatus: (_sid, status) => statuses.push(status)
    })

    const result = await manager.runTask({
      sessionId: 's-fail',
      agent: baseAgent,
      task: 'Failing command',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('code 2')
    expect(statuses).toEqual(['running', 'failed'])

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
    const statuses: CliSessionStatus[] = []

    const manager = new CliRunManager({
      spawn,
      killTree,
      timeoutMs: 25,
      onEvent: (_sid, item) => events.push(item),
      onStatus: (_sid, status) => statuses.push(status)
    })

    const result = await manager.runTask({
      sessionId: 's-timeout',
      agent: baseAgent,
      task: 'Hanging command',
      cwd: '/test/dir',
      policy: { ...basePolicy, timeoutMs: 25 },
      binaryPath: 'agy'
    })

    expect(result.status).toBe('timeout')
    expect(killTree).toHaveBeenCalledWith(1004)
    expect(statuses).toEqual(['running', 'failed'])

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
    const statuses: CliSessionStatus[] = []

    const manager = new CliRunManager({
      spawn,
      killTree,
      onEvent: (_sid, item) => events.push(item),
      onStatus: (_sid, status) => statuses.push(status)
    })

    const runPromise = manager.runTask({
      sessionId: 's-cancel',
      agent: baseAgent,
      task: 'Task to cancel',
      cwd: '/test/dir',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(manager.activeCount('antigravity')).toBe(1)
    const cancelled = manager.cancel('s-cancel')
    expect(cancelled).toBe(true)

    const result = await runPromise
    expect(result.status).toBe('cancelled')
    expect(killTree).toHaveBeenCalledWith(1005)
    expect(statuses).toEqual(['running', 'idle'])

    const resultItems = events.filter((e) => e.kind === 'result')
    expect(resultItems.length).toBe(1)
    expect((resultItems[0] as any).status).toBe('cancelled')
  })

  it('per-runtime concurrency queue (two runs, max 1 in the test) and FIFO order', async () => {
    const proc1 = createFakeProcess(2001)
    const proc2 = createFakeProcess(2002)

    let callCount = 0
    const spawn = vi.fn().mockImplementation(() => {
      callCount++
      return callCount === 1 ? proc1 : proc2
    })

    const manager = new CliRunManager({
      spawn,
      maxConcurrent: { antigravity: 1 }
    })

    const run1 = manager.runTask({
      sessionId: 's-c1',
      agent: baseAgent,
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const run2 = manager.runTask({
      sessionId: 's-c2',
      agent: baseAgent,
      task: 'Task 2',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(manager.activeCount('antigravity')).toBe(1)
    expect(manager.queuedCount('antigravity')).toBe(1)

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
    expect(manager.activeCount('antigravity')).toBe(1)
    expect(manager.queuedCount('antigravity')).toBe(0)

    // Complete run 2
    proc2.stdout.write(
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Task 2 done' } }) +
        '\n'
    )
    proc2.emit('exit', 0, null)

    const res2 = await run2
    expect(res2.status).toBe('completed')
    expect(res2.text).toBe('Task 2 done')
    expect(manager.activeCount('antigravity')).toBe(0)
  })

  it('Antigravity Google serialization (two Google agents, max concurrent 2, still serialized)', async () => {
    const procG1 = createFakeProcess(3001)
    const procG2 = createFakeProcess(3002)

    let callCount = 0
    const spawn = vi.fn().mockImplementation(() => {
      callCount++
      return callCount === 1 ? procG1 : procG2
    })

    const manager = new CliRunManager({
      spawn,
      maxConcurrent: { antigravity: 2 }
    })

    const googleAgent1: CliAgent = { ...baseAgent, id: 'g-1', kind: 'google' }
    const googleAgent2: CliAgent = { ...baseAgent, id: 'g-2', kind: 'google' }

    const runG1 = manager.runTask({
      sessionId: 's-g1',
      agent: googleAgent1,
      task: 'Task Google 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const runG2 = manager.runTask({
      sessionId: 's-g2',
      agent: googleAgent2,
      task: 'Task Google 2',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    // Serialized because both are Google agents holding the Google credential lock
    expect(manager.activeCount('antigravity')).toBe(1)
    expect(manager.queuedCount('antigravity')).toBe(1)

    procG1.stdout.write(
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'G1 done' } }) + '\n'
    )
    procG1.emit('exit', 0, null)
    await runG1

    expect(manager.activeCount('antigravity')).toBe(1)
    expect(manager.queuedCount('antigravity')).toBe(0)

    procG2.stdout.write(
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'G2 done' } }) + '\n'
    )
    procG2.emit('exit', 0, null)
    await runG2

    expect(manager.activeCount('antigravity')).toBe(0)
    expect(manager.queuedCount('antigravity')).toBe(0)
  })

  it('env allowlist: an inherited OPENAI_API_KEY is stripped; GEMINI_API_KEY from input env is kept for gemini-key', async () => {
    const origOpenAi = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'inherited-openai-secret'

    try {
      let capturedEnv: NodeJS.ProcessEnv | undefined
      const proc = createFakeProcess(4001)
      const spawn = vi.fn().mockImplementation((_cmd, _args, opts) => {
        capturedEnv = opts.env
        queueMicrotask(() => {
          proc.emit('exit', 0, null)
        })
        return proc
      })

      const geminiAgent: CliAgent = {
        ...baseAgent,
        id: 'gemini-1',
        kind: 'gemini-key'
      }

      const manager = new CliRunManager({ spawn })
      await manager.runTask({
        sessionId: 's-env-check',
        agent: geminiAgent,
        task: 'Test environment variables',
        cwd: '/test',
        policy: basePolicy,
        binaryPath: 'agy',
        env: {
          GEMINI_API_KEY: 'injected-gemini-key',
          ANTHROPIC_API_KEY: 'should-be-stripped'
        }
      })

      expect(capturedEnv).toBeDefined()
      expect(capturedEnv!.OPENAI_API_KEY).toBeUndefined()
      expect(capturedEnv!.ANTHROPIC_API_KEY).toBeUndefined()
      expect(capturedEnv!.GEMINI_API_KEY).toBe('injected-gemini-key')
    } finally {
      if (origOpenAi === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = origOpenAi
      }
    }
  })

  it('OpenCode profile env (XDG_DATA_HOME, OPENCODE_DB) is passed', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    const proc = createFakeProcess(5001)
    const spawn = vi.fn().mockImplementation((_cmd, _args, opts) => {
      capturedEnv = opts.env
      queueMicrotask(() => {
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const opencodeAgent: CliAgent = {
      id: 'oc-1',
      runtime: 'opencode',
      kind: 'profile',
      label: 'OpenCode Work',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    }

    const manager = new CliRunManager({ spawn })
    await manager.runTask({
      sessionId: 's-oc-env',
      agent: opencodeAgent,
      task: 'Run opencode task',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'opencode.cmd',
      env: {
        XDG_DATA_HOME: '/custom/profile/data',
        OPENCODE_DB: '/custom/profile/data/opencode.db'
      }
    })

    expect(capturedEnv).toBeDefined()
    expect(capturedEnv!.XDG_DATA_HOME).toBe('/custom/profile/data')
    expect(capturedEnv!.OPENCODE_DB).toBe('/custom/profile/data/opencode.db')
  })

  it('a second runTask for the same session rejects', async () => {
    const proc = createFakeProcess(6001)
    const spawn = vi.fn().mockReturnValue(proc)
    const manager = new CliRunManager({ spawn })

    const runPromise1 = manager.runTask({
      sessionId: 'same-session',
      agent: baseAgent,
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    await expect(
      manager.runTask({
        sessionId: 'same-session',
        agent: baseAgent,
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
        sessionId: 's-empty',
        agent: baseAgent,
        task: '   ',
        cwd: '/test',
        policy: basePolicy
      })
    ).rejects.toThrow('Task must not be empty')

    const oversized = 'x'.repeat(TASK_MAX_BYTES + 1)
    await expect(
      manager.runTask({
        sessionId: 's-oversized',
        agent: baseAgent,
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
      maxConcurrent: { antigravity: 1 }
    })

    const run1 = manager.runTask({
      sessionId: 's-run-1',
      agent: baseAgent,
      task: 'Task 1',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    const run2 = manager.runTask({
      sessionId: 's-run-2',
      agent: baseAgent,
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
      sessionId: 's-run-3',
      agent: baseAgent,
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

  it('transitions session status to needs-attention when denied actions are present', async () => {
    const proc = createFakeProcess(8001)
    const spawn = vi.fn().mockImplementation(() => {
      queueMicrotask(() => {
        proc.stdout.write(
          JSON.stringify({
            event: 'result',
            result: {
              status: 'SUCCESS',
              response: 'Partially done',
              denied_actions: [{ action: 'command', parameters: { CommandLine: 'rm -rf /' } }]
            }
          }) + '\n'
        )
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const statuses: CliSessionStatus[] = []
    const manager = new CliRunManager({
      spawn,
      onStatus: (_sid, s) => statuses.push(s)
    })

    const result = await manager.runTask({
      sessionId: 's-denied',
      agent: baseAgent,
      task: 'Task with denials',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'agy'
    })

    expect(result.deniedActions).toEqual(['command(rm -rf /)'])
    expect(statuses).toEqual(['running', 'needs-attention'])
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
      sessionId: 's-truncate',
      agent: baseAgent,
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

  it('passes windowsVerbatimArguments: true when wrapped with cmd.exe on win32 (OpenCode .cmd)', async () => {
    let capturedOptions: any
    const proc = createFakeProcess(9901)
    const spawn = vi.fn().mockImplementation((_cmd, _args, opts) => {
      capturedOptions = opts
      queueMicrotask(() => {
        proc.emit('exit', 0, null)
      })
      return proc
    })

    const manager = new CliRunManager({ spawn })
    const ocAgent: CliAgent = {
      id: 'oc-cmd',
      runtime: 'opencode',
      kind: 'profile',
      label: 'OpenCode Cmd',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    }

    await manager.runTask({
      sessionId: 's-opencode-cmd',
      agent: ocAgent,
      task: 'Say "hello world"',
      cwd: '/test',
      policy: basePolicy,
      binaryPath: 'opencode.cmd'
    })

    expect(capturedOptions).toBeDefined()
    if (process.platform === 'win32') {
      expect(capturedOptions.windowsVerbatimArguments).toBe(true)
    }
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
      sessionId: 's-cmd-exe',
      agent: baseAgent,
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
      sessionId: 's-zero-timeout',
      agent: baseAgent,
      task: 'Task with zero timeout',
      cwd: '/test',
      policy: { ...basePolicy, timeoutMs: 0 },
      binaryPath: 'agy'
    })

    await new Promise((r) => setTimeout(r, 70))
    expect(killTree).not.toHaveBeenCalled()
    expect(manager.activeCount('antigravity')).toBe(1)

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
      sessionId: 's-kill-wait',
      agent: baseAgent,
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
      sessionId: 's-stderr-info',
      agent: baseAgent,
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
  it('preserves allowlisted vars and strips unknown API keys', () => {
    const srcEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      USERPROFILE: 'C:\\Users\\user',
      TMP: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy.local:8080',
      OPENAI_API_KEY: 'sk-secret-123',
      RANDOM_VAR: 'random-val'
    }

    const env = buildCliEnv(baseAgent, undefined, srcEnv, 'linux')
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.LC_ALL).toBe('en_US.UTF-8')
    expect(env.HTTP_PROXY).toBe('http://proxy.local:8080')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.RANDOM_VAR).toBeUndefined()
  })

  it('drops unexpected keys from inputEnv and only allows the explicit whitelist', () => {
    const agent: CliAgent = {
      ...baseAgent,
      id: 'gemini-1',
      kind: 'gemini-key'
    }

    const inputEnv = {
      GEMINI_API_KEY: 'valid-gemini-key',
      GITHUB_TOKEN: 'leaked-token',
      AWS_SECRET_ACCESS_KEY: 'leaked-aws-key',
      CUSTOM_SECRET: 'leaked-secret'
    }

    const env = buildCliEnv(agent, inputEnv, { PATH: '/usr/bin' }, 'linux')
    expect(env.GEMINI_API_KEY).toBe('valid-gemini-key')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.CUSTOM_SECRET).toBeUndefined()
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
