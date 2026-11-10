import type { CliInstallDescriptor, CliRuntimeId } from '../../shared/types'

export interface CliRuntimeDefinition {
  id: CliRuntimeId
  label: string
  defaultBinary: string
  binaryNames: string[]
  minVersion: string
  docsUrl: string
  installCommand(platform: NodeJS.Platform): CliInstallDescriptor | null
  versionArgs: string[]
  modelsCommand(binaryPath: string): { file: string; args: string[] }
}

export const CLI_RUNTIMES: Record<CliRuntimeId, CliRuntimeDefinition> = {
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    defaultBinary: 'agy',
    binaryNames: ['agy', 'agy.exe', 'agy.cmd'],
    minVersion: '1.5.0',
    docsUrl: 'https://antigravity.google/docs',
    installCommand(platform: NodeJS.Platform): CliInstallDescriptor | null {
      if (platform === 'win32') {
        return {
          runtime: 'antigravity',
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://antigravity.google/cli/install.ps1 | iex'],
          docUrl: 'https://antigravity.google/docs'
        }
      }
      return {
        runtime: 'antigravity',
        command: 'bash',
        args: ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
        docUrl: 'https://antigravity.google/docs'
      }
    },
    versionArgs: ['--version'],
    modelsCommand(binaryPath: string) {
      return { file: binaryPath, args: ['models'] }
    }
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    defaultBinary: 'opencode',
    binaryNames: ['opencode', 'opencode.cmd', 'opencode.exe'],
    minVersion: '2.0.0',
    docsUrl: 'https://opencode.ai/docs',
    installCommand(platform: NodeJS.Platform): CliInstallDescriptor {
      if (platform === 'win32') {
        return {
          runtime: 'opencode',
          command: 'cmd.exe',
          args: ['/d', '/s', '/c', 'npm install -g @opencode/cli'],
          docUrl: 'https://opencode.ai/docs'
        }
      }
      return {
        runtime: 'opencode',
        command: 'npm',
        args: ['install', '-g', '@opencode/cli'],
        docUrl: 'https://opencode.ai/docs'
      }
    },
    versionArgs: ['--version'],
    modelsCommand(binaryPath: string) {
      return { file: binaryPath, args: ['models'] }
    }
  }
}

export function getCliRuntime(id: CliRuntimeId): CliRuntimeDefinition {
  const runtime = CLI_RUNTIMES[id]
  if (!runtime) {
    throw new Error(`[meow] Unknown CLI runtime: ${id}`)
  }
  return runtime
}
