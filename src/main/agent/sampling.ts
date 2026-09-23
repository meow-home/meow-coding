import { matchPattern } from './permission'

/**
 * Sampling for open models behind OpenAI-compatible endpoints. Gateways such as
 * Ollama's /v1 fall back to generic defaults instead of the publisher's tuned
 * values when the request carries none, and reasoning models degrade into loops
 * under the wrong temperature. Native providers keep their own defaults.
 */
export interface SamplingParams {
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export type SamplingOverrides = Record<string, SamplingParams>

// Only for the single retry of a step discarded for repetition: a standing
// penalty hurts code, which legitimately repeats identifiers.
export const ANTI_REPETITION_FREQUENCY_PENALTY = 0.5

// Publisher-recommended values from each model card; first match wins, so more
// specific families come first.
const PRESETS: Array<{ family: RegExp; params: SamplingParams }> = [
  { family: /qwen.*coder/i, params: { temperature: 0.7, topP: 0.8 } },
  { family: /qwen/i, params: { temperature: 0.6, topP: 0.95 } },
  { family: /glm/i, params: { temperature: 1.0, topP: 0.95 } },
  { family: /kimi.*think/i, params: { temperature: 1.0 } },
  { family: /kimi/i, params: { temperature: 0.6 } },
  { family: /minimax/i, params: { temperature: 1.0, topP: 0.95 } },
  { family: /deepseek/i, params: { temperature: 0.6, topP: 0.95 } },
  { family: /gpt-oss/i, params: { temperature: 1.0, topP: 1.0 } },
  { family: /gemma/i, params: { temperature: 1.0, topP: 0.95 } },
  { family: /nemotron/i, params: { temperature: 0.6, topP: 0.95 } }
]

export function resolveSampling(
  modelId: string,
  overrides?: SamplingOverrides,
  opts?: { antiRepetition?: boolean }
): SamplingParams {
  const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
  const preset = PRESETS.find(p => p.family.test(bare))
  const pattern = overrides ? Object.keys(overrides).find(k => matchPattern(k, bare)) : undefined
  const override = pattern ? overrides?.[pattern] : undefined
  // An unknown model may be an OpenAI reasoning model, which rejects sampling
  // parameters outright — send nothing rather than guess.
  if (!preset && !override) return {}
  const params: SamplingParams = { ...preset?.params, ...override }
  if (opts?.antiRepetition) {
    params.frequencyPenalty = Math.max(params.frequencyPenalty ?? 0, ANTI_REPETITION_FREQUENCY_PENALTY)
  }
  return params
}
