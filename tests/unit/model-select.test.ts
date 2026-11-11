import { describe, expect, it } from 'vitest'
import { formatModelCandidates, resolveModelQuery } from '../../src/main/model-select'
import type { ModelRef } from '../../src/shared/types'

const MODELS: ModelRef[] = [
  { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  { provider: 'anthropic', model: 'claude-opus-4-1' },
  { provider: 'openai', model: 'gpt-5' },
  { provider: 'codex', model: 'gpt-5.3-codex', accountId: 'acct-1', accountLabel: 'Work' }
]

describe('resolveModelQuery', () => {
  it('matches an exact provider/model ref', () => {
    expect(resolveModelQuery('anthropic/claude-sonnet-4-5', MODELS).match).toEqual(MODELS[0])
  })

  it('matches an exact model id across providers', () => {
    expect(resolveModelQuery('gpt-5', MODELS).match).toEqual({ provider: 'openai', model: 'gpt-5' })
  })

  it('matches a fuzzy model name', () => {
    expect(resolveModelQuery('opus', MODELS).match?.model).toBe('claude-opus-4-1')
  })

  it('matches multiple words in any order', () => {
    expect(resolveModelQuery('sonnet claude', MODELS).match?.model).toBe('claude-sonnet-4-5')
  })

  it('matches an account-scoped codex model through its account label', () => {
    expect(resolveModelQuery('codex work', MODELS).match?.accountId).toBe('acct-1')
  })

  it('returns candidates instead of guessing when two models tie', () => {
    const refs: ModelRef[] = [
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { provider: 'anthropic', model: 'claude-sonnet-3-7' }
    ]
    const result = resolveModelQuery('claude sonnet', refs)
    expect(result.match).toBeUndefined()
    expect(result.candidates.map(c => c.model).sort()).toEqual(['claude-sonnet-3-7', 'claude-sonnet-4-5'])
  })

  it('prefers the more specific match when scores differ', () => {
    const refs: ModelRef[] = [
      { provider: 'openai', model: 'gpt-5' },
      { provider: 'openai', model: 'gpt-5-mini' }
    ]
    expect(resolveModelQuery('gpt-5', refs).match?.model).toBe('gpt-5')
  })

  it('returns no match for an unknown model', () => {
    const result = resolveModelQuery('gemini-9', MODELS)
    expect(result.match).toBeUndefined()
    expect(result.candidates).toEqual([])
  })

  it('returns no match for an empty query', () => {
    expect(resolveModelQuery('   ', MODELS)).toEqual({ candidates: [] })
  })
})

describe('formatModelCandidates', () => {
  it('renders provider/model refs and respects the limit', () => {
    expect(formatModelCandidates(MODELS, 2)).toBe('anthropic/claude-sonnet-4-5, anthropic/claude-opus-4-1')
  })
})
