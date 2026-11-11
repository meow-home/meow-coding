import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CliBinaryManager,
  compareSemver,
  isSemverGte,
  parseSemver
} from '../../src/main/cli-agents/binary-manager'
import { ANTIGRAVITY_CLI } from '../../src/main/cli-agents/runtimes'

const isWin = process.platform === 'win32'
const binaryName = isWin ? 'agy.cmd' : 'agy'

describe('Antigravity CLI definition', () => {
  it('describes the agy binary and its minimum version', () => {
    expect(ANTIGRAVITY_CLI.label).toBe('Antigravity')
    expect(ANTIGRAVITY_CLI.binaryNames).toContain('agy')
    expect(ANTIGRAVITY_CLI.minVersion).toBe('1.5.0')
    expect(ANTIGRAVITY_CLI.docsUrl).toContain('antigravity.google')
  })

  it('provides an install command per platform', () => {
    const win = ANTIGRAVITY_CLI.installCommand('win32')
    expect(win.command).toBe('powershell.exe')
    expect(win.args.join(' ')).toContain('install.ps1')

    const linux = ANTIGRAVITY_CLI.installCommand('linux')
    expect(linux.command).toBe('bash')
    expect(linux.args.join(' ')).toContain('install.sh')
  })
})

describe('Semver utilities', () => {
  it('parses semver from various output strings', () => {
    expect(parseSemver('1.5.4')).toBe('1.5.4')
    expect(parseSemver('agy version v1.6.0 (build 12)')).toBe('1.6.0')
    expect(parseSemver('2.1')).toBe('2.1')
    expect(parseSemver('no version here')).toBeNull()
  })

  it('compares semver strings correctly', () => {
    expect(compareSemver('1.5.0', '1.5.0')).toBe(0)
    expect(compareSemver('1.5.1', '1.5.0')).toBe(1)
    expect(compareSemver('1.4.9', '1.5.0')).toBe(-1)
    expect(compareSemver('2.0', '1.9.9')).toBe(1)
  })

  it('checks isSemverGte accurately', () => {
    expect(isSemverGte('1.5.0', '1.5.0')).toBe(true)
    expect(isSemverGte('1.10.0', '1.5.0')).toBe(true)
    expect(isSemverGte('1.4.0', '1.5.0')).toBe(false)
  })
})

describe('CliBinaryManager', () => {
  const tmpDirs: string[] = []

  function createTmp(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-cli-bin-'))
    tmpDirs.push(dir)
    return dir
  }

  function envWithBinaryOnPath(): { env: NodeJS.ProcessEnv; binary: string } {
    const dir = createTmp()
    const binary = path.join(dir, binaryName)
    writeFileSync(binary, 'echo 1.5.4')
    return { env: { PATH: dir, PATHEXT: '.CMD;.EXE' }, binary }
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('resolves the binary from PATH', () => {
    const { env, binary } = envWithBinaryOnPath()
    const manager = new CliBinaryManager({ env })
    expect(manager.resolveBinary()).toBe(binary)
  })

  it('resolves the binary from a known install directory', () => {
    const home = createTmp()
    const binDir = path.join(home, '.agy', 'bin')
    mkdirSync(binDir, { recursive: true })
    const binary = path.join(binDir, binaryName)
    writeFileSync(binary, 'echo 1.5.4')

    const manager = new CliBinaryManager({
      env: { PATH: '', PATHEXT: '.CMD;.EXE', HOME: home, USERPROFILE: home }
    })
    expect(manager.resolveBinary()).toBe(binary)
  })

  it('reports a ready install when the version is new enough', async () => {
    const { env, binary } = envWithBinaryOnPath()
    const manager = new CliBinaryManager({
      env,
      runCommand: async () => ({ stdout: '1.5.4\n', stderr: '', exitCode: 0 })
    })

    const result = await manager.check()
    expect(result).toMatchObject({ installed: true, binaryPath: binary, version: '1.5.4', minVersion: '1.5.0', ready: true })
    expect(result.error).toBeUndefined()
    expect(result.install.command).toBeTruthy()
  })

  it('reports an outdated install as not ready', async () => {
    const { env } = envWithBinaryOnPath()
    const manager = new CliBinaryManager({
      env,
      runCommand: async () => ({ stdout: 'agy 1.4.2\n', stderr: '', exitCode: 0 })
    })

    const result = await manager.check()
    expect(result.installed).toBe(true)
    expect(result.version).toBe('1.4.2')
    expect(result.ready).toBe(false)
    expect(result.error).toContain('older than the required 1.5.0')
  })

  it('reports not installed, with the install command, when agy cannot be located', async () => {
    const manager = new CliBinaryManager({
      env: { PATH: '', LOCALAPPDATA: '', USERPROFILE: '', HOME: '' },
      platform: 'win32'
    })

    const result = await manager.check()
    expect(result.installed).toBe(false)
    expect(result.ready).toBe(false)
    expect(result.binaryPath).toBeNull()
    expect(result.error).toContain('not found')
    expect(result.install.command).toBe('powershell.exe')
  })

  it('reports an unreadable version as not ready', async () => {
    const { env } = envWithBinaryOnPath()
    const manager = new CliBinaryManager({
      env,
      runCommand: async () => ({ stdout: 'hello\n', stderr: '', exitCode: 0 })
    })

    const result = await manager.check()
    expect(result.installed).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.error).toContain('Could not read a version')
  })

  it('handles execution failures gracefully', async () => {
    const { env } = envWithBinaryOnPath()
    const manager = new CliBinaryManager({
      env,
      runCommand: async () => {
        throw new Error('EACCES: permission denied')
      }
    })

    const result = await manager.check()
    expect(result.installed).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.error).toContain('Failed to run agy')
  })

  it('threads the injected platform to the command runner', async () => {
    const dir = createTmp()
    writeFileSync(path.join(dir, 'agy'), 'echo 1.5.4')

    let seenPlatform: NodeJS.Platform | undefined
    const manager = new CliBinaryManager({
      env: { PATH: dir },
      platform: 'darwin',
      runCommand: async (_file, _args, _env, platform) => {
        seenPlatform = platform
        return { stdout: '1.5.4\n', stderr: '', exitCode: 0 }
      }
    })

    const result = await manager.check()
    expect(result.installed).toBe(true)
    expect(seenPlatform).toBe('darwin')
  })

  it('runs a real agy.cmd shim on Windows', async () => {
    if (!isWin) return
    const dir = createTmp()
    copyFileSync(path.resolve(__dirname, '../fixtures/cli-agents/fake-agy.cmd'), path.join(dir, 'agy.cmd'))
    const { Path: _path, PATH: _PATH, ...rest } = process.env
    const systemPath = _PATH ?? _path ?? ''
    const manager = new CliBinaryManager({
      env: { ...rest, PATH: `${dir}${path.delimiter}${systemPath}`, LOCALAPPDATA: '', USERPROFILE: '' }
    })

    const result = await manager.check()
    expect(result.version).toBe('1.5.4')
    expect(result.ready).toBe(true)
  })
})
