import { describe, expect, it, vi } from 'vitest'
import { AntigravityCli } from '../../src/main/cli-agents'
import type { CliBinaryManager } from '../../src/main/cli-agents/binary-manager'
import type { CliTerminalResult } from '../../src/main/cli-agents/parsers/types'
import type { CliRunManager, RunTaskInput } from '../../src/main/cli-agents/run-manager'
import type { CliCheckResult } from '../../src/shared/types'

const install = { command: 'bash', args: [] }
const readyCheck: CliCheckResult = {
  installed: true, binaryPath: '/bin/agy', version: '1.6.0', minVersion: '1.5.0', ready: true, install
}
const missingCheck: CliCheckResult = {
  installed: false, binaryPath: null, version: null, minVersion: '1.5.0', ready: false, error: 'agy was not found.', install
}

function setup(opts: {
  check?: CliCheckResult
  result?: CliTerminalResult | Error
  active?: number
  permission?: Record<string, 'allow' | 'ask' | 'deny'>
} = {}) {
  const runs: RunTaskInput[] = []
  const runManager = {
    runTask: vi.fn(async (input: RunTaskInput) => {
      runs.push(input)
      const result = opts.result ?? { status: 'completed', text: 'OK' }
      if (result instanceof Error) throw result
      return result
    }),
    cancel: vi.fn(() => true),
    cancelAll: vi.fn(async () => {}),
    activeCount: () => opts.active ?? 0,
    queuedCount: () => 0
  }
  const binaryManager = { check: vi.fn(async () => opts.check ?? readyCheck) }
  const cli = new AntigravityCli({
    runManager: runManager as unknown as CliRunManager,
    binaryManager: binaryManager as unknown as CliBinaryManager,
    testCwd: '/tmp/test',
    getPermission: opts.permission ? () => opts.permission! : undefined
  })
  return { cli, runs, runManager, binaryManager }
}

describe('AntigravityCli', () => {
  it('check() reports the binary manager result', async () => {
    const { cli } = setup({ check: missingCheck })
    expect(await cli.check()).toEqual(missingCheck)
  })

  describe('test()', () => {
    it('runs a short read-only prompt and passes on a completed run', async () => {
      const { cli, runs } = setup()
      const res = await cli.test()

      expect(res.ok).toBe(true)
      expect(res.text).toBe('OK')
      expect(runs).toHaveLength(1)
      expect(runs[0].binaryPath).toBe('/bin/agy')
      expect(runs[0].cwd).toBe('/tmp/test')
      expect(runs[0].policy).toMatchObject({ mode: 'read', allowCommands: false, allowWrites: false, timeoutMs: 90_000 })
    })

    it('fails without running when agy is not ready', async () => {
      const { cli, runs } = setup({ check: missingCheck })
      const res = await cli.test()
      expect(res).toMatchObject({ ok: false, error: 'agy was not found.' })
      expect(runs).toHaveLength(0)
    })

    it('fails without running while a delegated task is in flight', async () => {
      const { cli, runs } = setup({ active: 1 })
      const res = await cli.test()
      expect(res.ok).toBe(false)
      expect(res.error).toContain('busy')
      expect(runs).toHaveLength(0)
    })

    it('surfaces the CLI error of a failed run', async () => {
      const { cli } = setup({ result: { status: 'failed', text: '', error: 'CLI process exited with code 1\nNot signed in' } })
      const res = await cli.test()
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Not signed in')
    })

    it('reports a thrown run error', async () => {
      const { cli } = setup({ result: new Error('spawn failed') })
      expect(await cli.test()).toMatchObject({ ok: false, error: 'spawn failed' })
    })
  })

  describe('runTask()', () => {
    it('runs in the given folder in edit mode with Meow permissions', async () => {
      const { cli, runs } = setup({ permission: { bash: 'allow', write: 'deny', edit: 'deny', 'apply-patch': 'deny' } })
      const res = await cli.runTask({ runId: 'd1', task: 'fix it', cwd: '/proj' })

      expect(res.status).toBe('completed')
      expect(runs[0]).toMatchObject({ runId: 'd1', task: 'fix it', cwd: '/proj', binaryPath: '/bin/agy' })
      expect(runs[0].policy).toMatchObject({ mode: 'edit', allowCommands: true, allowWrites: false })
    })

    it('defaults to commands off and writes on when no permission source is wired', async () => {
      const { cli, runs } = setup()
      await cli.runTask({ runId: 'd1', task: 'fix it', cwd: '/proj' })
      expect(runs[0].policy).toMatchObject({ mode: 'edit', allowCommands: false, allowWrites: true })
    })

    it('throws a pointer to Settings when agy is not ready', async () => {
      const { cli, runs } = setup({ check: missingCheck })
      await expect(cli.runTask({ runId: 'd1', task: 'fix it', cwd: '/proj' }))
        .rejects.toThrow(/not ready: agy was not found\. Check Settings > Antigravity CLI/)
      expect(runs).toHaveLength(0)
    })
  })

  it('forwards cancelTask and cancelAll to the run manager', async () => {
    const { cli, runManager } = setup()
    expect(cli.cancelTask('d1')).toBe(true)
    expect(runManager.cancel).toHaveBeenCalledWith('d1')
    await cli.cancelAll()
    expect(runManager.cancelAll).toHaveBeenCalled()
  })
})
