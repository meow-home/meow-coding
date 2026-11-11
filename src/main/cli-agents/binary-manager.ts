import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { CliCheckResult } from '../../shared/types'
import { buildSpawnCommand } from '../pty-manager'
import { ANTIGRAVITY_CLI } from './runtimes'

export function parseSemver(output: string): string | null {
  const match = output.match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/)
  return match ? match[1] : null
}

export function compareSemver(v1: string, v2: string): number {
  const toParts = (v: string): number[] => {
    const clean = v.replace(/^v/, '')
    const parts = clean.split('.').map(p => parseInt(p, 10) || 0)
    while (parts.length < 3) parts.push(0)
    return parts.slice(0, 3)
  }
  const p1 = toParts(v1)
  const p2 = toParts(v2)
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return 1
    if (p1[i] < p2[i]) return -1
  }
  return 0
}

export function isSemverGte(actual: string, min: string): boolean {
  return compareSemver(actual, min) >= 0
}

export interface CliCommandRunner {
  (file: string, args: string[], env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<{ stdout: string; stderr: string; exitCode: number | null }>
}

export interface CliBinaryManagerOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  runCommand?: CliCommandRunner
}

export function defaultRunCommand(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const resolved = buildSpawnCommand(file, args, platform)
    execFile(resolved.command, resolved.args, { timeout: 5000, env }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
      })
    })
  })
}

export class CliBinaryManager {
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly runCommand: CliCommandRunner

  constructor(opts: CliBinaryManagerOptions = {}) {
    this.env = opts.env ?? process.env
    this.platform = opts.platform ?? process.platform
    this.runCommand = opts.runCommand ?? ((file, args, env, platform = this.platform) => defaultRunCommand(file, args, env, platform))
  }

  getKnownInstallDirs(): string[] {
    const dirs: string[] = []
    const env = this.env

    if (this.platform === 'win32') {
      if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'agy', 'bin'))
      if (env.USERPROFILE) {
        dirs.push(path.join(env.USERPROFILE, '.agy', 'bin'))
        dirs.push(path.join(env.USERPROFILE, '.antigravity', 'bin'))
      }
    } else {
      if (env.HOME) {
        dirs.push(path.join(env.HOME, '.local', 'bin'))
        dirs.push(path.join(env.HOME, '.agy', 'bin'))
        dirs.push(path.join(env.HOME, '.antigravity', 'bin'))
      }
      dirs.push('/usr/local/bin')
    }

    return dirs
  }

  resolveBinary(): string | null {
    const isWin = this.platform === 'win32'
    const exts = (this.env.PATHEXT ?? (isWin ? '.EXE;.CMD;.BAT' : ''))
      .split(';')
      .filter(Boolean)

    const pathValue = this.env.PATH ?? this.env.Path ?? ''
    const pathDirs = pathValue.split(path.delimiter).filter(Boolean)
    const searchDirs = [...this.getKnownInstallDirs(), ...pathDirs]

    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue
      let dirEntries: string[] | null = null

      for (const binaryName of ANTIGRAVITY_CLI.binaryNames) {
        const hasExt = path.extname(binaryName) !== ''
        const candidates = hasExt ? [binaryName] : (isWin ? [binaryName, ...exts.map(e => binaryName + e.toLowerCase())] : [binaryName])

        for (const candidate of candidates) {
          const fullPath = path.join(dir, candidate)
          if (existsSync(fullPath)) {
            if (isWin) {
              if (dirEntries === null) {
                try { dirEntries = readdirSync(dir) } catch { dirEntries = [] }
              }
              const real = dirEntries.find(f => f.toLowerCase() === candidate.toLowerCase())
              return real ? path.join(dir, real) : fullPath
            }
            return fullPath
          }
        }
      }
    }

    return null
  }

  /** Readiness of the local `agy` install: found on disk and new enough. */
  async check(): Promise<CliCheckResult> {
    const minVersion = ANTIGRAVITY_CLI.minVersion
    const install = ANTIGRAVITY_CLI.installCommand(this.platform)
    const binaryPath = this.resolveBinary()

    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        minVersion,
        ready: false,
        error: 'agy was not found on PATH or in its known install locations.',
        install
      }
    }

    const base = { installed: true, binaryPath, minVersion, install }
    try {
      const result = await this.runCommand(binaryPath, [...ANTIGRAVITY_CLI.versionArgs], this.env, this.platform)
      const combined = `${result.stdout}
${result.stderr}`
      const version = parseSemver(combined)

      if (!version) {
        return { ...base, version: null, ready: false, error: `Could not read a version from: ${combined.trim().slice(0, 100)}` }
      }
      if (!isSemverGte(version, minVersion)) {
        return { ...base, version, ready: false, error: `Version ${version} is older than the required ${minVersion}.` }
      }
      return { ...base, version, ready: true }
    } catch (err) {
      return { ...base, version: null, ready: false, error: `Failed to run agy: ${(err as Error).message}` }
    }
  }
}
