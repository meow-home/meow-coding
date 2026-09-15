import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrateSessions } from '../../src/main/agent/session-migrate'
import { SessionFileStore } from '../../src/main/agent/session-file-store'

describe('migrateSessions', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'meow-mig-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function seedLegacy() {
    writeFileSync(path.join(root, 'sessions.json'), JSON.stringify([
      { id: 's1', agentId: 'a1', projectPath: '/p', title: 'One', items: [
        { kind: 'message', message: { id: 'm', role: 'user', text: 'hi', createdAt: 1 } },
        { kind: 'tool', tool: { id: 't', tool: 'bash', input: {}, permission: 'allowed' } }
      ], todos: [], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 }, createdAt: 10, updatedAt: 20 },
      // legacy entry: no agentId (falls back to id), no title/createdAt
      { id: 'legacy1', projectPath: '/p', items: [
        { kind: 'message', message: { id: 'm2', role: 'user', text: 'Hello world', createdAt: 1 } }
      ], updatedAt: 100 }
    ]))
  }

  it('migrates every session to a per-project jsonl file and marks done', () => {
    seedLegacy()
    const res = migrateSessions(root)
    expect(res).toEqual({ migrated: 2, skipped: false })
    expect(existsSync(path.join(root, '.sessions-migrated-v1'))).toBe(true)
    expect(existsSync(path.join(root, 'sessions.json'))).toBe(false)
    expect(existsSync(path.join(root, 'sessions.json.migrated-bak'))).toBe(true)

    const store = new SessionFileStore(root)
    expect(store.list().map(e => e.id).sort()).toEqual(['legacy1', 's1'])
    expect(store.get('s1')?.items).toHaveLength(2)
    const legacy = store.get('legacy1')!
    expect(legacy.agentId).toBe('legacy1')     // fell back to id
    expect(legacy.title).toBe('Hello world')   // derived from first user message
    expect(legacy.createdAt).toBe(100)          // fell back to updatedAt
  })

  it('is idempotent: a second run is a no-op', () => {
    seedLegacy()
    migrateSessions(root)
    const res2 = migrateSessions(root)
    expect(res2).toEqual({ migrated: 0, skipped: true })
  })

  it('marks done on a fresh install with no legacy file', () => {
    const res = migrateSessions(root)
    expect(res).toEqual({ migrated: 0, skipped: false })
    expect(existsSync(path.join(root, '.sessions-migrated-v1'))).toBe(true)
  })
})
