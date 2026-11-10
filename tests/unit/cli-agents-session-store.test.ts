import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CliSessionMeta, CliTranscriptItem } from '../../src/shared/types'
import {
  assertValidSessionId,
  CliSessionStore,
  TRANSCRIPT_MAX_BYTES,
  TRANSCRIPT_TRUNCATE_BYTES
} from '../../src/main/cli-agents/session-store'

describe('CliSessionStore', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'meow-cli-session-test-'))
  })

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('validates session ids and rejects invalid characters or path traversal', () => {
    expect(() => assertValidSessionId('valid_id-123')).not.toThrow()
    expect(() => assertValidSessionId('clis_abc123')).not.toThrow()

    expect(() => assertValidSessionId('../traversal')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('..')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('folder/id')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('folder\\id')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('id with spaces')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('id$special')).toThrow(/Invalid session id/)
    expect(() => assertValidSessionId('')).toThrow(/Invalid session id/)
  })

  it('performs CRUD operations on sessions and filters by projectPath', () => {
    const store = new CliSessionStore(tmpDir)

    expect(store.list()).toEqual([])
    expect(store.get('session-1')).toBeNull()

    const now = 1000
    const meta1: CliSessionMeta = {
      id: 'session-1',
      agentId: 'agy_test',
      projectPath: '/projects/repo-a',
      cwd: '/projects/repo-a',
      title: 'New session',
      status: 'idle',
      createdAt: now,
      updatedAt: now
    }

    const meta2: CliSessionMeta = {
      id: 'session-2',
      agentId: 'oc_test',
      projectPath: '/projects/repo-b',
      cwd: '/projects/repo-b',
      title: 'Other session',
      status: 'idle',
      createdAt: now + 10,
      updatedAt: now + 10
    }

    const created1 = store.create(meta1)
    expect(created1).toEqual(meta1)
    store.create(meta2)

    // Duplicate create throws
    expect(() => store.create(meta1)).toThrow(/already exists/)

    expect(store.list()).toHaveLength(2)
    expect(store.list('/projects/repo-a')).toEqual([meta1])
    expect(store.list('/projects/repo-b')).toEqual([meta2])
    expect(store.list('/projects/repo-c')).toEqual([])

    expect(store.get('session-1')).toEqual(meta1)

    // Rename
    const renamed = store.rename('session-1', 'Updated Title')
    expect(renamed.title).toBe('Updated Title')
    expect(store.get('session-1')?.title).toBe('Updated Title')

    // Set status
    const statusUpdated = store.setStatus('session-1', 'running')
    expect(statusUpdated.status).toBe('running')
    expect(store.get('session-1')?.status).toBe('running')

    // Append a transcript item
    store.appendItem('session-1', { kind: 'user', text: 'Hello', at: now })
    const transcriptPath = store.getTranscriptPath('session-1')
    expect(existsSync(transcriptPath)).toBe(true)

    // Delete session
    expect(store.delete('session-1')).toBe(true)
    expect(store.get('session-1')).toBeNull()
    expect(store.list()).toEqual([meta2])
    expect(existsSync(transcriptPath)).toBe(false)

    // Deleting non-existent returns false
    expect(store.delete('session-1')).toBe(false)
  })

  it('persists sessions and transcripts across store instances', () => {
    const store1 = new CliSessionStore(tmpDir)
    store1.create({
      id: 's_persisted',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Initial Title',
      status: 'idle',
      createdAt: 100,
      updatedAt: 100
    })
    store1.appendItem('s_persisted', { kind: 'user', text: 'Persistent question', at: 101 })

    // Second instance loading same directory
    const store2 = new CliSessionStore(tmpDir)
    const session = store2.get('s_persisted')
    expect(session).not.toBeNull()
    expect(session?.title).toBe('Initial Title')

    const transcript = store2.readTranscript('s_persisted')
    expect(transcript).toEqual([{ kind: 'user', text: 'Persistent question', at: 101 }])
  })

  it('supports explicit index path in constructor', () => {
    const indexPath = path.join(tmpDir, 'custom-index.json')
    const store = new CliSessionStore(indexPath)
    expect(store.getIndexPath()).toBe(indexPath)
    expect(store.getTranscriptsDir()).toBe(path.join(tmpDir, 'cli-sessions'))

    store.create({
      id: 'sess-custom',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Custom',
      status: 'idle',
      createdAt: 200,
      updatedAt: 200
    })
    expect(existsSync(indexPath)).toBe(true)
  })

  it('appends and reads transcript items with limits', () => {
    const store = new CliSessionStore(tmpDir)
    expect(store.readTranscript('s_empty')).toEqual([])

    store.create({
      id: 's_transcript',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Test',
      status: 'idle',
      createdAt: 10,
      updatedAt: 10
    })

    const items: CliTranscriptItem[] = [
      { kind: 'user', text: 'hi', at: 1 },
      { kind: 'assistant', text: 'hello', at: 2 },
      { kind: 'tool', tool: 'bash', input: { command: 'ls' }, at: 3 },
      { kind: 'notice', level: 'info', text: 'done', at: 4 }
    ]

    for (const item of items) {
      store.appendItem('s_transcript', item)
    }

    const all = store.readTranscript('s_transcript')
    expect(all).toEqual(items)

    const limited = store.readTranscript('s_transcript', 2)
    expect(limited).toEqual([items[2], items[3]])

    const single = store.readTranscript('s_transcript', 1)
    expect(single).toEqual([items[3]])
  })

  it('rotates and caps transcript when exceeding size limit', () => {
    // Test cap rotation with small thresholds: max 600 bytes, truncate to last 200 bytes
    const store = new CliSessionStore(tmpDir, {
      maxTranscriptBytes: 600,
      truncateTranscriptBytes: 200
    })

    const sessionId = 's_cap'
    store.create({
      id: sessionId,
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Cap test',
      status: 'idle',
      createdAt: 10,
      updatedAt: 10
    })

    // Append items until exceeding 600 bytes
    for (let i = 0; i < 15; i++) {
      store.appendItem(sessionId, {
        kind: 'assistant',
        text: `Repeated item payload index ${i} with extra padding string to fill up buffer quickly`,
        at: i
      })
    }

    const transcript = store.readTranscript(sessionId)
    expect(transcript.length).toBeGreaterThan(0)

    // Notice item must be present
    const notice = transcript.find(it => it.kind === 'notice' && it.text.includes('truncated'))
    expect(notice).toBeDefined()

    // File size must remain under maxTranscriptBytes
    const transcriptPath = store.getTranscriptPath(sessionId)
    const content = readFileSync(transcriptPath, 'utf8')
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(600)
  })

  it('rejects invalid session ids on all operations', () => {
    const store = new CliSessionStore(tmpDir)
    const invalid = '../bad_id'

    expect(() => store.get(invalid)).toThrow(/Invalid session id/)
    expect(() => store.rename(invalid, 'title')).toThrow(/Invalid session id/)
    expect(() => store.setStatus(invalid, 'idle')).toThrow(/Invalid session id/)
    expect(() => store.delete(invalid)).toThrow(/Invalid session id/)
    expect(() => store.appendItem(invalid, { kind: 'user', text: 'x', at: 1 })).toThrow(/Invalid session id/)
    expect(() => store.readTranscript(invalid)).toThrow(/Invalid session id/)
    expect(() => store.getTranscriptPath(invalid)).toThrow(/Invalid session id/)
  })

  it('prunes old sessions while preserving running sessions and recent sessions', () => {
    const fixedNow = 100_000_000
    const store = new CliSessionStore(tmpDir, { now: () => fixedNow })

    const oneDayMs = 24 * 60 * 60 * 1000
    const fortyDaysAgo = fixedNow - 40 * oneDayMs
    const tenDaysAgo = fixedNow - 10 * oneDayMs

    // s1: 40 days old, idle -> should be pruned
    store.create({
      id: 's_old_idle',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Old Idle',
      status: 'idle',
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    })
    store.appendItem('s_old_idle', { kind: 'user', text: 'old', at: fortyDaysAgo })

    // s2: 10 days old, idle -> should be kept
    store.create({
      id: 's_recent_idle',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Recent Idle',
      status: 'idle',
      createdAt: tenDaysAgo,
      updatedAt: tenDaysAgo
    })
    store.appendItem('s_recent_idle', { kind: 'user', text: 'recent', at: tenDaysAgo })

    // s3: 40 days old, running -> should be kept because status is running
    store.create({
      id: 's_old_running',
      agentId: 'agy_1',
      projectPath: '/proj',
      cwd: '/proj',
      title: 'Old Running',
      status: 'running',
      createdAt: fortyDaysAgo,
      updatedAt: fortyDaysAgo
    })
    store.appendItem('s_old_running', { kind: 'user', text: 'running', at: fortyDaysAgo })

    expect(store.list()).toHaveLength(3)

    const prunedCount = store.prune(30)
    expect(prunedCount).toBe(1)

    const remaining = store.list().map(s => s.id)
    expect(remaining).toEqual(['s_recent_idle', 's_old_running'])

    // Old idle transcript must be deleted
    expect(existsSync(store.getTranscriptPath('s_old_idle'))).toBe(false)
    // Kept transcripts must remain
    expect(existsSync(store.getTranscriptPath('s_recent_idle'))).toBe(true)
    expect(existsSync(store.getTranscriptPath('s_old_running'))).toBe(true)
  })
})
