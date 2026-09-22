import { describe, expect, it } from 'vitest'
import { serializeSessionJsonl, parseSessionJsonl } from '../../src/main/agent/session-records'
import type { StoredSession } from '../../src/main/agent/session'

function sample(): StoredSession {
  return {
    id: 's1', agentId: 'a1', projectPath: '/proj', title: 'Fix bug',
    items: [
      { kind: 'message', message: { id: 'm0', role: 'user', text: 'hi', createdAt: 1 } },
      { kind: 'tool', tool: { id: 't1', tool: 'bash', input: { cmd: 'ls' }, permission: 'allowed' } },
      { kind: 'message', message: { id: 'm2', role: 'assistant', text: 'done', createdAt: 3 } }
    ],
    todos: [{ content: 'run tests', status: 'pending' }],
    usage: { input: 10, output: 20, cacheRead: 1, cacheWrite: 2, cost: 0.5 },
    createdAt: 100, updatedAt: 300
  }
}

describe('session-records round trip', () => {
  it('serialize -> parse preserves items, title, todos, usage, createdAt', () => {
    const s = sample()
    const back = parseSessionJsonl(serializeSessionJsonl(s))
    expect(back).not.toBeNull()
    expect(back!.id).toBe('s1')
    expect(back!.agentId).toBe('a1')
    expect(back!.projectPath).toBe('/proj')
    expect(back!.title).toBe('Fix bug')
    expect(back!.items).toEqual(s.items)
    expect(back!.todos).toEqual(s.todos)
    expect(back!.usage).toEqual(s.usage)
    expect(back!.createdAt).toBe(100)
  })

  it('latest title/todos/usage records win', () => {
    const s = sample()
    let text = serializeSessionJsonl(s)
    text += JSON.stringify({ type: 'title', ts: 400, title: 'Renamed' }) + '\n'
    text += JSON.stringify({ type: 'usage', ts: 401, usage: { input: 99, output: 0, cacheRead: 0, cacheWrite: 0, cost: 1 } }) + '\n'
    const back = parseSessionJsonl(text)!
    expect(back.title).toBe('Renamed')
    expect(back.usage.input).toBe(99)
  })

  it('skips a corrupt trailing line (crash mid-append)', () => {
    const s = sample()
    const text = serializeSessionJsonl(s) + '{"type":"message","uuid":"x",'  // truncated
    const back = parseSessionJsonl(text)
    expect(back).not.toBeNull()
    expect(back!.items).toHaveLength(3)
  })

  it('coerces a corrupt todos record (string) to an empty array', () => {
    // Latest record wins; a string value (the model emitting a JSON-encoded
    // array) used to crash the renderer's todos.filter on load.
    const s = sample()
    let text = serializeSessionJsonl(s)
    text += JSON.stringify({ type: 'todos', ts: 999, todos: '[]' }) + '\n'
    const back = parseSessionJsonl(text)!
    expect(back.todos).toEqual([])
  })

  it('coerces a corrupt todos record (object) to an empty array', () => {
    const s = sample()
    let text = serializeSessionJsonl(s)
    text += JSON.stringify({ type: 'todos', ts: 999, todos: { content: 'x' } }) + '\n'
    const back = parseSessionJsonl(text)!
    expect(back.todos).toEqual([])
  })

  it('returns null when there is no meta record', () => {
    expect(parseSessionJsonl('{"type":"title","ts":1,"title":"x"}\n')).toBeNull()
  })
})
