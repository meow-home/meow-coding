import { describe, expect, it } from 'vitest'
import { isLastSession } from '../../src/renderer/src/session-guard'
import type { AgentConfig, WorkspaceRuntime, WorkspaceSummary } from '../../src/shared/types'

function session(id: string, cwd = '/p'): AgentConfig {
  return { id, name: id, templateId: 'meow', cwd, kind: 'native' }
}

function runtime(path: string, ids: string[]): WorkspaceRuntime {
  return {
    workspace: { projectPath: path, name: path, agents: ids.map(id => session(id, path)) },
    agents: [],
    git: null
  }
}

function summary(path: string, ids: string[]): WorkspaceSummary {
  return { projectPath: path, name: path, sessions: ids.map(id => ({ id, name: id })) }
}

describe('isLastSession', () => {
  // The guard's whole purpose: removing the only session must create its
  // replacement first, or the project is left at zero sessions.
  it('reports the only session of an open project as the last one', () => {
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1'])])).toBe(true)
  })

  it('does not report either session of a two-session open project as the last one', () => {
    const runtimes = { '/p': runtime('/p', ['s1', 's2']) }
    const workspaces = [summary('/p', ['s1', 's2'])]
    expect(isLastSession('/p', 's1', runtimes, workspaces)).toBe(false)
    expect(isLastSession('/p', 's2', runtimes, workspaces)).toBe(false)
  })

  // A project only has to be *listed* to be deletable from the sidebar, so the
  // never-opened case has no runtime and must fall back to the summary — the case
  // an earlier fix round had to catch.
  it('reports the only session of a never-opened project (summary only) as the last one', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', ['s1'])])).toBe(true)
  })

  it('does not report a session of a never-opened two-session project as the last one', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', ['s1', 's2'])])).toBe(false)
  })

  // An id no source knows is not the last session: creating a replacement while
  // deleting nothing would silently add a session.
  it('does not report an unknown session id as the last one', () => {
    expect(isLastSession('/p', 'gone', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1'])])).toBe(false)
  })

  it('does not report a session as the last one when the project has none at all', () => {
    expect(isLastSession('/p', 's1', {}, [summary('/p', [])])).toBe(false)
    expect(isLastSession('/p', 's1', {}, [])).toBe(false)
  })

  // The runtime reflects removals immediately; the summary lags behind a refresh.
  // Trusting the summary here would create a second session for a project that
  // already has two.
  it('prefers the mounted runtime over the summary when both know the project', () => {
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1', 's2']) }, [summary('/p', ['s1'])])).toBe(false)
    expect(isLastSession('/p', 's1', { '/p': runtime('/p', ['s1']) }, [summary('/p', ['s1', 's2'])])).toBe(true)
  })
})
