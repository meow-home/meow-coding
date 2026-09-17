import { describe, expect, it } from 'vitest'
import { computePeerTargets } from '../../src/main/peer-roster'
import type { Workspace } from '../../src/shared/types'

function ws(over: Partial<Workspace>) {
  return { id: 'w', name: 'W', path: '/p', agents: [], sessions: [], ...over } as Workspace
}

describe('computePeerTargets', () => {
  it('lists same-project agents excluding the requester', () => {
    const w = ws({
      agents: [
        { id: 'alpha', name: 'Alpha', cwd: '/p', sessionId: 'a1', kind: 'code', mode: 'normal', templateId: 'meow' },
        { id: 'beta', name: 'Beta', cwd: '/p', sessionId: 'b1', kind: 'code', mode: 'normal', templateId: 'meow' },
        { id: 'gamma', name: 'Gamma', cwd: '/q', sessionId: 'g1', kind: 'code', mode: 'normal', templateId: 'meow' }
      ],
      sessions: [
        { id: 'a1', title: 'T', createdAt: 1, updatedAt: 2 },
        { id: 'b1', title: 'T', createdAt: 1, updatedAt: 2 }
      ]
    } as unknown as Partial<Workspace> & { agents: Workspace['agents']; sessions: Workspace['sessions'] })
    const result = computePeerTargets([w], 'alpha', '/p')
    expect(result.map(r => r.agentId)).toEqual(['beta'])
  })

  it('returns empty when no requesting identity', () => {
    expect(computePeerTargets([], undefined, '/p')).toEqual([])
    expect(computePeerTargets([], 'alpha', undefined)).toEqual([])
  })
})
