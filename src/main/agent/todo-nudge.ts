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

function nudgeNote(item: TodoItem, todos: TodoItem[], nudge: number): string {
  const lead = nudge === 1
    ? `Todo list: "${summarize(item.content)}" is still ${item.status} after ${TODO_NUDGE_AFTER_CALLS} tool calls with no todowrite update.`
    : `Todo list: "${summarize(item.content)}" is still ${item.status}; this is reminder ${nudge} of ${MAX_TODO_NUDGES}.`
  return harnessNote(
    `${lead} Open items:\n${listOpen(todos)}\n` +
    'Your next tool call must be todowrite: mark every item you have already finished completed and set the ' +
    'item you are working on in_progress. If you are blocked, keep it in_progress and add a follow-up item ' +
    'describing the blocker.'
  )
}

function listOpen(todos: TodoItem[]): string {
  const open = openTodos(todos)
  const shown = open.slice(0, END_OF_TURN_LIST_MAX).map(t => `- [${t.status}] ${summarize(t.content)}`)
  if (open.length > shown.length) shown.push(`- …and ${open.length - shown.length} more`)
  return shown.join('\n')
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
      return nudgeNote(item, todos, nudges)
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
// Real sessions showed the old escape hatch ("if you are waiting for the user,
// leave the items") kept items like "wait for the user's review" in_progress
// forever, so the gate fired on every later turn. Waiting is not work: only an
// item the model will still do itself may stay open.
export function todoEndOfTurnNote(todos: TodoItem[]): string | null {
  const open = openTodos(todos)
  if (open.length === 0) return null
  return harnessNote(
    `You are ending your turn, but the todo list still has ${open.length} open item(s):\n${listOpen(todos)}\n` +
    'Call todowrite now: mark every finished item completed and cancel items no longer needed ' +
    '(a fully finished list clears itself). If work remains, continue it instead of ending. ' +
    'Items that only wait on the user (review, approval, sign-in, restart, manual testing) are not work: ' +
    'complete or cancel them. Leave an item open only if you will still do that work yourself after the ' +
    "user's reply. Do not repeat or summarize your previous answer: after the todowrite call, end the turn " +
    'without writing any more text.'
  )
}

/**
 * Turn-start note for a list left open by an earlier turn. Without it the
 * model starts the new request unaware of the stale list, so the list either
 * lingers or gets cleaned up only by the end-of-turn gate.
 */
export function todoCarryOverNote(todos: TodoItem[]): string | null {
  const open = openTodos(todos)
  if (open.length === 0) return null
  return harnessNote(
    `The todo list still has ${open.length} open item(s) from an earlier turn:\n${listOpen(todos)}\n` +
    'If they belong to the work this message asks for, keep updating them as you go. Otherwise, or if they ' +
    'are already done or only wait on the user, call todowrite first to complete or cancel them (or replace ' +
    'the list with a plan for the new request).'
  )
}
