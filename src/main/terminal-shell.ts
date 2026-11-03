import path from 'node:path'

export interface ResolvedShell {
  file: string
  args: string[]
  name: string
}

function shellName(file: string, platform: NodeJS.Platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  return p.basename(file).replace(/\.exe$/i, '')
}

export function resolveTerminalShell(input: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  configured?: { shell?: string; args?: string[] }
  gitBash: () => string | null
  exists: (p: string) => boolean
}): ResolvedShell {
  if (input.configured?.shell && input.exists(input.configured.shell)) {
    return {
      file: input.configured.shell,
      args: input.configured.args ? [...input.configured.args] : [],
      name: shellName(input.configured.shell, input.platform)
    }
  }

  if (input.platform === 'win32') {
    const git = input.gitBash()
    if (git) {
      return {
        file: git,
        args: ['--login', '-i'],
        name: shellName(git, input.platform)
      }
    }
    return {
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'powershell'
    }
  }

  const envShell = input.env.SHELL
  if (envShell && envShell.trim().length > 0) {
    return {
      file: envShell,
      args: ['-l'],
      name: shellName(envShell, input.platform)
    }
  }

  return {
    file: '/bin/bash',
    args: ['-l'],
    name: 'bash'
  }
}
