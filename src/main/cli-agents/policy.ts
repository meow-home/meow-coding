export type CliMode = 'read' | 'edit' | 'full'

export interface CliPolicy {
  mode: CliMode
  allowCommands: boolean
  allowWrites: boolean
  allowUrl: boolean
  timeoutMs: number
}

export const DEFAULT_CLI_TASK_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Derives a CLI policy from a run mode and Meow's permission map.
 * Meow's permission map is tool-level, not command-level: `bash === 'allow'`
 * means commands may run, and `write`/`edit`/`apply-patch` === 'allow'
 * means writes may run. `read` mode never allows writes or commands.
 * `full` mode allows both. `edit` mode follows the Meow rules.
 */
export function deriveCliPolicy(
  mode: CliMode,
  meowPermission: Record<string, 'allow' | 'ask' | 'deny'>,
  opts?: { timeoutMs?: number }
): CliPolicy {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_CLI_TASK_TIMEOUT_MS

  if (mode === 'full') {
    return {
      mode,
      allowCommands: true,
      allowWrites: true,
      allowUrl: true,
      timeoutMs
    }
  }

  if (mode === 'read') {
    return {
      mode,
      allowCommands: false,
      allowWrites: false,
      allowUrl: meowPermission.webfetch !== 'deny' && meowPermission.read_url !== 'deny',
      timeoutMs
    }
  }

  // mode === 'edit'
  const allowCommands = meowPermission.bash === 'allow'
  const allowWrites =
    meowPermission.write === 'allow' ||
    meowPermission.edit === 'allow' ||
    meowPermission['apply-patch'] === 'allow'
  const allowUrl = meowPermission.webfetch !== 'deny' && meowPermission.read_url !== 'deny'

  return {
    mode,
    allowCommands,
    allowWrites,
    allowUrl,
    timeoutMs
  }
}

export function buildAntigravityArgs(input: {
  task: string
  policy: CliPolicy
}): string[] {
  const { task, policy } = input

  const allow: string[] = []
  if (policy.mode !== 'read') {
    if (policy.allowCommands) {
      allow.push('command(*)')
    }
    if (policy.allowWrites) {
      allow.push('write_file(*)')
    }
  }
  if (policy.allowUrl) {
    allow.push('read_url(*)')
  }

  const modeFlag = policy.mode === 'read' ? 'plan' : 'accept-edits'
  const settingsJson = JSON.stringify({ permissions: { allow } })
  const timeoutDuration = `${Math.max(0, Math.round(policy.timeoutMs / 1000))}s`

  const args: string[] = [
    '-p',
    task,
    '--output-format',
    'stream-json',
    '--mode',
    modeFlag,
    '--settings',
    settingsJson,
    '--print-timeout',
    timeoutDuration
  ]

  if (policy.mode === 'full') {
    args.push('--dangerously-skip-permissions')
  }

  return args
}
