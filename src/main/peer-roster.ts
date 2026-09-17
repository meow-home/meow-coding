import type { Workspace } from '../shared/types'

export interface PeerTarget {
  agentId: string
  name: string
  /** `true` when sessions in the same project are delegatable. */
  projectPath: string
  sessionId: string
}

/**
 * Computes the delegatable peer sessions in the same project, excluding the
 * requesting agent. Persisted sessions are returned grouped by the owner, with
 * a stable identifier (`agentId`), the display name, its project path, and the
 * currently selected session id.
 */
export function computePeerTargets(
  workspaces: Workspace[],
  requestingAgentId?: string,
  requestingProjectPath?: string
): PeerTarget[] {
  if (!requestingAgentId || !requestingProjectPath) return []
  const peers: PeerTarget[] = []
  for (const ws of workspaces) {
    for (const agent of ws.agents) {
      if (agent.id === requestingAgentId) continue
      if (agent.cwd !== requestingProjectPath) continue
      const session = ws.sessions?.find(s => s.id === agent.sessionId)
      peers.push({
        agentId: agent.id,
        name: agent.name,
        projectPath: agent.cwd,
        sessionId: session?.id ?? agent.sessionId
      })
    }
  }
  return peers
}
