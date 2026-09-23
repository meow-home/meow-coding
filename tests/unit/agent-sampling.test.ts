import { describe, expect, it } from 'vitest'
import { ANTI_REPETITION_FREQUENCY_PENALTY, resolveSampling } from '../../src/main/agent/sampling'

describe('resolveSampling', () => {
  it('returns publisher presets by model family', () => {
    expect(resolveSampling('glm-5.1')).toEqual({ temperature: 1.0, topP: 0.95 })
    expect(resolveSampling('qwen3.5:397b')).toEqual({ temperature: 0.6, topP: 0.95 })
    expect(resolveSampling('qwen3-coder:480b')).toEqual({ temperature: 0.7, topP: 0.8 })
    expect(resolveSampling('kimi-k2.6')).toEqual({ temperature: 0.6 })
    expect(resolveSampling('kimi-k2-thinking')).toEqual({ temperature: 1.0 })
    expect(resolveSampling('deepseek-v4-flash:0731')).toEqual({ temperature: 0.6, topP: 0.95 })
    expect(resolveSampling('gpt-oss:120b')).toEqual({ temperature: 1.0, topP: 1.0 })
  })

  it('matches on the bare model id after a provider prefix', () => {
    expect(resolveSampling('ollama-cloud/glm-5.1')).toEqual({ temperature: 1.0, topP: 0.95 })
  })

  it('returns nothing for an unknown family', () => {
    expect(resolveSampling('gpt-5-codex')).toEqual({})
    expect(resolveSampling('claude-opus-4.6')).toEqual({})
  })

  it('lets a meow.json override win per field over the preset', () => {
    expect(resolveSampling('glm-5.1', { 'glm-*': { temperature: 0.7 } })).toEqual({ temperature: 0.7, topP: 0.95 })
  })

  it('applies an override to a model with no preset', () => {
    expect(resolveSampling('my-local-model', { 'my-*': { temperature: 0.2 } })).toEqual({ temperature: 0.2 })
  })

  it('adds the anti-repetition penalty for a matched model', () => {
    expect(ANTI_REPETITION_FREQUENCY_PENALTY).toBe(0.5)
    expect(resolveSampling('glm-5.1', undefined, { antiRepetition: true }))
      .toEqual({ temperature: 1.0, topP: 0.95, frequencyPenalty: 0.5 })
    expect(resolveSampling('glm-5.1', { 'glm-*': { frequencyPenalty: 0.8 } }, { antiRepetition: true }).frequencyPenalty).toBe(0.8)
  })

  it('does not add a penalty for an unmatched model', () => {
    expect(resolveSampling('gpt-5-codex', undefined, { antiRepetition: true })).toEqual({})
  })
})
