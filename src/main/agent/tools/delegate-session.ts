import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import type { SessionDelegation } from '../../../shared/types'
import type { AgentRunContext } from '../run-context'
import type { SessionDelegationService } from '../../session-delegation-service'

export interface DelegateSessionToolDeps {
  createDelegation(options: {
    sourceRun: AgentRunContext
    targetAgentId: string
    task: string
  }): Promise<SessionDelegation>
  runContext?: () => AgentRunContext | undefined
}

/**
 * Routes a focused task to an existing persistent session (as opposed to the
 * isolated ephemeral `task` subagent). The target session keeps its own model,
 * mode, permission rules, hooks, MCP servers, and tools, and its result is
 * returned to the source durably.
 */
export function createDelegateSessionTool(opts: DelegateSessionToolDeps): ToolDefinition {
  return {
    name: 'delegate_session',
    description:
      'Route a focused task to another existing persistent session in the same project, in ' +
      'contrast to the isolated ephemeral `task` worker. The target session runs with its own ' +
      'model, mode, permission rules, hooks, MCP servers, tools, and memory. It executes ' +
      'independently and returns its result to this session durably. Delegations are queued and ' +
      'run one at a time per target session; you can continue working here while it runs. Do NOT ' +
      'edit the scope you delegate before the result returns.',
    schema: z.object({
      target_session_id: z.string()
        .describe('The agent/session id of the target persistent session in this project'),
      task: z.string()
        .describe('The concrete task for the target session to execute independently')
    }).strict(),
    async run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult> {
      const { target_session_id: targetAgentId, task } = input as {
        target_session_id: string
        task: string
      }
      const runContext = opts.runContext?.()
      if (!runContext) {
        return { error: 'delegate_session: no run context is available for this invocation.' }
      }
      if (runContext.origin !== 'user') {
        return { error: 'delegate_session: only a user-origin run may delegate work.' }
      }
      let record: SessionDelegation
      try {
        record = await opts.createDelegation({
          sourceRun: runContext,
          targetAgentId,
          task
        })
      } catch (err) {
        return { error: `delegate_session: ${err instanceof Error ? err.message : String(err)}` }
      }
      const result: ToolRunResult = {
        output: `Delegation ${record.id} queued for session ${record.targetAgentId}.`,
        metadata: { delegationId: record.id }
      }
      return result
    }
  }
}
