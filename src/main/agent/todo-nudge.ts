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
export const MAX_TODO_NUDGES = 4
const TODO_CONTENT_MAX = 80
const END_OF_TURN_LIST_MAX = 8

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

export function openTodos(todos: TodoItem[]): TodoItem[] {
  return todos.filter(t => t.status === 'pending' || t.status === 'in_progress')
}

/**
 * End-of-turn gate. Mid-turn nudges only fire on tool calls, so a model that
 * finishes the work and writes its final answer leaves the list open forever.
 * The loop sends this once per run before letting such a turn end.
 */
export function todoEndOfTurnNote(todos: TodoItem[]): string | null {
  const open = openTodos(todos)
  if (open.length === 0) return null
  const shown = open.slice(0, END_OF_TURN_LIST_MAX).map(t => `- [${t.status}] ${summarize(t.content)}`)
  if (open.length > shown.length) shown.push(`- …and ${open.length - shown.length} more`)
  return harnessNote(
    `You are ending your turn, but the todo list still has ${open.length} open item(s):\n${shown.join('\n')}\n` +
    'Call todowrite now: mark every finished item completed and cancel items no longer needed ' +
    '(a fully finished list clears itself). If work remains, continue it instead of ending. ' +
    'If you are stopping to wait for the user, leave those items as they are. ' +
    'Do not repeat your previous answer; after the update, end with at most one short sentence.'
  )
}
