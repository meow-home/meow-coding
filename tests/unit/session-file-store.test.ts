// tests/unit/session-file-store.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
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
