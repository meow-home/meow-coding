# Summary-first Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make summarization the single compaction strategy — when the transcript crosses the context threshold it always summarizes (head → anchored summary, tail verbatim) instead of pruning old tool outputs away without a summary.

**Architecture:** Remove `pruneToolOutputs` from the two compaction trigger paths in `loop.ts` so both go straight to `compact()`, then delete the now-dead prune code and the `prune` setting from types/config/UI. The non-destructive per-request `toolOutputMaxChars` capping and the `hardTruncate` last-resort fallback are unchanged.

**Tech Stack:** TypeScript, Electron main process, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-16-summary-first-compaction-design.md](../specs/2026-09-16-summary-first-compaction-design.md)

## Global Constraints

- Do not change the compaction threshold, the summary template, `selectHeadTail`, tail sizing (`keepTokens`, `tailTurns`), or the `toolOutputMaxChars` per-request capping.
- Keep `hardTruncate` as the last-resort fallback; keep `CLEARED_OUTPUT` (already benign, in the output channel).
- Do not touch `systemLogger.prune()` / `system-logger.ts` — that is log-file pruning, unrelated.
- Test command: `npm run test` (Vitest). Typecheck: `npm run typecheck`.
- Reword copy exactly: ContextTab description becomes "Automatically summarize older context when the context limit is approached."

---

### Task 1: Always summarize over threshold (remove prune from loop.ts)

Remove pruning from both trigger paths so crossing the threshold always runs `compact()`. `pruneToolOutputs` still exists in `compact.ts` after this task (deleted in Task 2); it is simply no longer called.

**Files:**
- Modify: `src/main/agent/loop.ts` (`compactIfOverThreshold` ~693-706, `forceCompact` ~713-726, import line 10)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `SessionRunner.compact(signal)`, `compactIfOverThreshold`, `forceCompact` (existing).
- Produces: no new symbols; behavior change only.

- [ ] **Step 1: Write the failing test**

Add to the compaction `describe` block in `tests/unit/agent-loop.test.ts` (modeled on the existing "runs an LLM compaction when the transcript exceeds the token budget" test, but with `prune: true` and a big old tool output that the old code would prune-and-return on):

```ts
  it('summarizes over-threshold instead of pruning old tool outputs away', async () => {
    const replaced: TranscriptItem[][] = []
    const h = makeHarness({
      tools: new Map<string, ToolDefinition>(),
      maxContextTokens: 200,
      compaction: { auto: true, buffer: 20, keepTokens: 100, tailTurns: 2, toolOutputMaxChars: 2000, prune: true },
      replaceItems: (items) => replaced.push(items),
      maxSteps: 1,
      llm: {
        async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
          h.llm.calls.push(opts)
          if (opts.tools.length === 0) {
            yield { kind: 'text', text: '## Objective\n- compacted' }
          } else {
            yield { kind: 'text', text: 'answer' }
          }
        }
      } as unknown as LlmClient
    })
    // 3 user turns; the oldest carries a large tool output that prune would have
    // cleared (beyond the last 2 turns), letting the old code return without a summary.
    h.items.push(
      { kind: 'message', message: { id: 'u0', role: 'user', text: 'first', createdAt: 1 } },
      { kind: 'message', message: { id: 'a0', role: 'assistant', text: 'ok', createdAt: 1 } },
      { kind: 'tool', tool: { id: 't0', tool: 'bash', input: {}, permission: 'allowed', output: 'x'.repeat(8000) } },
      { kind: 'message', message: { id: 'u1', role: 'user', text: 'second', createdAt: 2 } },
      { kind: 'message', message: { id: 'a1', role: 'assistant', text: 'ok2', createdAt: 2 } },
      { kind: 'message', message: { id: 'u2', role: 'user', text: 'third', createdAt: 3 } }
    )
    h.runner.run()
    await new Promise(r => setTimeout(r, 30))

    expect(h.events.some(e => e.type === 'compacted')).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "summarizes over-threshold"`
Expected: FAIL — with prune still enabled the old tool output is cleared and the estimate drops under budget, so `compactIfOverThreshold` returns without emitting `compacted`.

- [ ] **Step 3: Remove prune from the two trigger paths**

In `src/main/agent/loop.ts`, edit the import on line 10 to drop `pruneToolOutputs`:

```ts
import { selectHeadTail, serializeItems, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, hardTruncate, usableContextTokens, fitHeadToBudget, resolveCompactionSettings } from './compact'
```

In `compactIfOverThreshold`, delete the prune block so the tail reads:

```ts
    if (usedTokens < usable) return

    // Phần thân compaction thật, dùng chung cho cả ngưỡng lẫn force-compact.
    await this.compact(signal)
  }
```

(That removes exactly these lines:)

```ts
    // Prune old tool outputs first (cheap) before spending an LLM compact call.
    // The provider-reported count still includes the pruned bytes, so re-check
    // against a fresh estimate of the smaller transcript.
    const pruned = pruneToolOutputs(items, compaction, maxContextTokens)
    if (pruned) {
      replaceItems(items)
      if (estimateUsage(toLlmMessages(items, opts)) < usable) return
    }
```

Replace the whole `forceCompact` method body with the pruneless version:

```ts
  private async forceCompact(signal?: AbortSignal): Promise<void> {
    if (!this.compaction?.auto || !this.deps.replaceItems) return
    await this.compact(signal)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: PASS — the new test now emits `compacted`; the existing compaction and compact-on-reject tests still pass (they already exercise the summary and fallback paths). The `prune: true` still present in some test configs is still valid at this point (the type keeps `prune` until Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): always summarize over threshold instead of pruning"
```

---

### Task 2: Delete prune code and the `prune` setting

Remove the now-dead `pruneToolOutputs` and PRUNE constants, drop `prune` from the settings type/config/normalization, consolidate the duplicated `CompactionSettings`, reword the UI copy, and update the AGENTS notes.

**Files:**
- Modify: `src/main/agent/compact.ts` (remove `pruneToolOutputs` ~34-68, PRUNE consts ~26-29, local `CompactionSettings` ~10-20, `prune` in `ResolvedCompaction` ~99 and `resolveCompactionSettings` ~124)
- Modify: `src/shared/types.ts` (`CompactionSettings.prune?` at line 311)
- Modify: `src/main/agent/config.ts` (`DEFAULT_COMPACTION` ~113-117, `normalizeCompaction` ~231)
- Modify: `src/renderer/src/components/settings/ContextTab.tsx:117`
- Modify: `src/main/agent/AGENTS.md:26`
- Test: `tests/unit/agent-compact.test.ts`, `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `CompactionSettings` (now solely from `src/shared/types.ts`, re-exported by `compact.ts`).
- Produces: `resolveCompactionSettings` and `ResolvedCompaction` without a `prune` field.

- [ ] **Step 1: Update the tests to the pruneless reality (make them fail)**

In `tests/unit/agent-compact.test.ts`: delete the entire `describe('pruneToolOutputs', ...)` block (the four tests) and remove `pruneToolOutputs` from the import on line 2.

In `tests/unit/agent-loop.test.ts`: remove `prune: true` from every compaction config literal — the `overflowHarness` (~line 1051) and the configs at ~1083, ~1173, ~1233, and the one added in Task 1's test (~"summarizes over-threshold"). Example for `overflowHarness`:

```ts
      compaction: { auto: true, buffer: 20, keepTokens: 100000, tailTurns: 2, toolOutputMaxChars: 2000 },
```

- [ ] **Step 2: Run tests/typecheck to verify they fail**

Run: `npx vitest run tests/unit/agent-compact.test.ts`
Expected: FAIL — `pruneToolOutputs` import is now unresolved after the block deletion only if the source still exports it and the import was removed; the real failure driver is the next typecheck once `prune` is removed. Primarily run: `npm run typecheck` after Step 3 edits. (This task's red is a compile error: `prune` no longer on the type while code still references it.)

- [ ] **Step 3: Delete prune from source**

`src/main/agent/compact.ts`:

Remove the PRUNE constants:

```ts
const PRUNE_PROTECT_RATIO = 0.09
const PRUNE_MINIMUM_RATIO = 0.045
const DEFAULT_PRUNE_CONTEXT_TOKENS = 128000
const PRUNE_PROTECTED_TOOLS = ['skill']
```

Delete the entire `pruneToolOutputs` function (the block from `export function pruneToolOutputs(` through its closing `}` and its leading comment).

Replace the local `CompactionSettings` interface (the `export interface CompactionSettings { ... }` block) with a re-export, and add the import at the top of the file:

```ts
import type { CompactionSettings } from '../../shared/types'
export type { CompactionSettings }
```

In `ResolvedCompaction`, remove the `prune?: boolean` line. In `resolveCompactionSettings`'s returned object, remove the `prune: raw.prune,` line.

`src/shared/types.ts` — remove line 311:

```ts
  prune?: boolean
```

`src/main/agent/config.ts` — `DEFAULT_COMPACTION` becomes:

```ts
export const DEFAULT_COMPACTION: MeowCompactionConfig = {
  auto: true,
  tailTurns: 2
}
```

and in `normalizeCompaction` remove the line:

```ts
    prune: raw?.prune ?? DEFAULT_COMPACTION.prune
```

(also drop the trailing comma bookkeeping so the object stays valid.)

`src/renderer/src/components/settings/ContextTab.tsx:117` — reword:

```tsx
              <span className="context-check-desc">Automatically summarize older context when the context limit is approached.</span>
```

`src/main/agent/AGENTS.md:26` — remove `, \`pruneToolOutputs\`` from the `compact.ts` row so it no longer lists a deleted function.

- [ ] **Step 4: Run typecheck and the full suite to verify green**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean (no references to `prune`), all tests pass (prune tests gone; loop tests pass without `prune` in configs; config normalization drops `prune`).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/compact.ts src/shared/types.ts src/main/agent/config.ts src/renderer/src/components/settings/ContextTab.tsx src/main/agent/AGENTS.md tests/unit/agent-compact.test.ts tests/unit/agent-loop.test.ts
git commit -m "refactor(agent): remove prune; summary-first is the only compaction strategy"
```

---

## Self-Review

**1. Spec coverage:**
- Remove prune from `compactIfOverThreshold` and `forceCompact` → Task 1. ✓
- `compact()` / summary path unchanged; `hardTruncate` fallback kept → untouched (verified by keeping the fallback tests green). ✓
- Delete `pruneToolOutputs` + PRUNE_* consts → Task 2. ✓
- Remove `prune` from `CompactionSettings` (shared) + `ResolvedCompaction` + `resolveCompactionSettings` → Task 2. ✓
- Consolidate duplicated `CompactionSettings` (compact imports+re-exports from shared) → Task 2. ✓
- Config default + normalize drop `prune`; old saved `prune` ignored → Task 2 (normalize no longer reads it). ✓
- ContextTab reword; systemLogger.prune untouched → Task 2. ✓
- AGENTS notes updated → Task 2. ✓
- Testing: prune tests removed, summary-first asserted, config/type green → Tasks 1-2. ✓

**2. Placeholder scan:** No TBD/TODO; each code step shows the exact edit. The one soft spot is Task 2 Step 2's red being a typecheck error rather than a unit failure — that is stated explicitly, not hidden.

**3. Type consistency:** `CompactionSettings` after Task 2 lives only in `src/shared/types.ts` and is re-exported by `compact.ts`, so `loop.ts` (`import type { CompactionSettings } from './compact'`) and `agent-compact.test.ts` (`import type { CompactionSettings } from '../../src/main/agent/compact'`) keep resolving. `ResolvedCompaction` and `resolveCompactionSettings` lose `prune` consistently across compact.ts and every reader (only the two removed loop call sites read it).
