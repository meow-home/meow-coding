import { describe, expect, it } from 'vitest'
import { MAX_TODO_NUDGES, TODO_NUDGE_AFTER_CALLS, openTodos, todoEndOfTurnNote, todoNudgeDetector } from '../../src/main/agent/todo-nudge'
import type { TodoItem } from '../../src/shared/types'

const working: TodoItem[] = [
  { content: 'read the code', status: 'completed' },
  { content: 'write the fix', status: 'in_progress' },
  { content: 'run the tests', status: 'pending' }
]

function observeCalls(detector: ReturnType<typeof todoNudgeDetector>, count: number, todos: TodoItem[]): (string | null)[] {
  return Array.from({ length: count }, () => detector.observe('read', todos))
}

describe('todoNudgeDetector', () => {
  it('stays quiet until the window is full', () => {
    const notes = observeCalls(todoNudgeDetector(), TODO_NUDGE_AFTER_CALLS - 1, working)
    expect(notes.every(n => n === null)).toBe(true)
  })

  it('nudges once the list has gone stale for the whole window', () => {
    const detector = todoNudgeDetector()
    observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, working)
    const note = detector.observe('read', working)
    expect(note).toContain('<system-reminder>')
    expect(note).toContain('[meow]')
    expect(note).toContain('write the fix')
    expect(note).toContain('todowrite')
  })

  it('names the in_progress item over a pending one', () => {
    const detector = todoNudgeDetector()
    observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, working)
    const note = detector.observe('read', working)
    expect(note).toContain('write the fix')
    expect(note).not.toContain('run the tests')
  })

  it('falls back to the first pending item when nothing is in progress', () => {
    const todos: TodoItem[] = [
      { content: 'first', status: 'completed' },
      { content: 'second', status: 'pending' }
    ]
    const detector = todoNudgeDetector()
    observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, todos)
    expect(detector.observe('read', todos)).toContain('second')
  })

  it('restarts the window after a todowrite', () => {
    const detector = todoNudgeDetector()
    observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, working)
    expect(detector.observe('todowrite', working)).toBeNull()
    expect(observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, working).every(n => n === null)).toBe(true)
    expect(detector.observe('read', working)).toContain('write the fix')
  })

  it('never nudges a finished or empty list', () => {
    const done: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'cancelled' }
    ]
    const detector = todoNudgeDetector()
    expect(observeCalls(detector, TODO_NUDGE_AFTER_CALLS * 3, done).every(n => n === null)).toBe(true)
    expect(observeCalls(detector, TODO_NUDGE_AFTER_CALLS * 3, []).every(n => n === null)).toBe(true)
  })

  it('caps the notes per run and spaces them a window apart', () => {
    const detector = todoNudgeDetector()
    const notes = observeCalls(detector, TODO_NUDGE_AFTER_CALLS * (MAX_TODO_NUDGES + 2), working)
    const fired = notes.filter((n): n is string => n !== null)
    expect(fired).toHaveLength(MAX_TODO_NUDGES)
    expect(fired[1]).toContain(`reminder 2 of ${MAX_TODO_NUDGES}`)
    expect(notes.indexOf(fired[1]!)).toBe(TODO_NUDGE_AFTER_CALLS * 2 - 1)
  })

  it('flattens and truncates a long item', () => {
    const todos: TodoItem[] = [{ content: `line one\n${'x'.repeat(200)}`, status: 'in_progress' }]
    const detector = todoNudgeDetector()
    observeCalls(detector, TODO_NUDGE_AFTER_CALLS - 1, todos)
    const note = detector.observe('read', todos)!
    expect(note).toContain('line one x')
    expect(note).not.toContain('\nline one')
    expect(note.length).toBeLessThan(600)
  })
})

describe('todoEndOfTurnNote', () => {
  it('lists only the open items with their status', () => {
    const note = todoEndOfTurnNote(working)!
    expect(note).toContain('<system-reminder>')
    expect(note).toContain('2 open item(s)')
    expect(note).toContain('- [in_progress] write the fix')
    expect(note).toContain('- [pending] run the tests')
    expect(note).not.toContain('read the code')
    expect(note).toContain('todowrite')
  })

  it('is null for an empty or finished list', () => {
    expect(todoEndOfTurnNote([])).toBeNull()
    expect(todoEndOfTurnNote([{ content: 'a', status: 'completed' }, { content: 'b', status: 'cancelled' }])).toBeNull()
  })

  it('caps a long list', () => {
    const todos: TodoItem[] = Array.from({ length: 12 }, (_, i) => ({ content: `step ${i}`, status: 'pending' }))
    const note = todoEndOfTurnNote(todos)!
    expect(note).toContain('step 7')
    expect(note).not.toContain('step 8')
    expect(note).toContain('and 4 more')
    expect(openTodos(todos)).toHaveLength(12)
  })
})
