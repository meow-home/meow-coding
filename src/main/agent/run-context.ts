/** Fixed identity for a single agent turn, so delegated runs land in a stable
 *  internal session and results can be correlated back to the delegation. */
export interface AgentRunContext {
  runId: string
  agentId: string
  sessionId: string
  origin: 'user' | 'delegation'
}

export interface AgentTurnResult {
  runId: string
  reason: 'completed' | 'failed' | 'cancelled'
  finalText?: string
  error?: string
  touchedFiles: string[]
}

export interface DelegatedTurnInput {
  delegationId: string
  sourceAgentId: string
  sourceName: string
  targetAgentId: string
  targetSessionId: string
  task: string
}

export interface DelegationResultInput {
  delegationId: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetName: string
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  result?: string
  error?: string
  touchedFiles: string[]
}
