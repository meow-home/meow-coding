import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { TodoItem } from '../../../shared/types'

// Ported from opencode's todowrite.txt: explicit per-task triggers so the
// model updates the list as it works instead of batching one update at the end.
const TODOWRITE_DESCRIPTION = [
  'Create and maintain a structured task list for the current coding session. Tracks progress,',
  'organizes multi-step work, and surfaces status to the user.',
  '',
  '## When to use',
  'Use proactively when:',
  '- The task requires 3+ distinct steps or actions',
  '- The work is non-trivial and benefits from planning',
  '- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list',
  '- New instructions arrive — capture them as todos',
  '- You start a task — mark it `in_progress` (only one at a time) before working',
  '- You finish a task — mark it `completed` and add any follow-ups discovered during the work',
  '',
  '## When NOT to use',
  'Skip when the work is a single, straightforward task, purely informational, or tracking adds no value.',
  '',
  '## States',
  '- `pending` — not started',
  '- `in_progress` — actively working (exactly ONE at a time)',
  '- `completed` — finished and verified',
  '- `cancelled` — no longer needed',
  '',
  '## Rules',
  '- Update status in real time; don\'t batch completions',
  '- Mark `completed` only after the work is actually done, including verification — never based on intent',
  '- When every item is `completed` or `cancelled`, the list is cleared automatically — send the final finished list, no empty-list call is needed',
  '- Keep exactly one `in_progress` while work remains',
  '- If blocked or partial, keep it `in_progress` and add a follow-up todo describing the blocker',
  '- Items should be specific and actionable; break large work into smaller steps'
].join('\n')

export const todowriteTool: ToolDefinition = {
  name: 'todowrite',
  description: TODOWRITE_DESCRIPTION,
  schema: z.object({
    todos: z.array(z.object({
      content: z.string().describe('Brief description of the task'),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
        .describe('Current status of the task'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level of the task')
    })).describe('The updated todo list')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    // The model can emit `todos` as a JSON-encoded string instead of an array
    // (e.g. a stringified array). Guard before persisting so a malformed value
    // never lands in the session record and later crashes the renderer on load.
    let todos: TodoItem[] = Array.isArray(input.todos)
      ? (input.todos as unknown as TodoItem[])
      : []
    // A finished list has served its purpose: once nothing is pending or in
    // progress the session todos reset to [], so the renderer's pill disappears
    // and a later turn starts from a clean slate instead of inheriting a stale
    // all-completed list.
    const cleared = todos.length > 0 && todos.every(t => t.status === 'completed' || t.status === 'cancelled')
    if (cleared) todos = []
    ctx.setTodos?.(todos)
    const output = cleared
      ? `${JSON.stringify(todos, null, 2)}\n\nTodo list cleared: every item was completed or cancelled.`
      : JSON.stringify(todos, null, 2)
    return { output }
  }
}
