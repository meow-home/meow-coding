import type { Workspace } from '../shared/types'
import type { SessionPeer } from './agent/env'

export type { SessionPeer } from './agent/env'

export interface PeerLookup {
  requestingAgentId?: string
  requestingProjectPath?: string
  /** Live mode per agent; falls back to 'build' when unknown. */
  modeOf?: (agentId: string) => SessionPeer['mode'] | undefined
  /** Live run state per agent; falls back to 'idle' when unknown. */
  stateOf?: (agentId: string) => SessionPeer['state'] | undefined
}

/**
 * Computes the delegatable peer sessions for the requesting agent: only other
 * agents in the same project (matched on a normalized path), excluding the
 * requesting agent itself. Mode and run-state come from the supplied lookups so
 * the caller (agent manager) decides the live values.
 */
export function computePeerTargets(
  workspaces: Workspace[],
  lookup: PeerLookup = {}
): SessionPeer[] {
  const { requestingAgentId, requestingProjectPath } = lookup
  if (!requestingAgentId || !requestingProjectPath) return []
  const peers: SessionPeer[] = []
  for (const ws of workspaces) {
    for (const agent of ws.agents) {
      if (agent.id === requestingAgentId) continue
      if (normalize(agent.cwd) !== normalize(requestingProjectPath)) continue
      peers.push({
        agentId: agent.id,
        name: agent.name,
        mode: lookup.modeOf?.(agent.id) ?? 'build',
        state: lookup.stateOf?.(agent.id) ?? 'idle'
      })
    }
  }
  return peers
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}
