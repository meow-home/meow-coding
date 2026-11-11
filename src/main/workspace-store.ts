import { randomUUID } from 'node:crypto'
import type { AgentConfig, NewAgentInput, SessionMeta, Workspace, WorkspaceSummary } from '../shared/types'
import type { JsonStore } from './json-store'

/**
 * Session rows for the sidebar: newest first, with each delegated sub-session
 * placed directly under its parent (a child whose parent was removed is shown
 * as a root row instead of disappearing).
 */
function sessionMetas(agents: AgentConfig[]): SessionMeta[] {
  const ids = new Set(agents.map(a => a.id))
  const children = new Map<string, AgentConfig[]>()
  const roots: AgentConfig[] = []
  for (const agent of agents.slice().reverse()) {
    const parent = agent.parentAgentId
    if (parent && ids.has(parent)) {
      const list = children.get(parent) ?? []
      list.push(agent)
      children.set(parent, list)
    } else {
      roots.push(agent)
    }
  }
  const metas: SessionMeta[] = []
  const seen = new Set<string>()
  const push = (agent: AgentConfig, parentAgentId?: string): void => {
    if (seen.has(agent.id)) return
    seen.add(agent.id)
    metas.push({ id: agent.id, name: agent.name, ...(parentAgentId ? { parentAgentId } : {}) })
    for (const child of children.get(agent.id) ?? []) push(child, agent.id)
  }
  for (const root of roots) push(root)
  return metas
}

export class WorkspaceStore {
  constructor(private store: JsonStore<Workspace>) {}

  // Raw whole-store access for one-off rewrites (the fresh-start reset). The
  // JsonStore array is the live in-memory copy, so mutating what `load()`
  // returns and passing it to `save()` persists in place.
  load(): Workspace[] {
    return this.store.load()
  }

  save(all: Workspace[]): void {
    this.store.save(all)
  }

  list(): WorkspaceSummary[] {
    return this.store.load().map(w => ({
      projectPath: w.projectPath,
      name: w.name,
      sessions: sessionMetas(w.agents)
    }))
  }

  get(projectPath: string): Workspace | undefined {
    return this.store.load().find(w => w.projectPath === projectPath)
  }

  add(projectPath: string, name: string): Workspace {
    const all = this.store.load()
    let ws = all.find(w => w.projectPath === projectPath)
    if (!ws) {
      ws = { projectPath, name, agents: [] }
      all.push(ws)
      this.store.save(all)
    }
    return ws
  }

  remove(projectPath: string): void {
    this.store.save(this.store.load().filter(w => w.projectPath !== projectPath))
  }

  reorder(projectPaths: string[]): WorkspaceSummary[] {
    const all = this.store.load()
    const map = new Map(all.map(w => [w.projectPath, w]))
    const reordered: Workspace[] = []
    for (const path of projectPaths) {
      const ws = map.get(path)
      if (ws) {
        reordered.push(ws)
        map.delete(path)
      }
    }
    for (const ws of map.values()) {
      reordered.push(ws)
    }
    this.store.save(reordered)
    return this.list()
  }

  addAgent(projectPath: string, input: NewAgentInput): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    const agent: AgentConfig = { id: randomUUID(), ...input }
    ws.agents.push(agent)
    this.store.save(all)
    return ws
  }

  /** Ids of every session delegated from `agentId` (recursively). */
  descendantIds(projectPath: string, agentId: string): string[] {
    const ws = this.get(projectPath)
    if (!ws) return []
    const found: string[] = []
    const queue = [agentId]
    while (queue.length > 0) {
      const parent = queue.shift()!
      for (const agent of ws.agents) {
        if (agent.parentAgentId === parent && !found.includes(agent.id)) {
          found.push(agent.id)
          queue.push(agent.id)
        }
      }
    }
    return found
  }

  removeAgent(projectPath: string, agentId: string): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    ws.agents = ws.agents.filter(a => a.id !== agentId)
    this.store.save(all)
    return ws
  }

  updateAgent(projectPath: string, agentId: string, patch: Partial<AgentConfig>): Workspace {
    const all = this.store.load()
    const ws = all.find(w => w.projectPath === projectPath)
    if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
    const agent = ws.agents.find(a => a.id === agentId)
    if (agent) Object.assign(agent, patch)
    this.store.save(all)
    return ws
  }
}
