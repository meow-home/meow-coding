import { describe, expect, it } from 'vitest'
import { MAX_TOOL_CONCURRENCY, runWithConcurrency, scheduleBatches } from '../../src/main/agent/tool-scheduler'

describe('scheduleBatches', () => {
  const safe = (s: string) => s.startsWith('r')

  it('groups consecutive parallel-safe items and isolates the rest, in order', () => {
    expect(scheduleBatches(['r1', 'r2', 'e1', 'r3', 'e2', 'e3', 'r4', 'r5'], safe))
      .toEqual([['r1', 'r2'], ['e1'], ['r3'], ['e2'], ['e3'], ['r4', 'r5']])
  })

  it('returns no batches for no items', () => {
    expect(scheduleBatches([], safe)).toEqual([])
  })
})

describe('runWithConcurrency', () => {
  it('never runs more than the limit at once and runs every task', async () => {
    expect(MAX_TOOL_CONCURRENCY).toBe(10)
    let active = 0
    let peak = 0
    let done = 0
    const tasks = Array.from({ length: 25 }, () => async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      done++
    })
    await runWithConcurrency(tasks, 10)
    expect(peak).toBe(10)
    expect(done).toBe(25)
  })

  it('resolves immediately for no tasks', async () => {
    await expect(runWithConcurrency([])).resolves.toBeUndefined()
  })
})
