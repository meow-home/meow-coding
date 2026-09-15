import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'

interface MonitorInput {
  id?: string
  command?: string
  until_regex?: string
  until_exit?: boolean | number
  interval_s?: number
  timeout_s?: number
}

export const monitorTool: ToolDefinition = {
  name: 'monitor',
  description:
    'Wait for a condition without blocking. Watch a background shell by id, OR poll a command periodically. ' +
    'Resolves when a regex matches output (until_regex), the shell exits / a poll succeeds (until_exit; poll defaults to exit 0), ' +
    'or a timeout elapses (timeout_s). Returns immediately; you are notified in the feed when it resolves. ' +
    'Use monitor to wait (e.g. until a server is ready or a command succeeds) instead of polling with bash_output in a loop. ' +
    'Provide exactly one of id or command.',
  schema: z.object({
    id: z.string().optional().describe('Watch this background shell (from bash run_in_background).'),
    command: z.string().optional().describe('Poll this shell command on an interval instead of watching a shell.'),
    until_regex: z.string().optional().describe('Resolve when output matches this regex.'),
    until_exit: z.union([z.boolean(), z.number()]).optional()
      .describe('id: resolve when the shell exits (number = expected code). command: resolve when a poll exits with this code (default 0).'),
    interval_s: z.number().optional().describe('command mode only: seconds between polls (default 5, min 1).'),
    timeout_s: z.number().optional().describe('Resolve as "timeout" after this many seconds if nothing else matched.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id, command, until_regex, until_exit, interval_s, timeout_s } = input as unknown as MonitorInput
    if (!ctx.agentId) return { error: 'monitor: not available in this context' }
    if ((id && command) || (!id && !command)) return { error: 'monitor: provide exactly one of id or command' }
    const timeoutMs = timeout_s !== undefined ? Math.round(timeout_s * 1000) : undefined

    if (command) {
      if (!ctx.pollMonitors) return { error: 'monitor: not available in this context' }
      const res = ctx.pollMonitors.start(ctx.agentId, command, ctx.cwd, {
        untilRegex: until_regex,
        untilExit: until_exit,
        intervalMs: interval_s !== undefined ? Math.round(interval_s * 1000) : undefined,
        timeoutMs
      })
      if ('error' in res) return { error: res.error }
      const conds = [
        until_regex ? `output matches /${until_regex}/` : null,
        (until_exit === undefined || until_exit !== false) ? 'the command succeeds' : null,
        timeout_s ? `${timeout_s}s pass` : null
      ].filter(Boolean).join(' or ')
      return { output: `Polling \`${command}\`; you'll be woken when ${conds}. (monitor ${res.id})`, background: true }
    }

    if (!ctx.monitors) return { error: 'monitor: not available in this context' }
    const res = ctx.monitors.start(ctx.agentId, id!, {
      untilRegex: until_regex,
      untilExit: until_exit,
      timeoutMs
    })
    if ('error' in res) return { error: res.error }
    const conds = [
      until_regex ? `output matches /${until_regex}/` : null,
      until_exit !== undefined ? 'it exits' : null,
      timeout_s ? `${timeout_s}s pass` : null
    ].filter(Boolean).join(' or ')
    return { output: `Monitoring shell ${id}; you'll be woken when ${conds}. (monitor ${res.id})`, background: true }
  }
}
