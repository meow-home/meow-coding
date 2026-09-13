import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { SessionStore, DEFAULT_SESSION_TITLE, titleFrom } from '../../src/main/agent/session'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'

function makeStore(file: string) {
  return new SessionStore(createJsonStore(file))
}

function userMessage(text: string): ChatMessage {
  return { id: Math.random().toString(36).slice(2), role: 'user', text, createdAt: Date.now() }
}

describe('SessionStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-'))
    file = path.join(dir, 'sessions.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a session with a unique id and a default title', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/proj')
    const b = store.create('agent1', '/proj')
    expect(a.id).toBeTruthy()
    expect(b.id).not.toBe(a.id)
    expect(a.agentId).toBe('agent1')
    expect(a.title).toBe('New session')
    expect(store.get(a.id)?.projectPath).toBe('/proj')
  })

  it('lists sessions for an agent sorted by updatedAt desc', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    const c = store.create('agent2', '/p')
    store.touch(a.id)
    const list = store.list('agent1')
    expect(list.map(s => s.id)).toEqual([a.id, b.id])
    expect(list.every(s => s.agentId === 'agent1')).toBe(true)
    expect(list[0].messageCount).toBe(0)
    // other agent isolated
    expect(store.list('agent2').map(s => s.id)).toEqual([c.id])
  })

  it('auto-titles from the first user message and keeps later titles', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, userMessage('  Fix the\n  login bug now  '))
    expect(store.get(s.id)?.title).toBe('Fix the')
    // later user message does not overwrite
    store.appendMessage(s.id, userMessage('second message'))
    expect(store.get(s.id)?.title).toBe('Fix the')
  })

  it('truncates long titles to 60 chars', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    const long = 'x'.repeat(120)
    store.appendMessage(s.id, userMessage(long))
    expect(store.get(s.id)?.title).toHaveLength(60)
    expect(store.get(s.id)?.title.endsWith('…')).toBe(true)
  })

  it('tracks message count and updates updatedAt on append', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, userMessage('hi'))
    store.appendMessage(s.id, { ...userMessage('yo'), role: 'assistant' })
    expect(store.list('agent1')[0].messageCount).toBe(2)
  })

  it('returns latest session for an agent', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    store.touch(a.id)
    expect(store.latest('agent1')?.id).toBe(a.id)
    store.touch(b.id)
    expect(store.latest('agent1')?.id).toBe(b.id)
  })

  it('touch guarantees the touched session is strictly latest within the same millisecond', () => {
    const realNow = Date.now
    Date.now = () => 1000
    try {
      const store = makeStore(file)
      const a = store.create('agent1', '/p')
      const b = store.create('agent1', '/p')
      store.touch(a.id)
      expect(store.latest('agent1')?.id).toBe(a.id)
      store.touch(b.id)
      expect(store.latest('agent1')?.id).toBe(b.id)
    } finally {
      Date.now = realNow
    }
  })

  it('deletes a session and keeps others', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    store.delete(a.id)
    expect(store.get(a.id)).toBeNull()
    expect(store.list('agent1').map(s => s.id)).toEqual([b.id])
  })

  it('deletes all sessions for an agent and keeps others', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    const b = store.create('agent1', '/p')
    const c = store.create('agent2', '/p')
    store.deleteForAgent('agent1')
    expect(store.list('agent1')).toEqual([])
    expect(store.list('agent2').map(s => s.id)).toEqual([c.id])
    expect(store.get(a.id)).toBeNull()
    expect(store.get(b.id)).toBeNull()
  })

  it('gets and sets todos per session', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    expect(store.todos(a.id)).toEqual([])
    store.setTodos(a.id, [
      { content: 'fix login', status: 'in_progress' },
      { content: 'run tests', status: 'pending', priority: 'high' }
    ])
    expect(store.todos(a.id)).toHaveLength(2)
    expect(store.todos(a.id)[0]).toEqual({ content: 'fix login', status: 'in_progress' })
    expect(store.todos(a.id)[1]).toEqual({ content: 'run tests', status: 'pending', priority: 'high' })
    const other = store.create('agent1', '/p')
    expect(store.todos(other.id)).toEqual([])
  })

  it('replaces the transcript items for a session', () => {
    const store = makeStore(file)
    const a = store.create('agent1', '/p')
    store.appendMessage(a.id, userMessage('hi'))
    expect(store.transcript(a.id)).toHaveLength(1)
    store.replaceItems(a.id, [])
    expect(store.transcript(a.id)).toHaveLength(0)
    store.replaceItems(a.id, [
      { kind: 'message', message: userMessage('compacted') }
    ])
    expect(store.transcript(a.id)[0].kind).toBe('message')
  })

  it('migrates legacy entries (id = agentId, no title/createdAt)', () => {
    writeFileSync(file, JSON.stringify([
      { id: 'legacy1', projectPath: '/p', items: [
        { kind: 'message', message: { id: 'm', role: 'user', text: 'Hello world', createdAt: 1 } }
      ], updatedAt: 100 }
    ]))
    const store = makeStore(file)
    const s = store.get('legacy1')
    expect(s).not.toBeNull()
    expect(s?.agentId).toBe('legacy1')
    expect(s?.title).toBe('Hello world')
    expect(s?.createdAt).toBe(100)
    expect(store.list('legacy1')[0].messageCount).toBe(1)
  })
})

describe('SessionStore caching', () => {
  function countingStore() {
    let data: unknown[] = []
    const store = {
      loads: 0,
      saves: 0,
      load() { store.loads++; return data },
      save(items: unknown[]) { store.saves++; data = items }
    }
    return store
  }

  it('normalizes the backing data once instead of on every read', () => {
    const backing = countingStore()
    const store = new SessionStore(backing as never)
    const session = store.create('agent1', '/proj')
    const loadsAfterCreate = backing.loads

    for (let i = 0; i < 20; i++) store.appendMessage(session.id, userMessage(`m${i}`))
    store.transcript(session.id)
    store.transcript(session.id)

    expect(backing.loads).toBe(loadsAfterCreate)
    expect(store.transcript(session.id)).toHaveLength(20)
  })

  it('still persists every mutation through the backing store', () => {
    const backing = countingStore()
    const store = new SessionStore(backing as never)
    const session = store.create('agent1', '/proj')
    const savesAfterCreate = backing.saves
    store.appendMessage(session.id, userMessage('hello'))
    expect(backing.saves).toBe(savesAfterCreate + 1)
  })
})

describe('SessionStore flush', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-flush-'))
    file = path.join(dir, 'sessions.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists debounced writes to disk on demand', () => {
    const store = new SessionStore(createJsonStore(file, { debounceMs: 60_000 }))
    const session = store.create('agent1', '/proj')
    store.appendMessage(session.id, userMessage('hi'))

    store.flush()

    expect(new SessionStore(createJsonStore(file)).transcript(session.id)).toHaveLength(1)
  })
})

describe('transcriptWindow', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-sess-window-'))
    file = path.join(dir, 'sessions.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const msg = (id: string, role: 'user' | 'assistant' = 'user') =>
    ({ id, role, text: `msg-${id}`, createdAt: Date.now() })
  const tool = (id: string): ToolCallData =>
    ({ id, tool: 'bash', input: {}, permission: 'approved' })

  it('returns the last `limit` items in order with hasMore when older exist', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 12; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id, { limit: 5 })
    expect(w.hasMore).toBe(true)
    expect(w.items.map(it => it.message.id)).toEqual(['m7', 'm8', 'm9', 'm10', 'm11'])
  })

  it('defaults to a 50-item tail window', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 51; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id)
    expect(w.items).toHaveLength(50)
    expect(w.hasMore).toBe(true)
    expect(w.items[0]?.message.id).toBe('m1')
  })

  it('window ends at beforeId inclusive and flags hasMore only when older items exist', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 10; i++) store.appendMessage(s.id, msg(`m${i}`))
    const mid = store.transcriptWindow(s.id, { beforeId: 'm7', limit: 4 })
    expect(mid.items.map(it => it.message.id)).toEqual(['m4', 'm5', 'm6', 'm7'])
    expect(mid.hasMore).toBe(true)
    const head = store.transcriptWindow(s.id, { beforeId: 'm2', limit: 4 })
    expect(head.items.map(it => it.message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(head.hasMore).toBe(false)
    const tail = store.transcriptWindow(s.id, { beforeId: 'm9', limit: 4 })
    expect(tail.items.map(it => it.message.id)).toEqual(['m6', 'm7', 'm8', 'm9'])
    expect(tail.hasMore).toBe(true)
  })

  it('matches beforeId against tool items too', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    store.appendMessage(s.id, msg('m0'))
    store.appendTool(s.id, tool('t1'))
    store.appendMessage(s.id, msg('m2'))
    const w = store.transcriptWindow(s.id, { beforeId: 't1', limit: 2 })
    expect(w.items).toHaveLength(2)
    expect(w.items[1].kind === 'tool' && w.items[1].tool.id).toBe('t1')
    expect(w.hasMore).toBe(false)
  })

  it('unknown beforeId falls back to the tail window', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    for (let i = 0; i < 6; i++) store.appendMessage(s.id, msg(`m${i}`))
    const w = store.transcriptWindow(s.id, { beforeId: 'nope', limit: 3 })
    expect(w.items.map(it => it.message.id)).toEqual(['m3', 'm4', 'm5'])
    expect(w.hasMore).toBe(true)
  })

  it('shorter transcript returns everything with hasMore=false; empty returns empty', () => {
    const store = makeStore(file)
    const s = store.create('agent1', '/p')
    expect(store.transcriptWindow(s.id, { limit: 50 })).toEqual({ items: [], hasMore: false })
    store.appendMessage(s.id, msg('m0'))
    const w = store.transcriptWindow(s.id, { limit: 50 })
    expect(w.items).toHaveLength(1)
    expect(w.hasMore).toBe(false)
  })
})

describe('titleFrom', () => {
  it('derives session title from user text', () => {
    expect(titleFrom('Hello world')).toBe('Hello world')
  })

  it('strips base64 image data URLs and markdown images from title', () => {
    expect(titleFrom('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')).toBe(DEFAULT_SESSION_TITLE)
    expect(titleFrom('![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA) Fix this bug')).toBe('Fix this bug')
  })

  it('does not set title to base64 when appending user message with image only', () => {
    const store = makeStore(path.join(tmpdir(), `session-test-${Math.random().toString(36).slice(2)}.json`))
    const s = store.create('agent1', '/proj')
    expect(s.title).toBe(DEFAULT_SESSION_TITLE)

    store.appendMessage(s.id, {
      id: 'm1',
      role: 'user',
      text: '',
      displayText: '',
      images: [{ id: 'img1', name: 'test.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo', size: 100 }],
      createdAt: Date.now()
    })

    const updated = store.get(s.id)
    expect(updated?.title).toBe(DEFAULT_SESSION_TITLE)
  })
})
