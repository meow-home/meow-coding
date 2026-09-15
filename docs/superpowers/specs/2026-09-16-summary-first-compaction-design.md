# Summary-first compaction (remove prune)

**Date:** 2026-09-16
**Status:** Design approved, pending spec review
**Depends on:** [2026-09-15 cleared-output marker fix](../../../src/main/agent/compact.ts) (Phase 1 — `CLEARED_OUTPUT` is now a benign note in the output channel, not an error).

## Problem

When the transcript crosses the context threshold, `compactIfOverThreshold`
([`src/main/agent/loop.ts`](../../../src/main/agent/loop.ts)) runs
`pruneToolOutputs` **first** and, if pruning alone brings the estimate back
under budget, **returns without summarizing**. On a long session with large
tool outputs, prune keeps winning cycle after cycle: every old tool output is
cleared, but **no summary is ever produced**, so the model permanently loses
the information those outputs carried and must re-run tools to recover it.

This diverges from Claude CLI / Claude desktop, whose primary strategy is
**summarization**: when context fills, they fold the history into an anchored
summary and continue, rather than repeatedly nulling individual tool outputs.

Phase 1 already fixed the most acute symptom (the cleared marker was rendered as
an error-type tool_result, so the model read it as a channel failure). Phase 2
addresses the strategy itself.

## Goal

Make summarization the single compaction strategy ("summary-first"), matching
Claude CLI:

- When the transcript crosses the threshold — proactively at a step boundary,
  or reactively on a provider context-overflow reject — always run the LLM
  summarization (`compact()`): summarize the older head into an anchored
  summary, keep the recent tail verbatim.
- Remove `pruneToolOutputs` and the `prune` setting entirely.

### Non-goals

- Changing the compaction threshold, the anchored-summary template, or
  `selectHeadTail` / tail sizing (`keepTokens`, `tailTurns`).
- Changing the non-destructive per-request capping of old tool outputs
  (`toolOutputMaxChars` in `toLlmMessages`) — it stays; it is what keeps context
  lean *between* compactions and never mutates stored items.
- Removing `hardTruncate` — it stays as the last-resort fallback.

## Why prune cannot simply run before summarization

Pruning clears old tool outputs. If it runs *before* the summarizer, the very
content we want the summary to capture is already gone, so the summary is
blind to it. Summary-first therefore means prune is removed from the compaction
paths, not merely reordered.

## Design

### Trigger paths (loop.ts)

- **`compactIfOverThreshold`** (proactive, at step boundary when
  `max(estimate, providerTokens) >= usable`): remove the `pruneToolOutputs`
  block and its early `return`. When over budget, call `compact()` directly.
- **`forceCompact`** (reactive, after a provider overflow reject): remove the
  `pruneToolOutputs` step. Call `compact()` directly, then the caller retries
  the step (bounded by `MAX_COMPACT_PER_RUN`).
- Drop the `pruneToolOutputs` import.

### `compact()` (unchanged behavior)

`selectHeadTail(keepTokens, tailTurns)` → summarize the head via
`compactTranscript` (merging any `previousSummary`) → `replaceItems([marker,
summary, ...tail])`. After a summary the transcript shrinks to `[marker,
summary, tail]`, so it does not immediately re-cross the threshold — the LLM
summary call fires roughly once per context-fill cycle, as in Claude CLI.

### Fallbacks (unchanged)

`compact()` still falls back to `hardTruncate` when the summary call fails, the
head is empty, or `MAX_COMPACT_PER_RUN` is reached. `hardTruncate` clears all
tool outputs (benign `CLEARED_OUTPUT`, per Phase 1) and then drops the oldest
turns, always keeping the final turn.

### Removals (compact.ts)

- Delete `pruneToolOutputs`.
- Delete `PRUNE_PROTECT_RATIO`, `PRUNE_MINIMUM_RATIO`,
  `DEFAULT_PRUNE_CONTEXT_TOKENS`, `PRUNE_PROTECTED_TOOLS`.
- Remove `prune` from `CompactionSettings` and `ResolvedCompaction`, and the
  `prune: raw.prune` passthrough in `resolveCompactionSettings`.

### Type consolidation (targeted cleanup, in scope)

`CompactionSettings` is currently defined **twice** — in
[`src/shared/types.ts`](../../../src/shared/types.ts) and in
[`src/main/agent/compact.ts`](../../../src/main/agent/compact.ts) — with
identical fields. Because both must lose `prune`, consolidate: `compact.ts`
imports `CompactionSettings` from `shared/types` instead of redefining it, so
the field set lives in one place. `ResolvedCompaction` (compact-internal) stays
in `compact.ts`, minus `prune`.

### Config (config.ts)

- `DEFAULT_COMPACTION = { auto: true, tailTurns: 2 }` (drop `prune: true`).
- `normalizeCompaction`: drop the `prune: raw?.prune ?? ...` line. Saved
  settings that still carry `prune` are simply ignored (no error).

### Settings surface (shared/types.ts, ContextTab.tsx)

- Remove `prune?: boolean` from `CompactionSettings` in `shared/types.ts`.
- `prune` has **no dedicated UI control** — the ContextTab checkbox toggles
  `compaction.auto`. Only the description text mentions "prune"; reword
  [`ContextTab.tsx`](../../../src/renderer/src/components/settings/ContextTab.tsx)
  line ~117 from "Automatically prune older messages when context limit is
  approached." to "Automatically summarize older context when the context
  limit is approached."

### Not touched

`systemLogger.prune()` / `system-logger.ts` `prune(maxDays)` is log-file
pruning, unrelated to compaction. Leave it.

## Error handling

No new failure modes. The removed early-return means an over-threshold step
always attempts an LLM summary; existing guards (`compaction?.auto`,
`MAX_COMPACT_PER_RUN`, abort signal, summary-failure → `hardTruncate`) remain
the safety net so a summary call that fails or a genuinely-over-limit prompt
still degrades to a smaller transcript rather than erroring the turn.

## Testing

- **compact.ts:** delete the `pruneToolOutputs` describe block (4 tests) in
  [`tests/unit/agent-compact.test.ts`](../../../tests/unit/agent-compact.test.ts);
  keep `hardTruncate`, `selectHeadTail`, summary-prompt, and settings tests.
- **loop.ts:** in
  [`tests/unit/agent-loop.test.ts`](../../../tests/unit/agent-loop.test.ts),
  update the compaction tests that assumed prune-then-return; add/keep a test
  asserting that crossing the threshold **always emits `compacted`/produces a
  summary** (no prune-only path), and that `forceCompact` summarizes on a
  provider overflow reject.
- **config:** `DEFAULT_COMPACTION` no longer carries `prune`; a saved settings
  object containing `prune` normalizes without error and without a `prune`
  field.
- **types:** `compact.ts` compiles against the single `shared/types`
  `CompactionSettings`.
- `npm run typecheck` and `npm run test` green.

## Files

**Modified**
- `src/main/agent/loop.ts` — remove prune from `compactIfOverThreshold` and
  `forceCompact`; drop the import.
- `src/main/agent/compact.ts` — delete `pruneToolOutputs` + PRUNE_* consts;
  drop `prune` from `ResolvedCompaction` and `resolveCompactionSettings`;
  import `CompactionSettings` from `shared/types`.
- `src/main/agent/config.ts` — drop `prune` from `DEFAULT_COMPACTION` and
  `normalizeCompaction`.
- `src/shared/types.ts` — remove `prune?` from `CompactionSettings`.
- `src/renderer/src/components/settings/ContextTab.tsx` — reword the
  auto-compact description.
- `tests/unit/agent-compact.test.ts`, `tests/unit/agent-loop.test.ts` — remove
  prune tests; assert summary-first.
- `src/main/agent/AGENTS.md`, `src/main/AGENTS.md` — update the prune/compaction
  notes to describe summary-first.
