// tests/unit/session-file-store.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync as read } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionFileStore } from '../../src/main/agent/session-file-store'
import { serializeSessionJsonl } from '../../src/main/agent/session-records'
import { encodeProjectPath } from '../../src/main/project-encode'
import type { StoredSession } from '../../src/main/agent/session'

function seed(root: string, s: StoredSession) {
  const dir = path.join(root, 'projects', encodeProjectPath(s.projectPath))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${s.id}.jsonl`), serializeSessionJsonl(s))
}
function session(id: string, agentId: string, projectPath = '/p'): StoredSession {
  return { id, agentId, projectPath, title: `T-${id}`, items: [
    { kind: 'message', message: { id: `${id}-m`, role: 'user', text: 'hi', createdAt: 1 } }
  ], todos: [], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 }, createdAt: 10, updatedAt: 20 }
}

describe('SessionFileStore reads', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-fs-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('rebuilds the index by scanning projects/ when no index file exists', () => {
    seed(root, session('s1', 'a1'))
    seed(root, session('s2', 'a2'))
    const store = new SessionFileStore(root)
    expect(store.list().map(e => e.id).sort()).toEqual(['s1', 's2'])
    const e1 = store.list().find(e => e.id === 's1')!
    expect(e1.agentId).toBe('a1')
    expect(e1.messageCount).toBe(1)
    expect(e1.usage.output).toBe(2)
  })

  it('reads and parses one session lazily by id', () => {
    seed(root, session('s1', 'a1'))
    const store = new SessionFileStore(root)
    const s = store.get('s1')
    expect(s?.items).toHaveLength(1)
    expect(s?.title).toBe('T-s1')
    expect(store.get('missing')).toBeNull()
  })
})

describe('SessionFileStore writes', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-fsw-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('create writes a meta line and indexes the session', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1')
    s.items = []
    store.create(s)
    expect(store.list().map(e => e.id)).toEqual(['s1'])
    const file = path.join(root, 'projects', encodeProjectPath('/p'), 's1.jsonl')
    const first = read(file, 'utf-8').split('\n')[0]
    expect(JSON.parse(first).type).toBe('meta')
  })

  it('append adds one line per record without rewriting earlier lines', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1'); s.items = []
    store.create(s)
    const file = path.join(root, 'projects', encodeProjectPath('/p'), 's1.jsonl')
    const before = read(file, 'utf-8')
    store.append('s1', [{ type: 'message', uuid: randomUUID(), parentUuid: null, ts: 5, message: { id: 'm1', role: 'user', text: 'hi', createdAt: 5 } }])
    const after = read(file, 'utf-8')
    expect(after.startsWith(before)).toBe(true)      // earlier bytes untouched
    expect(after.trimEnd().split('\n')).toHaveLength(before.trimEnd().split('\n').length + 1)
  })

  it('rewrite replaces the file and reindexes; remove deletes it', () => {
    const store = new SessionFileStore(root)
    const s = session('s1', 'a1')
    store.create(s)
    const s2 = { ...s, items: [], title: 'Empty' }
    store.rewrite(s2)
    store['cache'].delete('s1')                       // force re-read from disk
    expect(store.get('s1')?.items).toHaveLength(0)
    expect(store.list().find(e => e.id === 's1')?.title).toBe('Empty')
    store.remove('s1')
    expect(store.get('s1')).toBeNull()
    expect(store.list()).toEqual([])
  })
})
