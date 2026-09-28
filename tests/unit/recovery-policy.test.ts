import { describe, expect, it } from 'vitest'
import { RECOVERY_RESET_STEPS, recoveryPolicy } from '../../src/main/agent/recovery-policy'

describe('recoveryPolicy', () => {
  it('escalates one level per hit and caps at the pause level', () => {
    const p = recoveryPolicy()
    expect([p.onHit('repetition'), p.onHit('tool-loop'), p.onHit('repetition'), p.onHit('repetition'), p.onHit('repetition')])
      .toEqual([1, 2, 3, 4, 4])
  })

  it('returns to level 1 after enough consecutive clean steps', () => {
    const p = recoveryPolicy()
    p.onHit('repetition')
    p.onHit('repetition')
    for (let i = 0; i < RECOVERY_RESET_STEPS; i++) p.onCleanStep()
    expect(p.onHit('repetition')).toBe(1)
  })

  it('does not reset when clean steps are interrupted by a hit', () => {
    const p = recoveryPolicy()
    p.onHit('tool-loop')
    p.onCleanStep()
    p.onCleanStep()
    expect(p.onHit('tool-loop')).toBe(2)
    p.onCleanStep()
    p.onCleanStep()
    expect(p.onHit('tool-loop')).toBe(3)
  })

  it('reset() starts the ladder over', () => {
    const p = recoveryPolicy()
    p.onHit('repetition')
    p.onHit('repetition')
    p.onHit('repetition')
    p.onHit('repetition')
    p.reset()
    expect(p.onHit('repetition')).toBe(1)
  })

  it('honors a custom reset window', () => {
    const p = recoveryPolicy({ resetAfterCleanSteps: 1 })
    p.onHit('repetition')
    p.onCleanStep()
    expect(p.onHit('repetition')).toBe(1)
  })
})
