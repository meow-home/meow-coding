import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalApiManager } from '../../src/main/external-api/manager'
import { ExternalApiConfigFile } from '../../src/main/external-api/config-file'
import type { ExternalApiHandler } from '../../src/main/external-api/server'

const handler: ExternalApiHandler = {
  version: () => '1',
  createTask: async () => { throw new Error('unused') },
  getTask: () => undefined,
  cancelTask: async () => { throw new Error('unused') }
}

describe('ExternalApiManager', () => {
  let dir: string
  let config: ExternalApiConfigFile
  let mgr: ExternalApiManager
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-extmgr-'))
    config = new ExternalApiConfigFile(path.join(dir, 'external-api.json'))
    mgr = new ExternalApiManager({
      config, handler,
      cliSource: path.resolve('resources/external-api/meow-delegate.mjs'),
      skillTemplate: path.resolve('resources/external-api/claude-skill.md'),
      binDir: path.join(dir, 'bin'),
      claudeSkillsDir: path.join(dir, 'claude-skills'),
      preferredPort: 0
    })
  })
  afterEach(async () => { await mgr.stop(); rmSync(dir, { recursive: true, force: true }) })

  it('installs the CLI on start and stays off by default', async () => {
    await mgr.start()
    const s = mgr.getStatus()
    expect(s.enabled).toBe(false)
    expect(s.listening).toBe(false)
    expect(s.cliPath).toBe(path.join(dir, 'bin', 'meow-delegate.mjs'))
    expect(existsSync(s.cliPath!)).toBe(true)
    expect(config.load().cliPath).toBe(s.cliPath)
  })

  it('enabling starts the server and records the port; disabling stops it', async () => {
    await mgr.start()
    const on = await mgr.setEnabled(true)
    expect(on.listening).toBe(true)
    expect(on.port).toBeGreaterThan(0)
    expect(config.load()).toMatchObject({ enabled: true, port: on.port })
    const token = config.load().token
    const res = await fetch(`http://127.0.0.1:${on.port}/v1/health`, { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const off = await mgr.setEnabled(false)
    expect(off.listening).toBe(false)
    expect(config.load()).toMatchObject({ enabled: false, port: null })
  })

  it('starts listening on start when previously enabled', async () => {
    config.update({ enabled: true })
    await mgr.start()
    expect(mgr.getStatus().listening).toBe(true)
  })

  it('regenerated tokens apply to the next request', async () => {
    await mgr.start()
    const { port } = await mgr.setEnabled(true)
    const old = config.load().token
    mgr.regenerateToken()
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { authorization: `Bearer ${old}` } })
    expect(res.status).toBe(401)
  })

  it('installs the Claude skill pointing at the installed CLI', async () => {
    await mgr.start()
    const out = mgr.installClaudeSkill()
    expect(readFileSync(out, 'utf8')).toContain(mgr.getStatus().cliPath!.replace(/\\/g, '/'))
  })
})
