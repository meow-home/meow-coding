import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface MonitorInput {
  id: string
  until_regex?: string
  until_exit?: boolean | number
  timeout_s?: number
}

export const monitorTool: ToolDefinition = {
  name: 'monitor',
  description:
    'Watch a background shell (started with bash run_in_background) and get woken when a condition is met: ' +
    'a regex appears in its output (until_regex), it exits (until_exit), or a timeout elapses (timeout_s). ' +
    'Returns immediately; you are notified in the feed when it resolves. Provide at least one condition. ' +
    'Use monitor to wait for a background shell to become ready or finish instead of calling bash_output in a loop.',
  schema: z.object({
    id: z.string().describe('The background shell id to watch.'),
    until_regex: z.string().optional().describe('Resolve when a new output line matches this regex.'),
    until_exit: z.union([z.boolean(), z.number()]).optional()
      .describe('Resolve when the shell exits; pass a number to note an expected exit code.'),
    timeout_s: z.number().optional().describe('Resolve as "timeout" after this many seconds if nothing else matched.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id, until_regex, until_exit, timeout_s } = input as unknown as MonitorInput
    if (!ctx.monitors || !ctx.agentId) return { error: 'monitor: not available in this context' }
    const res = ctx.monitors.start(ctx.agentId, id, {
      untilRegex: until_regex,
      untilExit: until_exit,
      timeoutMs: timeout_s !== undefined ? Math.round(timeout_s * 1000) : undefined
    })
    if ('error' in res) return { error: res.error }
    const conds = [
      until_regex ? `output matches /${until_regex}/` : null,
      until_exit !== undefined ? 'it exits' : null,
      timeout_s ? `${timeout_s}s pass` : null
    ].filter(Boolean).join(' or ')
    return {
      output: `Monitoring shell ${id}; you'll be woken when ${conds}. (monitor ${res.id})`,
      background: true
    }
  }
}
