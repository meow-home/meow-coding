import type { TodoItem } from '../../shared/types'
import { harnessNote } from './harness-note'

/**
 * Todo staleness nudge. The `todowrite` policy lives in the tool description,
 * which models stop attending to over a long turn: they build a list at the
 * start and then never mark anything done. Re-stating the obligation inside a
 * tool result puts it back in front of the model at the moment it decides its
 * next step, the way the memory and git reminders do.
 */
export const TODO_NUDGE_AFTER_CALLS = 6
export const MAX_TODO_NUDGES = 2
const TODO_CONTENT_MAX = 80

export interface TodoNudgeDetector {
  /** Records one finished tool call; returns a note to attach, or null. */
  observe(tool: string, todos: TodoItem[]): string | null
}

function staleItem(todos: TodoItem[]): TodoItem | undefined {
  return todos.find(t => t.status === 'in_progress') ?? todos.find(t => t.status === 'pending')
}

function summarize(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > TODO_CONTENT_MAX ? `${flat.slice(0, TODO_CONTENT_MAX - 1)}…` : flat
}

function nudgeNote(item: TodoItem, nudge: number): string {
  const lead = nudge === 1
    ? `Todo list: "${summarize(item.content)}" is still ${item.status} after ${TODO_NUDGE_AFTER_CALLS} tool calls with no todowrite update.`
    : `Todo list: "${summarize(item.content)}" is still ${item.status}; this is reminder ${nudge} of ${MAX_TODO_NUDGES}.`
  return harnessNote(
    `${lead} Call todowrite now: mark finished items completed and set the next item in_progress. ` +
    'If you are blocked, keep it in_progress and add a follow-up item describing the blocker.'
  )
}

export function todoNudgeDetector(): TodoNudgeDetector {
  let sinceUpdate = 0
  let nudges = 0
  return {
    observe(tool, todos) {
      if (tool === 'todowrite') {
        sinceUpdate = 0
        return null
      }
      sinceUpdate++
      if (sinceUpdate < TODO_NUDGE_AFTER_CALLS || nudges >= MAX_TODO_NUDGES) return null
      const item = staleItem(todos)
      if (!item) return null
      nudges++
      sinceUpdate = 0
      return nudgeNote(item, nudges)
    }
  }
}
