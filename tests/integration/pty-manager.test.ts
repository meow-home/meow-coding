import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PtyManager } from '../../src/main/pty-manager'
import { gitBashPath } from '../../src/main/agent/tools/bash'
import { resolveTerminalShell } from '../../src/main/terminal-shell'

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'echo-agent.js')

describe('PtyManager windows shim spawn', () => {
  it.skipIf(process.platform !== 'win32')('runs a bare npm-style .cmd shim command', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-shim-'))
    const managers: PtyManager[] = []
    const originalPath = process.env.PATH
    try {
      writeFileSync(path.join(dir, 'fakeshim.cmd'), '@echo off\r\necho SHIM_OK\r\nexit /b 0\r\n')
      process.env.PATH = dir + path.delimiter + (process.env.PATH ?? '')

      const pty = new PtyManager()
      managers.push(pty)
      const data: string[] = []
      pty.on('data', ({ data: d }) => data.push(d))

      pty.start('a1', 'shim', 'fakeshim', [], dir)

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting SHIM_OK')), 10000)
        const check = () => {
          if (data.some(d => d.includes('SHIM_OK'))) {
            clearTimeout(t)
            resolve()
          } else {
            setTimeout(check, 50)
          }
        }
        check()
      })
      expect(data.join('')).toContain('SHIM_OK')
    } finally {
      await Promise.all(managers.map(m => m.stopAll()))
      process.env.PATH = originalPath
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('PtyManager', () => {
  const managers: PtyManager[] = []

  afterEach(async () => {
    await Promise.all(managers.map(m => m.stopAll()))
    managers.length = 0
  })

  it('spawns a CLI and streams output', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for READY')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(data.join('')).toContain('READY')
  })

  it('writes input and receives echoed data', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const data: string[] = []
    pty.on('data', ({ data: d }) => data.push(d))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 10000)
      const check = () => {
        if (data.some(d => d.includes('READY'))) {
          pty.write('a1', 'hi\r')
          resolve()
          clearTimeout(t)
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting echo')), 10000)
      const check = () => {
        if (data.some(d => d.includes('echo:hi'))) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  })

  it('emits exit when stopped and removes the session', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    const exited: { agentId: string; exitCode: number }[] = []
    pty.on('exit', e => exited.push(e))

    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await pty.stop('a1')
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting exit')), 10000)
      const check = () => {
        if (exited.length > 0) {
          clearTimeout(t)
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
    expect(exited[0].agentId).toBe('a1')
    expect(pty.isRunning('a1')).toBe(false)
  })

  it('allows restart immediately after stop', async () => {
    const pty = new PtyManager()
    managers.push(pty)
    pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())
    await pty.stop('a1')
    expect(() => pty.start('a1', 'echo', process.execPath, [FIXTURE], process.cwd())).not.toThrow()
    await pty.stop('a1')
  })
})

describe('PtyManager terminal session', () => {
  it('spawns a resolved shell, receives raw input and cleans up the process tree', async () => {
    const pty = new PtyManager()
    const shell = resolveTerminalShell({
      platform: process.platform,
      env: process.env,
      gitBash: gitBashPath,
      exists: existsSync
    })
    const data: string[] = []
    const exits: { agentId: string; exitCode: number; kind?: 'agent' | 'terminal' }[] = []
    pty.on('data', ({ data: d }) => data.push(d))
    pty.on('exit', e => exits.push(e))

    try {
      const session = pty.startTerminal('t1', tmpdir(), shell)

      pty.writeRaw('t1', 'echo TERM_OK\r')

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for TERM_OK; got: ${data.join('')}`)), 15000)
        let retryTicks = 0
        const check = () => {
          // The shell echoes the typed command too; only a line that is exactly
          // TERM_OK proves the command ran.
          if (/\nTERM_OK\r?\n/.test(data.join(''))) {
            clearTimeout(t)
            resolve()
          } else {
            retryTicks++
            // Retrying input in case shell startup banner swallowed earlier input
            if (retryTicks % 10 === 0 && pty.isRunning('t1')) {
              pty.writeRaw('t1', 'echo TERM_OK\r')
            }
            setTimeout(check, 50)
          }
        }
        check()
      })

      expect(data.join('')).toContain('TERM_OK')

      const pid = session.pid || session.process.pid
      await pty.stop('t1')

      expect(pty.isRunning('t1')).toBe(false)

      const exitEvent = exits.find(e => e.agentId === 't1')
      expect(exitEvent).toBeDefined()
      expect(exitEvent?.kind).toBe('terminal')

      if (pid) {
        let isDead = false
        const startWait = Date.now()
        while (Date.now() - startWait < 5000) {
          try {
            process.kill(pid, 0)
            await new Promise(r => setTimeout(r, 50))
          } catch {
            isDead = true
            break
          }
        }
        expect(isDead).toBe(true)
      }
    } finally {
      await pty.stopAll()
    }
  }, 25000)
})
