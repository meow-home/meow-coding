import { z } from 'zod'
import type { SessionDelegation } from '../../../shared/types'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'

export interface DelegateResultToolDeps {
  getDelegation(id: string): SessionDelegation | undefined
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

/**
 * Reads a delegated sub-session's stored result. The body is delivered as tool
 * output (data the model reads) instead of a user turn, so a sub-session's own
 * text can never act as instructions on the delegating session.
 */
export function createDelegateResultTool(opts: DelegateResultToolDeps): ToolDefinition {
  return {
    name: 'delegate_result',
    description:
      'Read the stored result of a delegation started with delegate_session or delegate_cli. ' +
      'Delegation results are never injected into the conversation as user messages: when a ' +
      'delegated session finishes, a note is appended to the transcript and you read the body here. ' +
      'Returns the status plus the sub-session\'s final answer, error, or touched files.',
    schema: z.object({
      id: z.string().describe('Delegation id returned by delegate_session or delegate_cli')
    }).strict(),
    async run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult> {
      const { id } = input as { id: string }
      const record = opts.getDelegation(id)
      if (!record) return { error: `delegate_result: unknown delegation id "${id}".` }
      if (ctx.agentId && record.sourceAgentId !== ctx.agentId) {
        return { error: `delegate_result: delegation "${id}" belongs to another session.` }
      }
      const who = record.targetName ? `"${record.targetName}" (${record.targetAgentId})` : record.targetAgentId
      const head = `Delegation ${record.id} — ${who}`
      if (!TERMINAL.has(record.status)) {
        return {
          output: `${head}\n\n**Status:** ${record.status} — no result yet. You are notified when it finishes.`,
          metadata: { delegationId: record.id, status: record.status }
        }
      }
      const body = record.status === 'completed'
        ? record.result ?? '(the sub-session produced no text)'
        : record.error ?? record.result ?? '(no error reported)'
      const touched = record.touchedFiles?.length
        ? `\n\n**Touched files:**\n${record.touchedFiles.map(f => `- ${f}`).join('\n')}`
        : ''
      const truncated = record.resultTruncated ? '\n\n_(result truncated at the storage limit)_' : ''
      return {
        output: `${head}\n\n**Status:** ${record.status}\n\n${body}${truncated}${touched}`,
        metadata: { delegationId: record.id, status: record.status, touchedFiles: record.touchedFiles ?? [] }
      }
    }
  }
}
