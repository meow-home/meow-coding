/**
 * Recovery ladder for a degenerate model. Each hit (a looping stream or a
 * repeated tool call) climbs one level; enough clean steps in a row drop back
 * to the bottom, so stumbles far apart in a long turn never add up to a stop.
 */
export const RECOVERY_RESET_STEPS = 3
export const RECOVERY_AUTO_LEVELS = 3

export type RecoveryHit = 'repetition' | 'tool-loop'
/** 1–3 are automatic recoveries; 4 pauses and asks the user. */
export type RecoveryLevel = 1 | 2 | 3 | 4

export interface RecoveryPolicy {
  onHit(hit: RecoveryHit): RecoveryLevel
  onCleanStep(): void
  reset(): void
}

export function recoveryPolicy(opts?: { resetAfterCleanSteps?: number }): RecoveryPolicy {
  const resetAfter = opts?.resetAfterCleanSteps ?? RECOVERY_RESET_STEPS
  let level = 0
  let clean = 0
  return {
    onHit(): RecoveryLevel {
      clean = 0
      level = Math.min(level + 1, RECOVERY_AUTO_LEVELS + 1)
      return level as RecoveryLevel
    },
    onCleanStep(): void {
      if (level === 0) return
      clean++
      if (clean >= resetAfter) {
        level = 0
        clean = 0
      }
    },
    reset(): void {
      level = 0
      clean = 0
    }
  }
}
