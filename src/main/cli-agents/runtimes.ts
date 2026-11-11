import type { CliInstallDescriptor } from '../../shared/types'

const DOCS_URL = 'https://antigravity.google/docs'

export const ANTIGRAVITY_CLI = {
  label: 'Antigravity',
  binaryNames: ['agy', 'agy.exe', 'agy.cmd'],
  minVersion: '1.5.0',
  versionArgs: ['--version'],
  docsUrl: DOCS_URL,
  installCommand(platform: NodeJS.Platform): CliInstallDescriptor {
    if (platform === 'win32') {
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://antigravity.google/cli/install.ps1 | iex'],
        docUrl: DOCS_URL
      }
    }
    return {
      command: 'bash',
      args: ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
      docUrl: DOCS_URL
    }
  }
} as const
