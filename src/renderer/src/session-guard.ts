import type { WorkspaceRuntime, WorkspaceSummary } from '@shared/types'

/**
 * Whether removing `sessionId` would leave `projectPath` with no sessions — the
 * decision behind the "a project always has ≥ 1 session" invariant.
 *
 * The mounted runtime is the truth for an open project (it is what the panes are
 * built from); a project that has only ever been listed — never opened — has no
 * runtime, so it falls back to the sidebar summary. An id that is unknown to
 * whichever source applies is not the last session: without it the caller would
 * create a replacement session while deleting nothing.
 *
 * Pure: it reads no component state, so the invariant that two fix rounds were
 * spent on is unit-testable rather than only reachable through the UI.
 */
export function isLastSession(
  projectPath: string,
  sessionId: string,
  runtimes: Record<string, WorkspaceRuntime>,
  workspaces: WorkspaceSummary[]
): boolean {
  const rt = runtimes[projectPath]
  const knownIds = rt
    ? rt.workspace.agents.map(a => a.id)
    : (workspaces.find(w => w.projectPath === projectPath)?.sessions.map(s => s.id) ?? [])
  return knownIds.length <= 1 && knownIds.includes(sessionId)
}
