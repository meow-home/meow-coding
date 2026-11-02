import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CUSTOM_LABEL,
  DEFAULT_SKIP_LABEL,
  DEFAULT_SUBMIT_LABEL,
  normalizeLabel,
  questionTool
} from '../../src/main/agent/tools/question'
import type { QuestionPrompt } from '../../src/shared/types'

describe('question tool labels', () => {
  it('normalizes model labels and falls back to defaults', () => {
    expect(normalizeLabel('  Continue \n now ', DEFAULT_SUBMIT_LABEL)).toBe('Continue now')
    expect(normalizeLabel('', DEFAULT_SUBMIT_LABEL)).toBe(DEFAULT_SUBMIT_LABEL)
    expect(normalizeLabel(42, DEFAULT_SUBMIT_LABEL)).toBe(DEFAULT_SUBMIT_LABEL)
    expect(normalizeLabel('x'.repeat(40), DEFAULT_SUBMIT_LABEL)).toHaveLength(24)
  })

  it('forwards sanitized labels to the prompt', async () => {
    let asked: QuestionPrompt | undefined
    const result = await questionTool.run(
      {
        question: 'Pick one',
        options: [{ label: 'A' }],
        submitLabel: '  Continue  ',
        skipLabel: 'Not  now',
        customLabel: ''
      },
      {
        cwd: '.',
        ask: async (q) => {
          asked = q
          return 'A'
        }
      }
    )

    expect(asked?.submitLabel).toBe('Continue')
    expect(asked?.skipLabel).toBe('Not now')
    expect(asked?.customLabel).toBe(DEFAULT_CUSTOM_LABEL)
    expect(asked?.options).toEqual([{ label: 'A' }])
    expect(result).toEqual({ output: 'User answered: A', metadata: { answer: 'A' } })
  })

  it('keeps the defaults when the model omits every label', async () => {
    let asked: QuestionPrompt | undefined
    await questionTool.run(
      { question: 'Pick one' },
      {
        cwd: '.',
        ask: async (q) => {
          asked = q
          return 'yes'
        }
      }
    )

    expect(asked?.submitLabel).toBe(DEFAULT_SUBMIT_LABEL)
    expect(asked?.skipLabel).toBe(DEFAULT_SKIP_LABEL)
    expect(asked?.customLabel).toBe(DEFAULT_CUSTOM_LABEL)
  })
})
