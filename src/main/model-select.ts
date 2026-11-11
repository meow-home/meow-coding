import type { ModelRef } from '../shared/types'

/** How many alternatives an ambiguity/unknown-model error lists. */
export const MODEL_CANDIDATE_LIMIT = 8

export interface ModelMatch {
  /** Set only when the query resolves to exactly one model. */
  match?: ModelRef
  /** Alternatives when the query is ambiguous (empty when there is no match). */
  candidates: ModelRef[]
}

export function modelLabel(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function words(input: string): string[] {
  const normalized = normalize(input)
  return normalized ? normalized.split(' ') : []
}

/**
 * Resolves a free-form model request ("opus", "claude sonnet", "anthropic/
 * claude-sonnet-4-5", "codex gpt-5") against the models the user actually has
 * configured. A unique match wins; anything else returns candidates so the
 * caller can ask for a precise `provider/model` instead of guessing.
 */
export function resolveModelQuery(query: string, refs: ModelRef[]): ModelMatch {
  const trimmed = query.trim()
  if (!trimmed) return { candidates: [] }
  const lower = trimmed.toLowerCase()
  const unique = (matches: ModelRef[]): ModelMatch => {
    if (matches.length === 1) return { match: matches[0], candidates: matches }
    return { candidates: matches.slice(0, MODEL_CANDIDATE_LIMIT) }
  }

  const exactRef = refs.filter(ref => modelLabel(ref).toLowerCase() === lower)
  if (exactRef.length > 0) return unique(exactRef)

  const exactModel = refs.filter(ref => ref.model.toLowerCase() === lower)
  if (exactModel.length > 0) return unique(exactModel)

  const queryWords = words(trimmed)
  if (queryWords.length === 0) return { candidates: [] }
  const normalizedQuery = normalize(trimmed)
  const scored = refs
    .map(ref => {
      const label = normalize(`${ref.provider} ${ref.model} ${ref.accountLabel ?? ''}`)
      const labelWords = words(label)
      if (!queryWords.every(word => labelWords.some(candidate => candidate.startsWith(word)))) return undefined
      // A full phrase hit beats a per-word hit; a shorter label is the more
      // specific match when two models tie.
      const phrase = label.includes(normalizedQuery) ? 10 : 0
      const wordHits = queryWords.filter(word => labelWords.includes(word)).length * 2
      return { ref, score: phrase + wordHits }
    })
    .filter((entry): entry is { ref: ModelRef; score: number } => entry !== undefined)
    .sort((a, b) =>
      b.score - a.score ||
      modelLabel(a.ref).length - modelLabel(b.ref).length ||
      modelLabel(a.ref).localeCompare(modelLabel(b.ref))
    )
  if (scored.length === 0) return { candidates: [] }
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { candidates: scored.slice(0, MODEL_CANDIDATE_LIMIT).map(entry => entry.ref) }
  }
  return { match: scored[0].ref, candidates: [scored[0].ref] }
}

/** One-line list of model refs for a tool error message. */
export function formatModelCandidates(refs: ModelRef[], limit = MODEL_CANDIDATE_LIMIT): string {
  return refs.slice(0, limit).map(modelLabel).join(', ')
}
