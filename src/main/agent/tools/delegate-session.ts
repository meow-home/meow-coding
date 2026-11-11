import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import type { SessionDelegation } from '../../../shared/types'
import type { AgentRunContext } from '../run-context'

export interface DelegateSessionToolDeps {
  createDelegation(options: {
    sourceRun: AgentRunContext
    task: string
    title?: string
    model?: string
  }): Promise<SessionDelegation>
  runContext?: () => AgentRunContext | undefined
}

/**
 * Spawns a dedicated sub-session for a focused task (as opposed to the
 * ephemeral `task` subagent, which has no transcript of its own). The new
 * session is listed in the sidebar under this one, runs independently, and its
 * result is returned here durably.
 */
export function createDelegateSessionTool(opts: DelegateSessionToolDeps): ToolDefinition {
  return {
    name: 'delegate_session',
    description:
      'Create a new persistent sub-session in this project for a focused task, in contrast to the ' +
      'isolated ephemeral `task` worker. The sub-session is shown in the sidebar under this session, ' +
      'keeps its own transcript, model, mode, permission rules, hooks, MCP servers and tools, and ' +
      'returns its result here durably. It runs on this session\'s model unless you pass `model` ' +
      '(the user asked for a different one); the runtime resolves a model id or a name like "opus" ' +
      'and, when the value is ambiguous or unknown, the error lists the available models so you can ' +
      'retry with one of them. Do NOT edit the scope you delegate before the result returns.',
    schema: z.object({
      task: z.string()
        .describe('The concrete, self-contained task for the new sub-session to execute independently'),
      title: z.string().optional()
        .describe('Short sidebar title for the sub-session; derived from the task when omitted'),
      model: z.string().optional()
        .describe(
          'Model for the sub-session (e.g. "anthropic/claude-sonnet-4-5" or "opus"). Omit to use ' +
          'this session\'s model. On an ambiguous or unknown value the error lists the available models.'
        )
    }).strict(),
    async run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult> {
      const {
        task,
        title,
        model
      } = input as { task: string; title?: string; model?: string }
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
          task,
          ...(title?.trim() ? { title: title.trim() } : {}),
          ...(model?.trim() ? { model: model.trim() } : {})
        })
      } catch (err) {
        return { error: `delegate_session: ${err instanceof Error ? err.message : String(err)}` }
      }
      const target = record.targetName ? `"${record.targetName}" (${record.targetAgentId})` : record.targetAgentId
      const result: ToolRunResult = {
        output: `Delegation ${record.id} queued in new sub-session ${target}.`,
        metadata: { delegationId: record.id }
      }
      return result
    }
  }
}
