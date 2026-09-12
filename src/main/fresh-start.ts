import { randomUUID } from 'node:crypto'
import type { AgentConfig, Workspace } from '../shared/types'

interface StoreLike {
  load(): Workspace[]
  save(w: Workspace[]): void
}

export function makeSession(cwd: string): AgentConfig {
  return { id: randomUUID(), name: 'Session 1', templateId: 'meow', cwd, kind: 'native' }
}

/**
 * v0.37 model switch: drop CLI/pty agents and legacy multi-sessions. Each
 * project is reset to exactly one fresh native session. Runs once (guarded by
 * `alreadyDone`); returns whether it performed the reset.
 */
export function resetToSingleSession(
  store: StoreLike,
  opts: { alreadyDone: boolean; clearSessions: () => void; now?: () => AgentConfig }
): boolean {
  if (opts.alreadyDone) return false
  const all = store.load()
  for (const ws of all) {
    ws.agents = [opts.now ? opts.now() : makeSession(ws.projectPath)]
  }
  store.save(all)
  opts.clearSessions()
  return true
}
