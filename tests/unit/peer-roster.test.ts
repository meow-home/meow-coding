import { describe, expect, it } from 'vitest'
import { computePeerTargets } from '../../src/main/peer-roster'
import type { Workspace } from '../../src/shared/types'

function ws(agents: Workspace['agents'] = []): Workspace {
  return { projectPath: '/p', name: 'W', agents }
}

describe('computePeerTargets', () => {
  const alpha = { id: 'alpha', name: 'Alpha', templateId: 'meow', cwd: '/p', kind: 'native' as const }
  const beta = { id: 'beta', name: 'Beta', templateId: 'meow', cwd: '/p', kind: 'native' as const }
  const gamma = { id: 'gamma', name: 'Gamma', templateId: 'meow', cwd: '/q', kind: 'native' as const }

  const lookup = {
    requestingAgentId: 'alpha',
    requestingProjectPath: '/p',
    modeOf: (id: string) => (id === 'beta' ? 'plan' as const : 'build' as const),
    stateOf: (id: string) => (id === 'beta' ? 'running' as const : 'idle' as const)
  }

  it('lists same-project agents excluding the requester', () => {
    const result = computePeerTargets([ws([alpha, beta, gamma])], lookup)
    expect(result.map(r => r.agentId)).toEqual(['beta'])
    expect(result[0]).toEqual({ agentId: 'beta', name: 'Beta', mode: 'plan', state: 'running' })
  })

  it('returns empty when no requesting identity', () => {
    expect(computePeerTargets([], { requestingProjectPath: '/p' })).toEqual([])
    expect(computePeerTargets([], { requestingAgentId: 'alpha' })).toEqual([])
  })
})
