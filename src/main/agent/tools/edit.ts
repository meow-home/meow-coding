import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import { resolveCwd } from './bash'
import { snapshotFile } from './snapshot-util'
import { recordArtifact } from './artifact'
import { findUniqueText, formatTextMatchError } from './text-match'

export const editTool: ToolDefinition = {
  name: 'edit',
  description:
    'Replace an exact old_string with new_string inside a file. old_string must match exactly once.',
  schema: z.object({
    file_path: z.string().describe('Absolute path or path relative to the project root.'),
    old_string: z.string().describe('The exact text to find and replace.'),
    new_string: z.string().describe('The replacement text.')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { file_path, old_string, new_string } = input as unknown as {
      file_path: string
      old_string: string
      new_string: string
    }
    const full = resolveCwd(ctx.cwd, file_path)
    if (!existsSync(full)) return { error: `edit: file not found: ${file_path}` }
    const content = readFileSync(full, 'utf-8')
    const match = findUniqueText(content, old_string)
    if ('error' in match) return { error: formatTextMatchError(match.error, match.count) }
    snapshotFile(ctx, full)
    const replacement = match.newline === 'crlf' ? new_string.replace(/(?<!\r)\n/g, '\r\n') : new_string
    const updated = content.slice(0, match.start) + replacement + content.slice(match.end)
    writeFileSync(full, updated)
    recordArtifact(ctx, full, 'edit')
    const diag = ctx.diagnostics ? await ctx.diagnostics(full, updated) : ''
    return { output: `edited ${file_path}${diag ? `\n${diag}` : ''}` }
  }
}
