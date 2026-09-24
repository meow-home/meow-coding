import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalApiConfigFile } from '../../src/main/external-api/config-file'

describe('ExternalApiConfigFile', () => {
  let dir: string
  let file: string
  let n = 0
  const token = () => `tok${++n}`.padEnd(64, '0')
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-extcfg-')); file = path.join(dir, 'external-api.json'); n = 0 })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a disabled config with a persisted token on first load', () => {
    const cfg = new ExternalApiConfigFile(file, token).load()
    expect(cfg).toEqual({ enabled: false, port: null, token: 'tok1'.padEnd(64, '0'), cliPath: null })
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe(cfg.token)
  })

  it('keeps the token across instances', () => {
    const a = new ExternalApiConfigFile(file, token).load()
    const b = new ExternalApiConfigFile(file, token).load()
    expect(b.token).toBe(a.token)
  })

  it('update merges fields without touching the token', () => {
    const f = new ExternalApiConfigFile(file, token)
    const before = f.load()
    const after = f.update({ enabled: true, port: 3929, cliPath: '/u/bin/meow-delegate.mjs' })
    expect(after).toEqual({ ...before, enabled: true, port: 3929, cliPath: '/u/bin/meow-delegate.mjs' })
  })

  it('regenerateToken replaces the token', () => {
    const f = new ExternalApiConfigFile(file, token)
    const before = f.load()
    expect(f.regenerateToken().token).not.toBe(before.token)
  })

  it('recovers from a corrupt file', () => {
    writeFileSync(file, '{not json')
    expect(new ExternalApiConfigFile(file, token).load().enabled).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('keeps the token file private to the user (0600)', () => {
    const f = new ExternalApiConfigFile(file, token)
    f.load()
    expect(statSync(file).mode & 0o777).toBe(0o600)
    f.update({ enabled: true })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('defaults the token generator to 64 hex chars', () => {
    expect(new ExternalApiConfigFile(file).load().token).toMatch(/^[0-9a-f]{64}$/)
  })
})
