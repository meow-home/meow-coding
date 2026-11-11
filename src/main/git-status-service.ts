import { execFile } from 'node:child_process'
import type { GitStatus } from '../shared/types'

export class GitStatusService {
  get(projectPath: string): Promise<GitStatus | null> {
    return new Promise(resolve => {
      execFile(
        'git',
        ['status', '--porcelain=v2', '-b', '--untracked-files=all'],
        { cwd: projectPath, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 4 },
        (err, stdout) => {
          if (err) return resolve(null)
          resolve(this.parse(stdout))
        }
      )
    })
  }

  parse(stdout: string): GitStatus {
    let branch: string | null = null
    let upstream: string | null = null
    let ahead = 0
    let behind = 0
    let dirtyCount = 0
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) {
        const value = line.slice('# branch.head '.length)
        branch = value === '(detached)' ? null : value
      } else if (line.startsWith('# branch.upstream ')) {
        upstream = line.slice('# branch.upstream '.length).trim() || null
      } else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/^# branch\.ab \+(\d+) -(\d+)$/)
        if (m) {
          ahead = Number(m[1])
          behind = Number(m[2])
        }
      } else if (line.length > 0 && !line.startsWith('#')) {
        dirtyCount++
      }
    }
    return { branch, dirtyCount, upstream, ahead, behind }
  }
}
