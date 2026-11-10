import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import type { SessionDelegation } from '../../../shared/types'
import type { AgentRunContext } from '../run-context'

export interface DelegateCliTarget {
  id: string
  label: string
  status: string
}

export interface DelegateCliToolDeps {
  createDelegation(input: {
    sourceRun: AgentRunContext
    targetCliAgentId: string
    task: string
    cliSessionId?: string
  }): Promise<SessionDelegation>
  resolveCliAgent?(query: string): DelegateCliTarget | undefined
  listCliAgents?(): DelegateCliTarget[]
  runContext?(): AgentRunContext | undefined
}

/**
 * Routes a focused task to a CLI worker agent (Antigravity/OpenCode).
 * The task is queued in a CLI session; the result is appended to this session and wakes it.
 * The CLI agent has its own tools/permissions; verify the result independently and do not
 * edit the delegated scope while it runs. Use session_id only to send feedback to the same CLI conversation.
 */
export function createDelegateCliTool(opts: DelegateCliToolDeps): ToolDefinition {
  return {
    name: 'delegate_cli',
    description:
      'Route a focused task to a CLI worker agent (Antigravity/OpenCode). The task is queued in a CLI ' +
      'session; the result is appended to this session and wakes it. The CLI agent has its own ' +
      'tools/permissions; verify the result independently and do not edit the delegated scope while ' +
      'it runs. Use session_id only to send feedback to the same CLI conversation.',
    schema: z.object({
      agent: z.string()
        .describe('The id or label of the target CLI agent (e.g. Antigravity or OpenCode profile)'),
      task: z.string()
        .describe('The concrete task for the CLI agent to execute independently'),
      session_id: z.string().optional()
        .describe('Optional CLI session id to continue an existing conversation for feedback')
    }).strict(),
    async run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult> {
      try {
        const { agent, task, session_id } = input as {
          agent: string
          task: string
          session_id?: string
        }

        const runContext = opts.runContext?.() ?? ctx.runContext
        if (!runContext) {
          return { error: 'delegate_cli: no run context is available for this invocation.' }
        }
        if (runContext.origin !== 'user') {
          return { error: 'delegate_cli: only a user-origin run may delegate work.' }
        }

        const query = (agent ?? '').trim()
        let target: DelegateCliTarget | undefined = opts.resolveCliAgent?.(query)
        if (!target && opts.resolveCliAgent && query !== agent) {
          target = opts.resolveCliAgent(agent)
        }
        if (!target && opts.listCliAgents) {
          const all = opts.listCliAgents()
          target = all.find(a => a.id === query || a.id === agent)
          if (!target) {
            const lower = query.toLowerCase()
            target = all.find(a => a.label.toLowerCase() === lower)
          }
        }

        if (!target) {
          const available = opts.listCliAgents?.() ?? []
          if (available.length === 0) {
            return { error: `delegate_cli: unknown CLI agent "${agent}". No CLI agents are available.` }
          }
          const list = available.map(a => `${a.id} — ${a.label}`).join(', ')
          return { error: `delegate_cli: unknown CLI agent "${agent}". Available agents: ${list}` }
        }

        if (target.status !== 'ready') {
          return { error: `delegate_cli: CLI agent "${target.label}" is not ready (${target.status}).` }
        }

        const record = await opts.createDelegation({
          sourceRun: runContext,
          targetCliAgentId: target.id,
          task,
          cliSessionId: session_id
        })

        return {
          output: `Delegation ${record.id} queued for ${target.label}.`,
          metadata: { delegationId: record.id, cliAgentId: target.id }
        }
      } catch (err) {
        return { error: `delegate_cli: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  }
}
