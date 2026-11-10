import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { CliInstallDescriptor, CliRuntimeDetectResult, CliRuntimeId } from '../../shared/types'
import { buildSpawnCommand } from '../pty-manager'
import { CLI_RUNTIMES, getCliRuntime } from './runtimes'

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
  userDataDir?: string
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
  private readonly userDataDir: string
  private readonly runCommand: CliCommandRunner

  constructor(opts: CliBinaryManagerOptions = {}) {
    this.env = opts.env ?? process.env
    this.platform = opts.platform ?? process.platform
    this.userDataDir = opts.userDataDir ?? ''
    this.runCommand = opts.runCommand ?? ((file, args, env, platform = this.platform) => defaultRunCommand(file, args, env, platform))
  }

  getKnownInstallDirs(runtimeId: CliRuntimeId): string[] {
    const dirs: string[] = []
    const env = this.env
    const isWin = this.platform === 'win32'

    if (runtimeId === 'antigravity') {
      if (isWin) {
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
    } else if (runtimeId === 'opencode') {
      if (isWin) {
        if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'))
        if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'opencode', 'bin'))
        if (env.USERPROFILE) dirs.push(path.join(env.USERPROFILE, '.opencode', 'bin'))
      } else {
        if (env.HOME) {
          dirs.push(path.join(env.HOME, '.opencode', 'bin'))
          dirs.push(path.join(env.HOME, '.npm-global', 'bin'))
          dirs.push(path.join(env.HOME, '.local', 'bin'))
        }
        dirs.push('/usr/local/bin')
        dirs.push('/opt/homebrew/bin')
      }
    }

    return dirs
  }

  resolveBinary(runtimeId: CliRuntimeId, manualPath?: string | null): string | null {
    if (manualPath && manualPath.trim()) {
      const trimmed = manualPath.trim()
      if (existsSync(trimmed)) {
        return path.resolve(trimmed)
      }
      return null
    }

    const runtime = getCliRuntime(runtimeId)
    const isWin = this.platform === 'win32'
    const exts = (this.env.PATHEXT ?? (isWin ? '.EXE;.CMD;.BAT' : ''))
      .split(';')
      .filter(Boolean)

    const knownDirs = this.getKnownInstallDirs(runtimeId)
    const pathValue = this.env.PATH ?? this.env.Path ?? ''
    const pathDirs = pathValue.split(path.delimiter).filter(Boolean)
    const searchDirs = [...knownDirs, ...pathDirs]

    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue
      let dirEntries: string[] | null = null

      for (const binaryName of runtime.binaryNames) {
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

  getInstallDescriptor(runtimeId: CliRuntimeId): CliInstallDescriptor | null {
    const runtime = getCliRuntime(runtimeId)
    return runtime.installCommand(this.platform)
  }

  async detect(runtimeId: CliRuntimeId, manualPath?: string | null): Promise<CliRuntimeDetectResult> {
    const runtime = getCliRuntime(runtimeId)
    const resolvedPath = this.resolveBinary(runtimeId, manualPath)

    if (!resolvedPath) {
      return {
        runtime: runtimeId,
        found: false,
        binaryPath: null,
        version: null,
        valid: false,
        minVersion: runtime.minVersion,
        error: manualPath ? `Binary not found at specified path: ${manualPath}` : 'Binary not found on PATH or known install locations'
      }
    }

    try {
      const result = await this.runCommand(resolvedPath, runtime.versionArgs, this.env, this.platform)
      const combined = `${result.stdout}\n${result.stderr}`
      const parsedVersion = parseSemver(combined)

      if (!parsedVersion) {
        return {
          runtime: runtimeId,
          found: true,
          binaryPath: resolvedPath,
          version: null,
          valid: false,
          minVersion: runtime.minVersion,
          error: `Could not parse version from output: ${combined.trim().slice(0, 100)}`
        }
      }

      const valid = isSemverGte(parsedVersion, runtime.minVersion)
      return {
        runtime: runtimeId,
        found: true,
        binaryPath: resolvedPath,
        version: parsedVersion,
        valid,
        minVersion: runtime.minVersion,
        error: valid ? undefined : `Version ${parsedVersion} is lower than required minimum ${runtime.minVersion}`
      }
    } catch (err) {
      return {
        runtime: runtimeId,
        found: true,
        binaryPath: resolvedPath,
        version: null,
        valid: false,
        minVersion: runtime.minVersion,
        error: `Failed to execute binary: ${(err as Error).message}`
      }
    }
  }
}
