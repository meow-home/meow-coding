import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import type { SessionDelegation } from '../../../shared/types'
import { ANTIGRAVITY_AGENT_ID, ANTIGRAVITY_AGENT_NAME } from '../../../shared/types'
import type { AgentRunContext } from '../run-context'

export interface DelegateCliToolDeps {
  createDelegation(input: { sourceRun: AgentRunContext; task: string }): Promise<SessionDelegation>
  /** Readiness of the local Antigravity CLI; a not-ready CLI refuses the call instead of queueing it. */
  checkCli?(): Promise<{ ready: boolean; error?: string }>
  runContext?(): AgentRunContext | undefined
}

export function createDelegateCliTool(opts: DelegateCliToolDeps): ToolDefinition {
  return {
    name: 'delegate_cli',
    description:
      'Delegate a focused task to the Antigravity CLI (agy), which runs it headless in this project with its own ' +
      'tools. Works like delegate_session: the task is queued, and the result is appended to this session and ' +
      'wakes it. Each call is a fresh Antigravity run with no memory of earlier ones, so make the task ' +
      'self-contained. Verify the result independently and do not edit the delegated scope while it runs.',
    schema: z.object({
      task: z.string()
        .describe('The concrete, self-contained task for Antigravity to execute independently')
    }).strict(),
    async run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult> {
      try {
        const { task } = input as { task: string }

        const runContext = opts.runContext?.() ?? ctx.runContext
        if (!runContext) {
          return { error: 'delegate_cli: no run context is available for this invocation.' }
        }
        if (runContext.origin !== 'user') {
          return { error: 'delegate_cli: only a user-origin run may delegate work.' }
        }

        const check = await opts.checkCli?.()
        if (check && !check.ready) {
          return {
            error: `delegate_cli: the Antigravity CLI is not ready (${check.error ?? 'unknown reason'}). ` +
              'The user can check it in Settings > Antigravity CLI.'
          }
        }

        const record = await opts.createDelegation({ sourceRun: runContext, task })
        return {
          output: `Delegation ${record.id} queued for ${ANTIGRAVITY_AGENT_NAME}.`,
          metadata: { delegationId: record.id, cliAgentId: ANTIGRAVITY_AGENT_ID }
        }
      } catch (err) {
        return { error: `delegate_cli: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  }
}
