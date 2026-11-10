import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CliBinaryManager,
  compareSemver,
  isSemverGte,
  parseSemver
} from '../../src/main/cli-agents/binary-manager'
import { CLI_RUNTIMES, getCliRuntime } from '../../src/main/cli-agents/runtimes'

describe('CLI Agents — Runtimes Catalog', () => {
  it('defines static catalog for antigravity and opencode', () => {
    const agy = getCliRuntime('antigravity')
    expect(agy.id).toBe('antigravity')
    expect(agy.label).toBe('Antigravity')
    expect(agy.defaultBinary).toBe('agy')
    expect(agy.minVersion).toBe('1.5.0')
    expect(agy.docsUrl).toContain('antigravity.google')
    expect(agy.modelsCommand('/bin/agy')).toEqual({ file: '/bin/agy', args: ['models'] })

    const oc = getCliRuntime('opencode')
    expect(oc.id).toBe('opencode')
    expect(oc.label).toBe('OpenCode')
    expect(oc.defaultBinary).toBe('opencode')
    expect(oc.minVersion).toBe('2.0.0')
    expect(oc.docsUrl).toContain('opencode.ai')
    expect(oc.modelsCommand('/bin/opencode')).toEqual({ file: '/bin/opencode', args: ['models'] })
  })

  it('provides install command descriptors per platform', () => {
    const agy = CLI_RUNTIMES.antigravity
    const agyWin = agy.installCommand('win32')
    expect(agyWin).not.toBeNull()
    expect(agyWin?.command).toBe('powershell.exe')
    expect(agyWin?.args.join(' ')).toContain('install.ps1')

    const agyLinux = agy.installCommand('linux')
    expect(agyLinux).not.toBeNull()
    expect(agyLinux?.command).toBe('bash')
    expect(agyLinux?.args.join(' ')).toContain('install.sh')

    const oc = CLI_RUNTIMES.opencode
    const ocWin = oc.installCommand('win32')
    expect(ocWin.command).toBe('cmd.exe')
    expect(ocWin.args.join(' ')).toContain('npm install -g @opencode/cli')

    const ocMac = oc.installCommand('darwin')
    expect(ocMac.command).toBe('npm')
    expect(ocMac.args).toEqual(['install', '-g', '@opencode/cli'])
  })

  it('throws on unknown runtime id', () => {
    expect(() => getCliRuntime('unknown' as never)).toThrow('[meow] Unknown CLI runtime')
  })
})

describe('CLI Agents — Semver utilities', () => {
  it('parses semver from various output strings', () => {
    expect(parseSemver('1.5.4')).toBe('1.5.4')
    expect(parseSemver('v2.2.7')).toBe('2.2.7')
    expect(parseSemver('agy 1.5.4\n')).toBe('1.5.4')
    expect(parseSemver('OpenCode v2.0.0 (x64)')).toBe('2.0.0')
    expect(parseSemver('version 2.0')).toBe('2.0')
    expect(parseSemver('no version here')).toBeNull()
  })

  it('compares semver strings correctly', () => {
    expect(compareSemver('1.5.4', '1.5.0')).toBe(1)
    expect(compareSemver('1.5.0', '1.5.0')).toBe(0)
    expect(compareSemver('1.5', '1.5.0')).toBe(0)
    expect(compareSemver('1.4.9', '1.5.0')).toBe(-1)
    expect(compareSemver('2.2.7', '2.0.0')).toBe(1)
    expect(compareSemver('1.19.5', '2.0.0')).toBe(-1)
  })

  it('checks isSemverGte accurately', () => {
    expect(isSemverGte('1.5.4', '1.5.0')).toBe(true)
    expect(isSemverGte('1.5.0', '1.5.0')).toBe(true)
    expect(isSemverGte('1.4.9', '1.5.0')).toBe(false)
    expect(isSemverGte('2.2.7', '2.0.0')).toBe(true)
    expect(isSemverGte('1.19.5', '2.0.0')).toBe(false)
  })
})

describe('CLI Agents — Binary Manager', () => {
  let tmpDir = ''

  function createTmp(): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'meow-cli-agent-test-'))
    return tmpDir
  }

  function cleanupTmp(): void {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      tmpDir = ''
    }
  }

  it('resolves binary from manual path if valid', () => {
    const dir = createTmp()
    const fakeBinary = path.join(dir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
    writeFileSync(fakeBinary, 'echo 1.5.4')

    const manager = new CliBinaryManager({ platform: process.platform })
    const resolved = manager.resolveBinary('antigravity', fakeBinary)
    expect(resolved).toBe(fakeBinary)

    cleanupTmp()
  })

  it('returns null if manual path does not exist', () => {
    const manager = new CliBinaryManager({ platform: process.platform })
    const resolved = manager.resolveBinary('antigravity', 'C:\\non-existent-path\\agy.exe')
    expect(resolved).toBeNull()
  })

  it('resolves binary from PATH', () => {
    const dir = createTmp()
    const binaryName = process.platform === 'win32' ? 'agy.cmd' : 'agy'
    const fakeBinary = path.join(dir, binaryName)
    writeFileSync(fakeBinary, 'echo 1.5.4')

    const manager = new CliBinaryManager({
      env: { PATH: dir, PATHEXT: '.CMD;.EXE' },
      platform: process.platform
    })
    const resolved = manager.resolveBinary('antigravity')
    expect(resolved).toBe(fakeBinary)

    cleanupTmp()
  })

  it('resolves binary from known install directories', () => {
    const dir = createTmp()
    const binDir = path.join(dir, 'agy', 'bin')
    mkdirSync(binDir, { recursive: true })
    const fakeBinary = path.join(binDir, 'agy.cmd')
    writeFileSync(fakeBinary, 'echo 1.5.4')

    const manager = new CliBinaryManager({
      env: { LOCALAPPDATA: dir, PATH: '', PATHEXT: '.CMD;.EXE' },
      platform: 'win32'
    })
    const resolved = manager.resolveBinary('antigravity')
    expect(resolved).toBe(fakeBinary)

    cleanupTmp()
  })

  it('detects a valid runtime with mock command runner', async () => {
    const dir = createTmp()
    const fakeBinary = path.join(dir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
    writeFileSync(fakeBinary, 'echo 1.5.4')

    const manager = new CliBinaryManager({
      platform: process.platform,
      runCommand: async () => ({ stdout: '1.5.4\n', stderr: '', exitCode: 0 })
    })

    const result = await manager.detect('antigravity', fakeBinary)
    expect(result.found).toBe(true)
    expect(result.binaryPath).toBe(fakeBinary)
    expect(result.version).toBe('1.5.4')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()

    cleanupTmp()
  })

  it('detects an outdated runtime as invalid', async () => {
    const dir = createTmp()
    const fakeBinary = path.join(dir, process.platform === 'win32' ? 'opencode.cmd' : 'opencode')
    writeFileSync(fakeBinary, 'echo 1.19.5')

    const manager = new CliBinaryManager({
      platform: process.platform,
      runCommand: async () => ({ stdout: 'opencode 1.19.5\n', stderr: '', exitCode: 0 })
    })

    const result = await manager.detect('opencode', fakeBinary)
    expect(result.found).toBe(true)
    expect(result.version).toBe('1.19.5')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('lower than required minimum')

    cleanupTmp()
  })

  it('reports found: false when binary cannot be located', async () => {
    const manager = new CliBinaryManager({
      env: { PATH: '', LOCALAPPDATA: '', USERPROFILE: '', HOME: '' },
      platform: process.platform
    })

    const result = await manager.detect('antigravity')
    expect(result.found).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.binaryPath).toBeNull()
    expect(result.error).toContain('not found')
  })

  it('handles execution failures gracefully', async () => {
    const dir = createTmp()
    const fakeBinary = path.join(dir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
    writeFileSync(fakeBinary, 'echo 1.5.4')

    const manager = new CliBinaryManager({
      platform: process.platform,
      runCommand: async () => {
        throw new Error('EACCES: permission denied')
      }
    })

    const result = await manager.detect('antigravity', fakeBinary)
    expect(result.found).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Failed to execute binary')

    cleanupTmp()
  })

  it('executes real test fixture script when on windows', async () => {
    if (process.platform !== 'win32') return
    const fixturePath = path.resolve(__dirname, '../fixtures/cli-agents/fake-agy.cmd')
    const manager = new CliBinaryManager({ platform: 'win32' })
    const result = await manager.detect('antigravity', fixturePath)
    expect(result.found).toBe(true)
    expect(result.version).toBe('1.5.4')
    expect(result.valid).toBe(true)
  })

  it('executes real test fixture for old opencode script on windows', async () => {
    if (process.platform !== 'win32') return
    const fixturePath = path.resolve(__dirname, '../fixtures/cli-agents/fake-opencode-old.cmd')
    const manager = new CliBinaryManager({ platform: 'win32' })
    const result = await manager.detect('opencode', fixturePath)
    expect(result.found).toBe(true)
    expect(result.version).toBe('1.19.5')
    expect(result.valid).toBe(false)
  })

  it('threads injected platform to the command runner', async () => {
    const dir = createTmp()
    const fakeBinary = path.join(dir, 'agy')
    writeFileSync(fakeBinary, 'echo 1.5.4')

    let seenPlatform: NodeJS.Platform | undefined
    const manager = new CliBinaryManager({
      platform: 'darwin',
      runCommand: async (_file, _args, _env, platform) => {
        seenPlatform = platform
        return { stdout: '1.5.4\n', stderr: '', exitCode: 0 }
      }
    })

    const result = await manager.detect('antigravity', fakeBinary)
    expect(result.found).toBe(true)
    expect(seenPlatform).toBe('darwin')

    cleanupTmp()
  })
})
