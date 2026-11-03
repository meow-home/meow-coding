import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PtyManager } from '../../src/main/pty-manager'
import { TerminalManager } from '../../src/main/terminal-manager'
import { TerminalStore } from '../../src/main/terminal-store'
import { resolveTerminalShell } from '../../src/main/terminal-shell'
import { gitBashPath } from '../../src/main/agent/tools/bash'
import type { TerminalDataEvent, TerminalsChangedEvent } from '../../src/shared/ipc'
import { hasOutputLine } from './terminal-output'

describe('TerminalManager integration', () => {
  it('manages terminal lifecycle with a dedicated PTY manager without affecting other PTY instances', async () => {
    const tmpStoreDir = mkdtempSync(path.join(tmpdir(), 'meow-term-mgr-test-'))
    const store = new TerminalStore(tmpStoreDir)
    const dedicatedPty = new PtyManager()
    const mainAppPty = new PtyManager()

    const mainPtyData: unknown[] = []
    const mainPtyExits: unknown[] = []
    mainAppPty.on('data', e => mainPtyData.push(e))
    mainAppPty.on('exit', e => mainPtyExits.push(e))

    const emittedData: TerminalDataEvent[] = []
    const emittedChanged: TerminalsChangedEvent[] = []

    const shell = resolveTerminalShell({
      platform: process.platform,
      env: process.env,
      gitBash: gitBashPath,
      exists: existsSync
    })

    const terminals = new TerminalManager({
      pty: dedicatedPty,
      store,
      resolveShell: () => shell,
      emitData: (e) => emittedData.push(e),
      emitChanged: (e) => emittedChanged.push(e)
    })

    try {
      const created = await terminals.create('session-1', tmpdir())
      expect(created.id).toBeDefined()
      expect(created.agentId).toBe('session-1')
      expect(created.status).toBe('running')

      const listAfterCreate = terminals.list('session-1')
      expect(listAfterCreate).toHaveLength(1)
      expect(listAfterCreate[0].id).toBe(created.id)

      const attachResult = terminals.attach(created.id)
      expect(attachResult).toHaveProperty('scrollback')

      terminals.write(created.id, 'echo TERM_OK\r')

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const allOutput = emittedData.filter(e => e.id === created.id).map(e => e.data).join('')
          reject(new Error(`timeout waiting for TERM_OK; got: ${allOutput}`))
        }, 15000)

        let retryTicks = 0
        const check = () => {
          const allOutput = emittedData.filter(e => e.id === created.id).map(e => e.data).join('')
          if (hasOutputLine(allOutput, 'TERM_OK')) {
            clearTimeout(timeout)
            resolve()
          } else {
            retryTicks++
            if (retryTicks % 10 === 0 && dedicatedPty.isRunning(created.id)) {
              terminals.write(created.id, 'echo TERM_OK\r')
            }
            setTimeout(check, 50)
          }
        }
        check()
      })

      // Ensure mainApp.pty recorded nothing across the whole flow
      expect(mainPtyData).toHaveLength(0)
      expect(mainPtyExits).toHaveLength(0)

      const sessionObj = (dedicatedPty as any).sessions.get(created.id)
      const pid: number | undefined = sessionObj?.pid || sessionObj?.process?.pid

      await terminals.kill(created.id)

      expect(terminals.list('session-1')).toHaveLength(0)
      expect(dedicatedPty.isRunning(created.id)).toBe(false)

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
      await Promise.allSettled([dedicatedPty.stopAll(), mainAppPty.stopAll()])
      rmSync(tmpStoreDir, { recursive: true, force: true })
    }
  }, 30000)
})
