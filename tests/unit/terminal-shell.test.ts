import { describe, expect, it } from 'vitest'
import { resolveTerminalShell } from '../../src/main/terminal-shell'

describe('resolveTerminalShell', () => {
  it('uses configured shell when it exists, defaulting args to []', () => {
    const res = resolveTerminalShell({
      platform: 'win32',
      env: {},
      configured: { shell: 'C:\\tools\\nu.exe' },
      gitBash: () => null,
      exists: (p) => p === 'C:\\tools\\nu.exe'
    })
    expect(res).toEqual({
      file: 'C:\\tools\\nu.exe',
      args: [],
      name: 'nu'
    })
  })

  it('uses configured shell with custom args when it exists', () => {
    const res = resolveTerminalShell({
      platform: 'linux',
      env: { SHELL: '/bin/zsh' },
      configured: { shell: '/usr/bin/fish', args: ['-l', '--init-file', 'custom'] },
      gitBash: () => null,
      exists: (p) => p === '/usr/bin/fish'
    })
    expect(res).toEqual({
      file: '/usr/bin/fish',
      args: ['-l', '--init-file', 'custom'],
      name: 'fish'
    })
  })

  it('falls through when configured shell does not exist (win32 with Git Bash)', () => {
    const res = resolveTerminalShell({
      platform: 'win32',
      env: {},
      configured: { shell: 'C:\\missing\\shell.exe', args: ['-x'] },
      gitBash: () => 'C:\\Program Files\\Git\\bin\\bash.exe',
      exists: () => false
    })
    expect(res).toEqual({
      file: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['--login', '-i'],
      name: 'bash'
    })
  })

  it('falls through when configured shell does not exist (win32 without Git Bash)', () => {
    const res = resolveTerminalShell({
      platform: 'win32',
      env: {},
      configured: { shell: 'C:\\missing\\shell.exe' },
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'powershell'
    })
  })

  it('falls through when configured shell does not exist (POSIX with env.SHELL)', () => {
    const res = resolveTerminalShell({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      configured: { shell: '/opt/missing/shell' },
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: '/bin/zsh',
      args: ['-l'],
      name: 'zsh'
    })
  })

  it('falls through when configured shell does not exist (POSIX without env.SHELL)', () => {
    const res = resolveTerminalShell({
      platform: 'linux',
      env: {},
      configured: { shell: '/opt/missing/shell' },
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: '/bin/bash',
      args: ['-l'],
      name: 'bash'
    })
  })

  it('resolves Git Bash on win32 when available', () => {
    const res = resolveTerminalShell({
      platform: 'win32',
      env: {},
      gitBash: () => 'D:\\Git\\bin\\bash.exe',
      exists: () => false
    })
    expect(res).toEqual({
      file: 'D:\\Git\\bin\\bash.exe',
      args: ['--login', '-i'],
      name: 'bash'
    })
  })

  it('falls back to powershell.exe on win32 when Git Bash is not available', () => {
    const res = resolveTerminalShell({
      platform: 'win32',
      env: {},
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'powershell'
    })
  })

  it('resolves env.SHELL on POSIX platforms', () => {
    const res = resolveTerminalShell({
      platform: 'darwin',
      env: { SHELL: '/opt/homebrew/bin/bash' },
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: '/opt/homebrew/bin/bash',
      args: ['-l'],
      name: 'bash'
    })
  })

  it('falls back to /bin/bash on POSIX when env.SHELL is empty or missing', () => {
    const res = resolveTerminalShell({
      platform: 'linux',
      env: { SHELL: '   ' },
      gitBash: () => null,
      exists: () => false
    })
    expect(res).toEqual({
      file: '/bin/bash',
      args: ['-l'],
      name: 'bash'
    })
  })
})
