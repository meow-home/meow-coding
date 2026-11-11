import { describe, expect, it } from 'vitest'
import {
  buildAntigravityArgs,
  DEFAULT_CLI_TASK_TIMEOUT_MS,
  deriveCliPolicy
} from '../../src/main/cli-agents/policy'
import type { CliPolicy } from '../../src/main/cli-agents/policy'

describe('deriveCliPolicy', () => {
  it('enforces read mode constraints regardless of meow permissions', () => {
    const policy = deriveCliPolicy('read', {
      bash: 'allow',
      write: 'allow',
      edit: 'allow',
      'apply-patch': 'allow'
    })

    expect(policy.mode).toBe('read')
    expect(policy.allowCommands).toBe(false)
    expect(policy.allowWrites).toBe(false)
    expect(policy.allowUrl).toBe(true)
    expect(policy.timeoutMs).toBe(DEFAULT_CLI_TASK_TIMEOUT_MS)
  })

  it('respects url denials in read mode', () => {
    const policy1 = deriveCliPolicy('read', { webfetch: 'deny' })
    expect(policy1.allowUrl).toBe(false)

    const policy2 = deriveCliPolicy('read', { read_url: 'deny' })
    expect(policy2.allowUrl).toBe(false)
  })

  it('derives edit mode permissions from tool rules', () => {
    // bash allow enables commands; write allow enables writes
    const policy1 = deriveCliPolicy('edit', {
      bash: 'allow',
      write: 'allow'
    })
    expect(policy1.allowCommands).toBe(true)
    expect(policy1.allowWrites).toBe(true)
    expect(policy1.allowUrl).toBe(true)

    // edit tool enables writes
    const policy2 = deriveCliPolicy('edit', {
      bash: 'ask',
      edit: 'allow'
    })
    expect(policy2.allowCommands).toBe(false)
    expect(policy2.allowWrites).toBe(true)

    // apply-patch tool enables writes
    const policy3 = deriveCliPolicy('edit', {
      bash: 'deny',
      'apply-patch': 'allow'
    })
    expect(policy3.allowCommands).toBe(false)
    expect(policy3.allowWrites).toBe(true)

    // ask/deny do not allow in headless CLI
    const policy4 = deriveCliPolicy('edit', {
      bash: 'ask',
      write: 'ask',
      edit: 'deny'
    })
    expect(policy4.allowCommands).toBe(false)
    expect(policy4.allowWrites).toBe(false)
  })

  it('enforces full mode permissions regardless of meow permissions', () => {
    const policy = deriveCliPolicy(
      'full',
      {
        bash: 'deny',
        write: 'deny',
        webfetch: 'deny'
      },
      { timeoutMs: 60_000 }
    )

    expect(policy.mode).toBe('full')
    expect(policy.allowCommands).toBe(true)
    expect(policy.allowWrites).toBe(true)
    expect(policy.allowUrl).toBe(true)
    expect(policy.timeoutMs).toBe(60_000)
  })

  it('uses custom timeoutMs when provided', () => {
    const policy = deriveCliPolicy('edit', {}, { timeoutMs: 120_000 })
    expect(policy.timeoutMs).toBe(120_000)
  })
})

describe('buildAntigravityArgs', () => {
  it('builds args for read mode with mode plan and only url permission', () => {
    const policy: CliPolicy = {
      mode: 'read',
      allowCommands: false,
      allowWrites: false,
      allowUrl: true,
      timeoutMs: 1_800_000
    }

    const args = buildAntigravityArgs({
      task: 'Analyze the architecture',
      policy
    })

    expect(args).toEqual([
      '-p',
      'Analyze the architecture',
      '--output-format',
      'stream-json',
      '--mode',
      'plan',
      '--settings',
      JSON.stringify({ permissions: { allow: ['read_url(*)'] } }),
      '--print-timeout',
      '1800s'
    ])
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('formats --print-timeout with default 1800s and 0s for zero timeout', () => {
    const defaultPolicy = deriveCliPolicy('read', {})
    const defaultArgs = buildAntigravityArgs({ task: 'Default timeout', policy: defaultPolicy })
    expect(defaultArgs).toContain('--print-timeout')
    expect(defaultArgs[defaultArgs.indexOf('--print-timeout') + 1]).toBe('1800s')

    const zeroPolicy: CliPolicy = {
      mode: 'read',
      allowCommands: false,
      allowWrites: false,
      allowUrl: false,
      timeoutMs: 0
    }
    const zeroArgs = buildAntigravityArgs({ task: 'Zero timeout', policy: zeroPolicy })
    expect(zeroArgs[zeroArgs.indexOf('--print-timeout') + 1]).toBe('0s')
  })

  it('builds args for read mode with no permissions when allowUrl is false', () => {
    const policy: CliPolicy = {
      mode: 'read',
      allowCommands: false,
      allowWrites: false,
      allowUrl: false,
      timeoutMs: 300_000
    }

    const args = buildAntigravityArgs({
      task: 'Read-only task',
      policy
    })

    expect(args).toContain('--mode')
    expect(args[args.indexOf('--mode') + 1]).toBe('plan')
    expect(args).toContain('--settings')
    const settings = JSON.parse(args[args.indexOf('--settings') + 1])
    expect(settings).toEqual({ permissions: { allow: [] } })
  })

  it('builds args for edit mode with accept-edits and allow list', () => {
    const policy: CliPolicy = {
      mode: 'edit',
      allowCommands: true,
      allowWrites: true,
      allowUrl: true,
      timeoutMs: 900_000
    }

    const args = buildAntigravityArgs({
      task: 'Fix the bug',
      policy
    })

    expect(args).toContain('--mode')
    expect(args[args.indexOf('--mode') + 1]).toBe('accept-edits')

    const settings = JSON.parse(args[args.indexOf('--settings') + 1])
    expect(settings.permissions.allow).toEqual([
      'command(*)',
      'write_file(*)',
      'read_url(*)'
    ])
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  it('handles partial allow in edit mode', () => {
    const policy: CliPolicy = {
      mode: 'edit',
      allowCommands: false,
      allowWrites: true,
      allowUrl: false,
      timeoutMs: 1_800_000
    }

    const args = buildAntigravityArgs({
      task: 'Update readme',
      policy
    })

    const settings = JSON.parse(args[args.indexOf('--settings') + 1])
    expect(settings.permissions.allow).toEqual(['write_file(*)'])
  })

  it('builds args for full mode with dangerously-skip-permissions and accept-edits', () => {
    const policy: CliPolicy = {
      mode: 'full',
      allowCommands: true,
      allowWrites: true,
      allowUrl: true,
      timeoutMs: 1_800_000
    }

    const args = buildAntigravityArgs({
      task: 'Run full suite',
      policy
    })

    expect(args).toContain('--mode')
    expect(args[args.indexOf('--mode') + 1]).toBe('accept-edits')
    expect(args).toContain('--dangerously-skip-permissions')
  })
})
