import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../src/main/json-store'
import { WorkspaceStore } from '../../src/main/workspace-store'

let file: string
let store: WorkspaceStore

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-ws-'))
  file = path.join(dir, 'workspaces.json')
  store = new WorkspaceStore(createJsonStore(file))
})

afterEach(() => rmSync(path.dirname(file), { recursive: true, force: true }))

describe('WorkspaceStore', () => {
  it('lists empty by default', () => {
    expect(store.list()).toEqual([])
  })

  it('adds a workspace without duplicating', () => {
    store.add('/proj/a', 'Project A')
    store.add('/proj/a', 'Project A again')
    expect(store.list()).toHaveLength(1)
    expect(store.get('/proj/a')?.name).toBe('Project A')
  })

  it('lists session id+name metas per project in newest-first order', () => {
    store.add('/proj/a', 'Project A')
    store.addAgent('/proj/a', { name: 'Session 1', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    store.addAgent('/proj/a', { name: 'Session 2', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const list = store.list()
    expect(list[0].sessions).toHaveLength(2)
    expect(list[0].sessions[0].name).toBe('Session 2')
    expect(list[0].sessions[1].name).toBe('Session 1')
  })

  it('adds an agent and keeps its config', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    expect(ws.agents).toHaveLength(1)
    expect(ws.agents[0].id).toBeTruthy()
    expect(ws.agents[0].templateId).toBe('opencode')
  })

  it('removes an agent by id', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'op', templateId: 'opencode', cwd: '/proj/a' })
    const agentId = ws.agents[0].id
    const after = store.removeAgent('/proj/a', agentId)
    expect(after.agents).toHaveLength(0)
  })

  it('throws when adding an agent to an unknown workspace', () => {
    expect(() => store.addAgent('/nope', { name: 'x', templateId: 't', cwd: '/nope' }))
      .toThrow('Workspace not found')
  })

  it('removes a workspace', () => {
    store.add('/proj/a', 'Project A')
    store.remove('/proj/a')
    expect(store.list()).toHaveLength(0)
  })

  it('updates an agent mode', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'meow', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const agentId = ws.agents[0].id
    store.updateAgent('/proj/a', agentId, { mode: 'plan' })
    expect(store.get('/proj/a')?.agents[0].mode).toBe('plan')
  })

  it('nests delegated sub-sessions directly under their parent', () => {
    store.add('/proj/a', 'Project A')
    const first = store.addAgent('/proj/a', { name: 'Session 1', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const parentId = first.agents[0].id
    store.addAgent('/proj/a', {
      name: 'Child 1', templateId: 'meow', cwd: '/proj/a', kind: 'native', parentAgentId: parentId
    })
    store.addAgent('/proj/a', { name: 'Session 2', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const sessions = store.list()[0].sessions
    expect(sessions.map(s => s.name)).toEqual(['Session 2', 'Session 1', 'Child 1'])
    expect(sessions[2].parentAgentId).toBe(parentId)
    expect(sessions[0].parentAgentId).toBeUndefined()
  })

  it('shows an orphaned sub-session as a root row', () => {
    store.add('/proj/a', 'Project A')
    store.addAgent('/proj/a', {
      name: 'Orphan', templateId: 'meow', cwd: '/proj/a', kind: 'native', parentAgentId: 'gone'
    })
    const sessions = store.list()[0].sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].parentAgentId).toBeUndefined()
  })

  it('lists descendants of a session recursively', () => {
    store.add('/proj/a', 'Project A')
    const ws = store.addAgent('/proj/a', { name: 'Root', templateId: 'meow', cwd: '/proj/a', kind: 'native' })
    const rootId = ws.agents[0].id
    const childWs = store.addAgent('/proj/a', {
      name: 'Child', templateId: 'meow', cwd: '/proj/a', kind: 'native', parentAgentId: rootId
    })
    const childId = childWs.agents[1].id
    store.addAgent('/proj/a', {
      name: 'Grandchild', templateId: 'meow', cwd: '/proj/a', kind: 'native', parentAgentId: childId
    })
    expect(store.descendantIds('/proj/a', rootId)).toHaveLength(2)
    expect(store.descendantIds('/proj/a', childId)).toHaveLength(1)
    expect(store.descendantIds('/proj/a', 'missing')).toEqual([])
  })

  it('reorders workspaces by path order', () => {
    store.add('/proj/a', 'Project A')
    store.add('/proj/b', 'Project B')
    store.add('/proj/c', 'Project C')
    const reordered = store.reorder(['/proj/c', '/proj/a', '/proj/b'])
    expect(reordered.map(w => w.projectPath)).toEqual(['/proj/c', '/proj/a', '/proj/b'])
    expect(store.list().map(w => w.projectPath)).toEqual(['/proj/c', '/proj/a', '/proj/b'])
  })
})
