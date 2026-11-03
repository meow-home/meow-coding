import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalStore } from '../../src/main/terminal-store'
import type { TerminalInfo } from '../../src/shared/types'

describe('TerminalStore', () => {
  let tmpDir: string
  let store: TerminalStore
  let logger: { warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'meow-terminal-store-test-'))
    logger = { warn: vi.fn() }
    store = new TerminalStore(tmpDir, logger)
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('returns empty result when agent folder does not exist', () => {
    const res = store.load('agent-1')
    expect(res).toEqual({ info: [], logs: {} })
  })

  it('saves and loads terminals and logs round-trip', () => {
    const info: TerminalInfo[] = [
      {
        id: 'term_1',
        agentId: 'agent-1',
        title: 'bash',
        cwd: 'C:/proj',
        status: 'running',
        createdAt: 1000
      },
      {
        id: 'term_2',
        agentId: 'agent-1',
        title: 'pwsh',
        userTitle: 'Build Server',
        cwd: 'C:/proj/sub',
        status: 'exited',
        exitCode: 0,
        createdAt: 2000
      }
    ]
    const logs = {
      term_1: 'hello world\n',
      term_2: 'build complete\n'
    }

    store.save('agent-1', info, logs)

    const loaded = store.load('agent-1')
    expect(loaded.info).toEqual(info)
    expect(loaded.logs).toEqual(logs)
  })

  it('handles missing log file for an entry gracefully as empty string', () => {
    const info: TerminalInfo[] = [
      {
        id: 'term_1',
        agentId: 'agent-1',
        title: 'bash',
        cwd: 'C:/proj',
        status: 'running',
        createdAt: 1000
      }
    ]
    store.save('agent-1', info, {})
    const loaded = store.load('agent-1')
    expect(loaded.info).toEqual(info)
    expect(loaded.logs).toEqual({ term_1: '' })
  })

  it('removes stale log files on save', () => {
    const info1: TerminalInfo[] = [
      { id: 'term_1', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 1000 },
      { id: 'term_2', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 2000 }
    ]
    store.save('agent-1', info1, { term_1: 'log1', term_2: 'log2' })

    const term1Log = path.join(tmpDir, 'agent-1', 'term_1.log')
    const term2Log = path.join(tmpDir, 'agent-1', 'term_2.log')
    expect(existsSync(term1Log)).toBe(true)
    expect(existsSync(term2Log)).toBe(true)

    // Save with only term_1
    const info2: TerminalInfo[] = [info1[0]]
    store.save('agent-1', info2, { term_1: 'log1 updated' })

    expect(existsSync(term1Log)).toBe(true)
    expect(existsSync(term2Log)).toBe(false)
    expect(readFileSync(term1Log, 'utf-8')).toBe('log1 updated')
  })

  it('tolerates corrupt JSON in index.json and warns', () => {
    const agentDir = path.join(tmpDir, 'agent-1')
    store.save('agent-1', [
      { id: 'term_1', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 1000 }
    ], { term_1: 'data' })

    // Overwrite index.json with invalid JSON
    writeFileSync(path.join(agentDir, 'index.json'), '{ invalid json')

    const res = store.load('agent-1')
    expect(res).toEqual({ info: [], logs: {} })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('tolerates non-array JSON in index.json and warns', () => {
    const agentDir = path.join(tmpDir, 'agent-1')
    store.save('agent-1', [
      { id: 'term_1', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 1000 }
    ], { term_1: 'data' })

    // Overwrite index.json with a JSON object instead of array
    writeFileSync(path.join(agentDir, 'index.json'), JSON.stringify({ not: 'an array' }))

    const res = store.load('agent-1')
    expect(res).toEqual({ info: [], logs: {} })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('empty save removes the agent directory', () => {
    store.save('agent-1', [
      { id: 'term_1', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 1000 }
    ], { term_1: 'data' })

    const agentDir = path.join(tmpDir, 'agent-1')
    expect(existsSync(agentDir)).toBe(true)

    store.save('agent-1', [], {})
    expect(existsSync(agentDir)).toBe(false)
  })

  it('removeSession deletes the agent directory', () => {
    store.save('agent-1', [
      { id: 'term_1', agentId: 'agent-1', title: 'bash', cwd: 'C:/proj', status: 'running', createdAt: 1000 }
    ], { term_1: 'data' })

    const agentDir = path.join(tmpDir, 'agent-1')
    expect(existsSync(agentDir)).toBe(true)

    store.removeSession('agent-1')
    expect(existsSync(agentDir)).toBe(false)
  })
})
