import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { searchProject } from '../../project-search'

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a regular expression and return matching file:line entries.',
  schema: z.object({
    pattern: z.string().describe('Regular expression to search for.'),
    path: z.string().optional().describe('Directory to search (default: project root).'),
    include: z.array(z.string()).optional().describe('Glob patterns for files to include, e.g. ["*.ts"].')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { pattern, path: searchPath, include } = input as unknown as {
      pattern: string
      path?: string
      include?: string[]
    }
    const dir = resolveCwd(ctx.cwd, searchPath ?? '.')
    let hits
    try {
      hits = await searchProject(dir, pattern, { include })
    } catch {
      return { error: `grep: invalid regex: ${pattern}` }
    }
    if (hits.length === 0) return { output: '(no matches)' }
    return { output: hits.map(h => `${h.path}:${h.line}: ${h.text}`).join('\n') }
  }
}
