import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './atomic-write'
import type { TerminalInfo } from '../shared/types'

export class TerminalStore {
  constructor(
    private readonly rootDir: string,
    private readonly logger?: { warn(msg: string): void }
  ) {}

  load(agentId: string): { info: TerminalInfo[]; logs: Record<string, string> } {
    const agentDir = path.join(this.rootDir, agentId)
    const indexPath = path.join(agentDir, 'index.json')

    if (!existsSync(indexPath)) {
      return { info: [], logs: {} }
    }

    try {
      const raw = readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        this.logger?.warn(`[meow] Corrupt terminal index for ${agentId}: expected array`)
        return { info: [], logs: {} }
      }

      const info = parsed as TerminalInfo[]
      const logs: Record<string, string> = {}
      for (const item of info) {
        if (!item || !item.id) continue
        const logPath = path.join(agentDir, `${item.id}.log`)
        try {
          logs[item.id] = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : ''
        } catch {
          logs[item.id] = ''
        }
      }

      return { info, logs }
    } catch (err) {
      this.logger?.warn(`[meow] Failed to load terminal index for ${agentId}: ${String(err)}`)
      return { info: [], logs: {} }
    }
  }

  save(agentId: string, info: TerminalInfo[], logs: Record<string, string>): void {
    const agentDir = path.join(this.rootDir, agentId)

    if (info.length === 0) {
      this.removeSession(agentId)
      return
    }

    const indexPath = path.join(agentDir, 'index.json')
    writeFileAtomic(indexPath, JSON.stringify(info, null, 2))

    const activeIds = new Set<string>()
    for (const item of info) {
      if (!item || !item.id) continue
      activeIds.add(item.id)
      const logContent = logs[item.id] ?? ''
      const logPath = path.join(agentDir, `${item.id}.log`)
      writeFileAtomic(logPath, logContent)
    }

    try {
      if (existsSync(agentDir)) {
        const files = readdirSync(agentDir)
        for (const file of files) {
          if (file.endsWith('.log')) {
            const id = file.slice(0, -4)
            if (!activeIds.has(id)) {
              rmSync(path.join(agentDir, file), { force: true })
            }
          }
        }
      }
    } catch {}
  }

  removeSession(agentId: string): void {
    const agentDir = path.join(this.rootDir, agentId)
    try {
      rmSync(agentDir, { recursive: true, force: true })
    } catch {}
  }
}
