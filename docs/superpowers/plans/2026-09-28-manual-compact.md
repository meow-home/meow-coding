# Manual `/compact` and Progress-Based Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a long single-turn session always compact (summary inside the turn, step-aware truncation), replace the fixed 2-per-run compaction cap with a progress check, and add a `/compact [focus]` system command that works idle and mid-turn.

**Architecture:** New pure helpers in `src/main/agent/compact.ts` (`splitWithinTurn`, `planCompaction`, step-aware `hardTruncate`, focus-aware `buildCompactionPrompt`). `SessionRunner` (`loop.ts`) gets a progress-tracking `compact()` that returns an outcome, plus `requestCompact()` (mid-run) and `compactNow()` (idle). `MeowAgentManager.compactSession()` dispatches the new built-in `system` command. A new `notice` `ChatEvent` carries feed-only notices.

**Tech Stack:** TypeScript (strict), Electron main process, React renderer, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-manual-compact-design.md`

## Global Constraints

- Source code, UI labels and `[meow]`-prefixed notices are English.
- Do not add unnecessary comments; comment only a non-obvious decision.
- Git commits: **no** `Co-Authored-By` trailer.
- IPC: no hardcoded channel strings (this plan adds no channel; `notice` travels on the existing chat-event channel).
- Tests never call a real LLM; use the stubs shown.
- Required before completion: `npm run typecheck` and `npm test` pass.
- Code changes → matching `AGENTS.md` rows and `docs/reference/` pages updated in the same change set (Task 4).
- Test files `tests/*.test.ts` may be CRLF; if `Edit` fails to match, edit with a small Node/Python script.

---

### Task 1: Pure compaction helpers in `compact.ts`

**Files:**
- Modify: `src/main/agent/compact.ts` (`hardTruncate` at lines 76-95, `buildCompactionPrompt` at 254-262; add new exports after `selectHeadTail`)
- Test: `tests/unit/agent-compact.test.ts`

**Interfaces:**
- Produces:
  - `export interface TurnSplit { head: TranscriptItem[]; request: TranscriptItem; recent: TranscriptItem[] }`
  - `export function splitWithinTurn(items: TranscriptItem[], keepTokens: number): TurnSplit | null`
  - `export function planCompaction(items: TranscriptItem[], keepTokens: number, tailTurns: number): { head: TranscriptItem[]; keep: TranscriptItem[] } | null`
  - `buildCompactionPrompt(previousSummary: string | undefined, headText: string, focus?: string): string`
  - `hardTruncate` keeps its signature; now also drops the oldest steps of an oversized final turn.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/agent-compact.test.ts`, extend the import on line 2 with `splitWithinTurn, planCompaction`, then add below the existing `tool()` helper (line 15):

```ts
function step(text: string, ...outputs: string[]): TranscriptItem[] {
  return [msg('assistant', text), ...outputs.map(o => tool(o))]
}
const texts = (items: TranscriptItem[]) => items.flatMap(i => (i.kind === 'message' ? [i.message.text] : []))
// toLlmMessages drops a tool item that has no assistant message before it.
function orphanTools(items: TranscriptItem[]): number {
  let afterAssistant = false
  let orphans = 0
  for (const item of items) {
    if (item.kind === 'message') afterAssistant = item.message.role === 'assistant'
    else if (!afterAssistant) orphans++
  }
  return orphans
}
const marker = (): TranscriptItem => ({ kind: 'message', message: { id: 'm', role: 'user', text: COMPACTION_MARKER, createdAt: 1 } })
```

Add these `describe` blocks at the end of the file:

```ts
describe('splitWithinTurn', () => {
  const longTurn = () => [
    msg('user', 'build it'),
    ...step('s1', 'a'.repeat(4000)),
    ...step('s2', 'b'.repeat(4000)),
    ...step('s3', 'c'.repeat(400))
  ]

  it('summarizes the older steps of the last turn and keeps the request verbatim', () => {
    const items = longTurn()
    const split = splitWithinTurn(items, 300)!
    expect(split.request).toBe(items[0])
    expect(texts(split.head)).toEqual(['s1', 's2'])
    expect(texts(split.recent)).toEqual(['s3'])
    expect(orphanTools([split.request, ...split.recent])).toBe(0)
  })

  it('keeps at least one step even when nothing fits keepTokens', () => {
    expect(texts(splitWithinTurn(longTurn(), 0)!.recent)).toEqual(['s3'])
  })

  it('keeps every recent step that fits but always summarizes the first one', () => {
    const split = splitWithinTurn(longTurn(), 1_000_000)!
    expect(texts(split.head)).toEqual(['s1'])
    expect(texts(split.recent)).toEqual(['s2', 's3'])
  })

  it('returns null when the last turn has a single step or there is no turn', () => {
    expect(splitWithinTurn([msg('user', 'q'), ...step('s1', 'x')], 0)).toBeNull()
    expect(splitWithinTurn([msg('assistant', 'orphan')], 0)).toBeNull()
  })

  it('puts earlier turns in the head without the previous compaction pair', () => {
    const items = [
      marker(), msg('assistant', 'old summary'),
      msg('user', 'old'), msg('assistant', 'old answer'),
      msg('user', 'new'), ...step('s1', 'x'), ...step('s2', 'y')
    ]
    const split = splitWithinTurn(items, 0)!
    expect(texts(split.head)).toEqual(['old', 'old answer', 's1'])
    expect(split.request.kind === 'message' && split.request.message.text).toBe('new')
  })
})

describe('planCompaction', () => {
  it('uses the turn-level split when there is an older head', () => {
    const items = [msg('user', 'first'), msg('assistant', 'a1'), msg('user', 'second'), msg('assistant', 'a2')]
    const plan = planCompaction(items, 1_000_000, 1)!
    expect(texts(plan.head)).toEqual(['first', 'a1'])
    expect(texts(plan.keep)).toEqual(['second', 'a2'])
  })

  it('falls back to splitting inside a single long turn', () => {
    const items = [msg('user', 'build it'), ...step('s1', 'x'), ...step('s2', 'y')]
    const plan = planCompaction(items, 0, 2)!
    expect(texts(plan.head)).toEqual(['s1'])
    expect(texts(plan.keep)).toEqual(['build it', 's2'])
  })

  it('returns null when nothing can be summarized', () => {
    expect(planCompaction([msg('user', 'q'), ...step('s1', 'x')], 0, 2)).toBeNull()
    expect(planCompaction([], 0, 2)).toBeNull()
  })
})

describe('hardTruncate step-aware', () => {
  it('drops the oldest steps of an oversized final turn and keeps the request', () => {
    const items = [
      msg('user', 'do it'),
      ...step('s1 ' + 'x'.repeat(20000), 'o1'),
      ...step('s2 ' + 'y'.repeat(20000), 'o2'),
      ...step('s3 short', 'o3')
    ]
    const out = hardTruncate(items, 2000)
    expect(texts(out)).toEqual(['do it', 's3 short'])
    expect(orphanTools(out)).toBe(0)
    expect(estimateUsage(out)).toBeLessThan(2000)
  })

  it('keeps the last step even when it alone exceeds the target', () => {
    const items = [msg('user', 'q'), ...step('s1 ' + 'x'.repeat(20000)), ...step('s2 ' + 'y'.repeat(20000))]
    const out = hardTruncate(items, 100)
    expect(out).toHaveLength(2)
    expect(texts(out)[0]).toBe('q')
    expect(texts(out)[1].startsWith('s2 ')).toBe(true)
  })

  it('keeps a leading summary pair while dropping steps', () => {
    const items = [marker(), msg('assistant', 'summary'), msg('user', 'q'), ...step('s1 ' + 'x'.repeat(20000)), ...step('s2 small')]
    const out = hardTruncate(items, 2000)
    expect(texts(out)).toEqual([COMPACTION_MARKER, 'summary', 'q', 's2 small'])
  })
})

describe('buildCompactionPrompt focus', () => {
  it('adds a focus block before the history when the user gives instructions', () => {
    const prompt = buildCompactionPrompt(undefined, '[User]: hi', 'keep the auth flow')
    expect(prompt).toContain('<focus>\nkeep the auth flow\n</focus>')
    expect(prompt.indexOf('<focus>')).toBeLessThan(prompt.indexOf('[User]: hi'))
  })

  it('omits the focus block for blank instructions', () => {
    expect(buildCompactionPrompt(undefined, '[User]: hi', '   ')).not.toContain('<focus>')
    expect(buildCompactionPrompt(undefined, '[User]: hi')).not.toContain('<focus>')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/agent-compact.test.ts`
Expected: FAIL — `splitWithinTurn`/`planCompaction` are not exported, the step-aware and focus cases fail.

- [ ] **Step 3: Implement**

In `src/main/agent/compact.ts`:

1. Replace the final `return out` of `hardTruncate` (line 94) with `return measure(out) <= targetTokens ? out : dropOldestSteps(out, targetTokens, measure)`, and add below `hardTruncate`:

```ts
function dropOldestSteps(
  items: TranscriptItem[],
  targetTokens: number,
  measure: (items: TranscriptItem[]) => number
): TranscriptItem[] {
  const all = turns(items)
  const last = all[all.length - 1]
  if (!last) return items
  const prefix = items.slice(0, last.start + 1)
  const steps = stepStarts(items, last.start + 1, items.length)
  let out = items
  for (let i = 1; i < steps.length; i++) {
    out = [...prefix, ...items.slice(steps[i])]
    if (measure(out) <= targetTokens) break
  }
  return out
}
```

(`turns` and `stepStarts` are function declarations, so their position in the file does not matter.)

2. After `selectHeadTail`, add:

```ts
// A step is an assistant message plus the tool items after it. toLlmMessages
// drops a tool item with no assistant message before it, so a transcript may
// only be cut at a step start.
function stepStarts(items: TranscriptItem[], from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i < to; i++) {
    const item = items[i]
    if (item.kind === 'message' && item.message.role === 'assistant') out.push(i)
  }
  return out
}

export interface TurnSplit {
  head: TranscriptItem[]
  request: TranscriptItem
  recent: TranscriptItem[]
}

/**
 * Splits the last turn when turn-level compaction has nothing to summarize
 * (one long autonomous turn). The turn's request stays verbatim; its older
 * steps join the head, the newest steps that fit keepTokens stay (at least one).
 */
export function splitWithinTurn(items: TranscriptItem[], keepTokens: number): TurnSplit | null {
  const all = turns(items)
  const last = all[all.length - 1]
  if (!last) return null
  const steps = stepStarts(items, last.start + 1, last.end)
  if (steps.length < 2) return null
  let keepFrom = steps[steps.length - 1]
  for (let i = steps.length - 2; i >= 1; i--) {
    if (estimateUsage(items.slice(steps[i], last.end)) > keepTokens) break
    keepFrom = steps[i]
  }
  return {
    head: [...stripCompactionPairs(items.slice(0, last.start)), ...items.slice(last.start + 1, keepFrom)],
    request: items[last.start],
    recent: items.slice(keepFrom)
  }
}

export function planCompaction(
  items: TranscriptItem[],
  keepTokens: number,
  tailTurns: number
): { head: TranscriptItem[]; keep: TranscriptItem[] } | null {
  const { head, tail } = selectHeadTail(items, keepTokens, tailTurns)
  if (head.length > 0) return { head, keep: tail }
  const split = splitWithinTurn(items, keepTokens)
  return split ? { head: split.head, keep: [split.request, ...split.recent] } : null
}
```

3. Replace `buildCompactionPrompt` with:

```ts
export function buildCompactionPrompt(previousSummary: string | undefined, headText: string, focus?: string): string {
  const focusText = focus?.trim()
  return [
    previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${previousSummary}\n</previous-summary>`
      : 'Create a new anchored summary from the conversation history.',
    SUMMARY_TEMPLATE,
    ...(focusText
      ? [`<focus>\n${focusText}\n</focus>\nThe user asked to keep the details above in particular; preserve them in the summary.`]
      : []),
    headText
  ].join('\n\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/agent-compact.test.ts`
Expected: PASS (all, including the pre-existing `hardTruncate` cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/compact.ts tests/unit/agent-compact.test.ts
git commit -m "feat(agent): split a long turn for compaction and truncate by step"
```

---

### Task 2: Progress-based compaction and manual entry points in `SessionRunner`

**Files:**
- Modify: `src/shared/types.ts:250-279` (add the `notice` `ChatEvent`)
- Modify: `src/main/agent/loop.ts` (imports line 11; constants 117-121; fields 174-205; `run` 211; `compactIfOverThreshold` 806-830; `compact` 844-892; `tryRecoverFromReject` 894-913)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes (Task 1): `planCompaction(items, keepTokens, tailTurns)`, `buildCompactionPrompt(prev, head, focus?)`, step-aware `hardTruncate`.
- Produces:
  - `ChatEvent` member `{ type: 'notice'; agentId: string; text: string }`
  - `export type CompactOutcome = { kind: 'summarized'; gain: number } | { kind: 'truncated' } | { kind: 'nothing' } | { kind: 'failed' } | { kind: 'aborted' }`
  - `export const NOTHING_TO_COMPACT = '[meow] Nothing to compact yet.'`
  - `export const LOW_GAIN_COMPACT = '[meow] Compaction saved little context — the recent steps are most of it.'`
  - `SessionRunner.requestCompact(focus?: string): void`
  - `SessionRunner.compactNow(focus?: string, signal?: AbortSignal): Promise<CompactOutcome>`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/agent-loop.test.ts`, change line 7 to:

```ts
import { CLEARED_OUTPUT, COMPACTION_MARKER, COMPACTION_SYSTEM } from '../../src/main/agent/compact'
```

and extend line 6 to also import `LOW_GAIN_COMPACT, NOTHING_TO_COMPACT` from `../../src/main/agent/loop`. Then append at the end of the file:

```ts
describe('SessionRunner progress-based and manual compaction', () => {
  class RoutingLlm implements LlmClient {
    prompts: string[] = []
    stepCalls = 0
    constructor(
      private summary: (n: number) => string,
      private step: (n: number) => LlmStreamPart[]
    ) {}
    async *stream(opts: LlmStreamOptions): AsyncGenerator<LlmStreamPart> {
      if (opts.system === COMPACTION_SYSTEM) {
        this.prompts.push(JSON.stringify(opts.messages))
        yield { kind: 'text', text: this.summary(this.prompts.length) }
        yield { kind: 'finish' }
        return
      }
      this.stepCalls++
      for (const p of this.step(this.stepCalls)) yield p
    }
  }

  function longTurn(steps: number, outputChars: number): TranscriptItem[] {
    const out: TranscriptItem[] = [{ kind: 'message', message: { id: 'u1', role: 'user', text: 'build the feature', createdAt: 1 } }]
    for (let i = 0; i < steps; i++) {
      out.push({ kind: 'message', message: { id: `a${i}`, role: 'assistant', text: `step ${i}`, createdAt: 1 } })
      out.push({ kind: 'tool', tool: { id: `t${i}`, tool: 'read', input: { n: i }, permission: 'allowed', output: 'x'.repeat(outputChars) } })
    }
    return out
  }

  const texts = (items: TranscriptItem[]) => items.flatMap(i => (i.kind === 'message' ? [i.message.text] : []))

  // One shared transcript for reads, appends and replacements, like the real store.
  // Each read returns ~1150 tokens; the counter keeps results distinct so the
  // tool-loop detector (same call + result 3×) never trips.
  function harness(llm: RoutingLlm, seed: TranscriptItem[], overrides: Partial<LoopDeps> = {}) {
    let items = seed
    let reads = 0
    const h = makeHarness({
      llm,
      maxContextTokens: 2000,
      compaction: { auto: true, buffer: 200, keepTokens: 300, tailTurns: 2, toolOutputMaxChars: 100000 },
      maxSteps: 0,
      tools: new Map([['read', stubTool('read', async () => ({ output: `${++reads} ${'y'.repeat(4000)}` }))]]),
      getItems: () => items,
      replaceItems: (next) => { items = next },
      appendMessage: (m: ChatMessage) => { items.push({ kind: 'message', message: m }) },
      appendTool: (t: ToolCallData) => { items.push({ kind: 'tool', tool: t }) },
      ...overrides
    })
    return { ...h, current: () => items }
  }

  const readCall = (n: number): LlmStreamPart[] => [
    { kind: 'tool-call', toolCallId: `c${n}`, toolName: 'read', toolInput: { file_path: `f${n}.ts` } },
    { kind: 'finish' }
  ]

  it('summarizes inside a single long turn and keeps the request verbatim', async () => {
    const llm = new RoutingLlm(() => 'summary of early steps', () => textParts('done'))
    const h = harness(llm, longTurn(8, 1200))
    await h.runner.run()
    const items = h.current()
    expect(texts(items).slice(0, 3)).toEqual([COMPACTION_MARKER, 'summary of early steps', 'build the feature'])
    expect(items[3].kind === 'message' && items[3].message.role).toBe('assistant')
    expect(llm.prompts).toHaveLength(1)
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('keeps compacting in one run while each compaction makes progress', async () => {
    const llm = new RoutingLlm(n => `summary ${n}`, n => (n < 8 ? readCall(n) : textParts('done')))
    const h = harness(llm, [{ kind: 'message', message: { id: 'u1', role: 'user', text: 'go', createdAt: 1 } }])
    await h.runner.run()
    expect(llm.prompts.length).toBeGreaterThan(2)
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('stops calling the summarizer once a compaction barely shrinks the context', async () => {
    const llm = new RoutingLlm(() => 'z'.repeat(7000), n => (n === 1 ? readCall(1) : textParts('done')))
    const h = harness(llm, longTurn(3, 2800), {
      tools: new Map([['read', stubTool('read', async () => ({ output: 'ok' }))]])
    })
    await h.runner.run()
    expect(llm.prompts).toHaveLength(1)
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('honors a mid-run /compact at the next step, below the threshold, with focus', async () => {
    const ref: { runner?: SessionRunner } = {}
    const llm = new RoutingLlm(() => 'manual summary', n => (n === 1 ? readCall(1) : textParts('done')))
    const h = harness(llm, longTurn(3, 200), {
      tools: new Map([['read', stubTool('read', async () => { ref.runner?.requestCompact('keep auth'); return { output: 'ok' } })]])
    })
    ref.runner = h.runner
    await h.runner.run()
    expect(llm.prompts).toHaveLength(1)
    expect(llm.prompts[0]).toContain('<focus>\\nkeep auth\\n</focus>')
    expect(texts(h.current())[0]).toBe(COMPACTION_MARKER)
  })

  it('drops a mid-run /compact request that the run never reached', async () => {
    // step-start is emitted after the step's compaction check (loop.ts), so a
    // request made there on the final step has no boundary left in this run.
    const ref: { runner?: SessionRunner } = {}
    const llm = new RoutingLlm(() => 's', () => textParts('done'))
    const h = harness(llm, longTurn(3, 200), {
      onEvent: (e) => { if (e.type === 'step-start') ref.runner?.requestCompact() }
    })
    ref.runner = h.runner
    await h.runner.run()
    ref.runner = undefined
    await h.runner.run()
    expect(llm.prompts).toHaveLength(0)
  })

  it('compacts on demand while idle even with auto-compaction off', async () => {
    const llm = new RoutingLlm(() => 'idle summary', () => textParts('done'))
    const h = harness(llm, longTurn(3, 200), {
      compaction: { auto: false, buffer: 200, keepTokens: 300, tailTurns: 2, toolOutputMaxChars: 100000 }
    })
    const outcome = await h.runner.compactNow('keep tests')
    expect(outcome.kind).toBe('summarized')
    expect(texts(h.current()).slice(0, 3)).toEqual([COMPACTION_MARKER, 'idle summary', 'build the feature'])
    expect(llm.prompts[0]).toContain('keep tests')
    expect(h.events.map(e => e.type)).toEqual(expect.arrayContaining(['compaction-start', 'compacted']))
  })

  it('reports that there is nothing to compact without calling the model', async () => {
    const llm = new RoutingLlm(() => 's', () => textParts('done'))
    const h = harness(llm, [{ kind: 'message', message: { id: 'u1', role: 'user', text: 'hi', createdAt: 1 } }])
    const outcome = await h.runner.compactNow()
    expect(outcome.kind).toBe('nothing')
    expect(llm.prompts).toHaveLength(0)
    expect(h.events).toContainEqual({ type: 'notice', agentId: 'a1', text: NOTHING_TO_COMPACT })
  })

  it('tells the user when a manual compaction saved little context', async () => {
    const llm = new RoutingLlm(() => 'z'.repeat(7000), () => textParts('done'))
    const h = harness(llm, longTurn(3, 2800))
    const outcome = await h.runner.compactNow()
    expect(outcome.kind).toBe('summarized')
    expect(h.events).toContainEqual({ type: 'notice', agentId: 'a1', text: LOW_GAIN_COMPACT })
  })

  it('emits compaction-failed when an idle compaction is aborted', async () => {
    const controller = new AbortController()
    const llm: LlmClient = {
      async *stream(): AsyncGenerator<LlmStreamPart> {
        controller.abort()
        yield { kind: 'finish' }
      }
    }
    const h = harness(new RoutingLlm(() => '', () => []), longTurn(3, 200), { llm })
    const outcome = await h.runner.compactNow(undefined, controller.signal)
    expect(outcome.kind).toBe('aborted')
    expect(h.events.map(e => e.type)).toContain('compaction-failed')
    expect(texts(h.current())[0]).toBe('build the feature')
  })

  it('does not compact again on the next run because of stale provider usage', async () => {
    const usage = { input: 5000, output: 10, total: 5010 }
    const llm = new RoutingLlm(() => 'summary', () => [{ kind: 'text', text: 'ok' }, { kind: 'finish', tokens: usage }])
    const h = harness(llm, longTurn(3, 200))
    await h.runner.run()
    await h.runner.compactNow()
    await h.runner.run()
    expect(llm.prompts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "progress-based and manual"`
Expected: FAIL — missing exports (`LOW_GAIN_COMPACT`, `NOTHING_TO_COMPACT`), `compactNow`/`requestCompact` not functions, the long-turn case truncates instead of summarizing.

- [ ] **Step 3: Add the `notice` event**

In `src/shared/types.ts`, add a member to the `ChatEvent` union right after `compaction-failed` (line 266):

```ts
  | { type: 'notice'; agentId: string; text: string }
```

- [ ] **Step 4: Implement in `loop.ts`**

1. Line 11 import: replace `selectHeadTail` with `planCompaction` in the `./compact` import list (`selectHeadTail` is no longer used in `loop.ts`; keep every other name).

2. Replace `const MAX_COMPACT_PER_RUN = 2` (line 119) with:

```ts
// Cost guard only: MIN_COMPACTION_GAIN is what normally stops repeated compaction.
const MAX_COMPACT_PER_RUN = 10
const MAX_OVERFLOW_RETRIES = 2
const MIN_COMPACTION_GAIN = 0.2
export const NOTHING_TO_COMPACT = '[meow] Nothing to compact yet.'
export const LOW_GAIN_COMPACT = '[meow] Compaction saved little context — the recent steps are most of it.'

export type CompactOutcome =
  | { kind: 'summarized'; gain: number }
  | { kind: 'truncated' }
  | { kind: 'nothing' }
  | { kind: 'failed' }
  | { kind: 'aborted' }
```

3. Fields — after `private compactedThisRun = 0` add:

```ts
  // Set when an automatic compaction shrank the context by less than
  // MIN_COMPACTION_GAIN; later automatic compactions in the run only truncate.
  private compactionStalled = false
  // A /compact that arrived mid-run, honored at the next step boundary.
  private manualCompact: { focus?: string } | undefined
```

and update the `rejectRetriesThisRun` comment to say it is bounded by `MAX_OVERFLOW_RETRIES`.

4. Rename the existing `async run(signal?: AbortSignal): Promise<void>` to `private async runSteps(signal?: AbortSignal): Promise<void>`, add `this.compactionStalled = false` next to `this.compactedThisRun = 0` inside it, and add above it:

```ts
  async run(signal?: AbortSignal): Promise<void> {
    try {
      await this.runSteps(signal)
    } finally {
      this.manualCompact = undefined
    }
  }

  /** /compact during a run: compact at the next step boundary, threshold or not. */
  requestCompact(focus?: string): void {
    this.manualCompact = { focus }
  }

  /** /compact while idle: resolves the settings the way run() does, then compacts now. */
  async compactNow(focus?: string, signal?: AbortSignal): Promise<CompactOutcome> {
    this.compaction = resolveCompactionSettings(
      this.deps.compaction ?? { auto: false, tailTurns: 2 },
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      this.deps.maxOutputTokens ?? 0
    )
    this.hooks = this.deps.hooks?.()
    const outcome = await this.compact(signal, { focus })
    if (outcome.kind === 'aborted') this.deps.onEvent({ type: 'compaction-failed', agentId: this.deps.agentId })
    return outcome
  }
```

5. At the top of `compactIfOverThreshold`, before `const compaction = this.compaction`:

```ts
    const manual = this.manualCompact
    if (manual) {
      this.manualCompact = undefined
      await this.compact(signal, manual)
      return
    }
```

6. Replace the whole `private async compact(signal?: AbortSignal): Promise<void>` method with:

```ts
  private async compact(signal?: AbortSignal, manual?: { focus?: string }): Promise<CompactOutcome> {
    const compaction = this.compaction
    const { replaceItems, agentId } = this.deps
    if (!compaction || !replaceItems || (!manual && !compaction.auto)) return { kind: 'nothing' }
    const usable = this.compactionTarget(
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      compaction.buffer,
      this.deps.maxOutputTokens
    )
    const items = this.deps.getItems()
    const opts = this.toLlmOpts()
    const measure = (its: TranscriptItem[]) => estimateUsage(toLlmMessages(its, opts))
    const replace = (next: TranscriptItem[]) => {
      replaceItems(next)
      // Provider usage described the transcript just replaced.
      this.lastTokens = undefined
    }
    const shrink = (): CompactOutcome => {
      const truncated = hardTruncate(items, usable, measure)
      if (truncated === items) return { kind: 'nothing' }
      replace(truncated)
      return { kind: 'truncated' }
    }

    const plan = planCompaction(items, compaction.keepTokens, compaction.tailTurns)
    if (!plan) {
      const outcome = shrink()
      if (manual && outcome.kind === 'nothing') this.deps.onEvent({ type: 'notice', agentId, text: NOTHING_TO_COMPACT })
      return outcome
    }
    if (!manual && (this.compactionStalled || this.compactedThisRun >= MAX_COMPACT_PER_RUN)) return shrink()

    const previousSummary = this.findPreviousSummary(items)
    const summarizable = fitHeadToBudget(plan.head, usable, compaction.toolOutputMaxChars)
    const prompt = buildCompactionPrompt(
      previousSummary,
      serializeItems(summarizable, compaction.toolOutputMaxChars),
      manual?.focus
    )
    await this.hooks?.runPreCompact(manual ? 'manual' : 'auto')
    this.deps.onEvent({ type: 'compaction-start', agentId })
    const summary = await compactTranscript({ llm: this.deps.llm, model: this.deps.model, prompt, signal })
    if (signal?.aborted) return { kind: 'aborted' }
    if (!summary) {
      this.deps.onEvent({ type: 'compaction-failed', agentId })
      shrink()
      return { kind: 'failed' }
    }
    if (!manual) this.compactedThisRun++

    const now = Date.now()
    const markerItem: TranscriptItem = {
      kind: 'message',
      message: { id: randomUUID(), role: 'user', text: COMPACTION_MARKER, createdAt: now }
    }
    const summaryItem: TranscriptItem = {
      kind: 'message',
      message: { id: randomUUID(), role: 'assistant', text: summary, createdAt: now }
    }
    const before = measure(items)
    let next: TranscriptItem[] = [markerItem, summaryItem, ...plan.keep]
    // Still over after summarizing: truncate now, or the next step compacts again.
    if (measure(next) >= usable) next = hardTruncate(next, usable, measure)
    replace(next)
    this.deps.onEvent({ type: 'compacted', agentId, summary })

    const gain = before > 0 ? (before - measure(next)) / before : 0
    if (gain >= MIN_COMPACTION_GAIN) this.compactionStalled = false
    else if (manual) this.deps.onEvent({ type: 'notice', agentId, text: LOW_GAIN_COMPACT })
    else this.compactionStalled = true
    return { kind: 'summarized', gain }
  }
```

7. In `tryRecoverFromReject`, replace `MAX_COMPACT_PER_RUN` with `MAX_OVERFLOW_RETRIES` (the check and the doc comment above the method).

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "progress-based and manual"`
Expected: PASS.

- [ ] **Step 6: Run the whole loop + compact suites**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-compact.test.ts tests/unit/agent-task.test.ts`
Expected: PASS. If a pre-existing compaction test fails, check whether it asserted the old behavior the spec replaces (§4.4–4.7: a single long turn now summarizes instead of truncating; a transcript still over the target after summarizing is truncated in the same call; compaction may run more than twice). Update such a test to the new behavior and say so in the commit message; any other failure is a bug in this task — fix the code, not the test.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If an exhaustive `switch` over `ChatEvent['type']` fails, add a `notice` case that does nothing there (the renderer handles it in Task 3).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): progress-based compaction with manual compact entry points"
```

---

### Task 3: `/compact` command, manager dispatch and feed notice

**Files:**
- Modify: `src/main/agent/commands.ts` (after `NEW_COMMAND`, lines 31-37; builtin map line 159)
- Modify: `src/main/meow-agent-manager.ts` (`runCommand` 1261-1267; new `compactSession` method after `runCommand`; the no-key message at line 805)
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` (event handler near line 636)
- Test: `tests/unit/meow-agent-manager.test.ts`

**Interfaces:**
- Consumes (Task 2): `SessionRunner.requestCompact(focus?)`, `SessionRunner.compactNow(focus?, signal?)`, `ChatEvent` `notice`.
- Produces: `COMPACT_COMMAND` (name `compact`, `type: 'system'`); `MeowAgentManager.compactSession(agentId: string, focus: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/meow-agent-manager.test.ts`, add `import { COMPACTION_MARKER } from '../../src/main/agent/compact'` and `import type { SessionRunner } from '../../src/main/agent/loop'` to the imports, then add inside `describe('MeowAgentManager', ...)` right after the `/new` test (ends at line 1361):

```ts
  function runnerOf(manager: MeowAgentManager, agentId: string): SessionRunner {
    return (manager as unknown as { runners: Map<string, SessionRunner> }).runners.get(agentId)!
  }

  it('lists /compact as a built-in system command', async () => {
    const { manager } = await makeManager()
    const compact = manager.listCommands('/proj').find(c => c.name === 'compact')
    expect(compact?.type).toBe('system')
  })

  it('runs /compact while idle: summarizes with focus, no turn, no user bubble', async () => {
    const { manager, events, llmMessages } = await makeManager()
    await manager.send('a1', 'one')
    await manager.send('a1', 'two')
    await manager.send('a1', 'three')
    events.length = 0
    await manager.runCommand('a1', 'compact', 'keep the plan')
    const types = events.map(e => e.type)
    expect(types).toEqual(expect.arrayContaining(['compaction-start', 'compacted']))
    expect(types).not.toContain('turn-started')
    expect(types).not.toContain('user-message')
    expect(manager.isRunning('a1')).toBe(false)
    expect(manager.listMessages('a1')[0]?.text).toBe(COMPACTION_MARKER)
    expect(JSON.stringify(llmMessages[llmMessages.length - 1])).toContain('keep the plan')
  })

  it('queues a prompt sent during an idle /compact and runs it afterwards', async () => {
    const { manager, events } = await makeManager()
    const gate = deferred<void>()
    const spy = vi.spyOn(runnerOf(manager, 'a1'), 'compactNow').mockImplementation(async () => {
      await gate.promise
      return { kind: 'nothing' }
    })
    const p = manager.runCommand('a1', 'compact', '')
    await new Promise(r => setTimeout(r, 10))
    expect(manager.isRunning('a1')).toBe(true)
    await manager.send('a1', 'while compacting')
    expect(manager.listQueued('a1').map(q => q.text)).toContain('while compacting')
    gate.resolve()
    await p
    expect(spy).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
    expect(events.some(e => e.type === 'user-message' && e.message.text.includes('while compacting'))).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('stop() aborts an idle /compact', async () => {
    const { manager } = await makeManager()
    let seen: AbortSignal | undefined
    vi.spyOn(runnerOf(manager, 'a1'), 'compactNow').mockImplementation(async (_focus, signal) => {
      seen = signal
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }))
      return { kind: 'aborted' }
    })
    const p = manager.runCommand('a1', 'compact', '')
    await new Promise(r => setTimeout(r, 10))
    manager.stop('a1')
    await p
    expect(seen?.aborted).toBe(true)
    expect(manager.isRunning('a1')).toBe(false)
  })

  it('defers /compact to the next step when a turn is running', async () => {
    const { manager, events } = await makeManager({ hangUntilAbort: true })
    const spy = vi.spyOn(runnerOf(manager, 'a1'), 'requestCompact')
    const run = manager.send('a1', 'first')
    await new Promise<void>(resolve => {
      const t = setInterval(() => {
        if (events.some(e => e.type === 'turn-started')) { clearInterval(t); resolve() }
      }, 5)
    })
    await manager.runCommand('a1', 'compact', 'focus text')
    expect(spy).toHaveBeenCalledWith('focus text')
    manager.stop('a1')
    await run
  })

  it('reports a missing API key instead of compacting', async () => {
    const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-nokey-'))
    const configPath = path.join(cfgDir, 'meow.json')
    writeFileSync(configPath, JSON.stringify({ provider: { test: { models: ['test-model'] } }, model: 'test' }))
    const { manager, events } = await makeManager({ configPath })
    await manager.runCommand('a1', 'compact', '')
    const error = events.find(e => e.type === 'error') as Extract<ChatEvent, { type: 'error' }> | undefined
    expect(error?.message).toContain('No provider/API key configured')
    expect(manager.isRunning('a1')).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "compact"`
Expected: FAIL — `compact` is not a listed command (`[meow] Command "compact" not found.`).

- [ ] **Step 3: Add the command**

In `src/main/agent/commands.ts`, after `NEW_COMMAND`:

```ts
export const COMPACT_COMMAND: Command = {
  name: 'compact',
  description: 'Summarize older context to free up space',
  template: '',
  type: 'system',
  builtIn: true
}
```

and add `COMPACT_COMMAND` right after `NEW_COMMAND` in the `builtin` map array on line 159.

- [ ] **Step 4: Implement `compactSession` in the manager**

1. Near the top of `src/main/meow-agent-manager.ts` (after the imports), add:

```ts
const NO_API_KEY_MESSAGE = '[meow] No provider/API key configured. Open Settings, add a provider (id + API key + models) and try again.'
```

and use it in `runTurnInner` (line 805: `run.error = NO_API_KEY_MESSAGE`).

2. In `runCommand`, change the `system` branch to:

```ts
    if (command.type === 'system') {
      if (command.name === 'new') {
        this.newSession(agentId)
        this.emit({ type: 'session-created', agentId })
      } else if (command.name === 'compact') {
        await this.compactSession(agentId, args.trim())
      }
      return
    }
```

3. Add after `runCommand`:

```ts
  // /compact: mid-turn it is honored at the next step boundary; idle it claims
  // the running slot so prompts sent meanwhile queue behind it and stop() aborts it.
  async compactSession(agentId: string, focus: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent) return
    let runner = this.runners.get(agentId)
    if (!runner) {
      await this.register(agent)
      runner = this.runners.get(agentId)
    }
    if (!runner) return
    if (this.running.has(agentId)) {
      runner.requestCompact(focus || undefined)
      return
    }
    if (!this.resolved.get(agentId)?.apiKey) {
      this.emit({ type: 'error', agentId, message: NO_API_KEY_MESSAGE })
      return
    }
    const controller = new AbortController()
    this.running.add(agentId)
    this.compacting.add(agentId)
    this.controllers.set(agentId, controller)
    try {
      await runner.compactNow(focus || undefined, controller.signal)
    } finally {
      this.running.delete(agentId)
      this.compacting.delete(agentId)
      if (this.controllers.get(agentId) === controller) this.controllers.delete(agentId)
    }
    await this.drainQueue(agentId)
  }
```

(`compacting` and `controllers` already exist: see `maybeCompactIdle` and `stop`.)

- [ ] **Step 5: Render the notice in the chat feed**

In `src/renderer/src/components/chat/ChatPanel.tsx`, add right before `if (e.type === 'compaction-start') {` (line 636):

```tsx
    if (e.type === 'notice') {
      setItems(prev => [...prev, { kind: 'notice', id: 'n-' + Date.now(), text: e.text }])
      return
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and full suite**

Run: `npm run typecheck` then `npm test`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/commands.ts src/main/meow-agent-manager.ts src/renderer/src/components/chat/ChatPanel.tsx tests/unit/meow-agent-manager.test.ts
git commit -m "feat(agent): add /compact to summarize context on demand"
```

---

### Task 4: Documentation sync

**Files:**
- Modify: `src/main/agent/AGENTS.md` (rows `loop.ts`, `commands.ts`, `compact.ts`)
- Modify: `src/main/AGENTS.md` (`meow-agent-manager.ts` bullet)
- Modify: `src/renderer/src/components/chat/AGENTS.md` (`ChatPanel.tsx` row)
- Modify: `docs/reference/01-product-overview.md:61`, `02-architecture.md:125`, `03-agent-runtime.md` (228, 379-408, 606), `05-ipc-contract.md` (after 229), `11-conventions-and-pitfalls.md:211`
- Modify: `docs/superpowers/specs/2026-09-28-manual-compact-design.md` (status line)

Edit only the entries named; keep each file's format (AGENTS.md sync rule).

- [ ] **Step 1: `src/main/agent/AGENTS.md`**
  - `compact.ts` row: after `` `fitHeadToBudget` (keeps the summary prompt inside the window), `` insert `` `planCompaction` / `splitWithinTurn` (when turn-level compaction has no head, summarize the older steps of the last turn and keep its request verbatim; cuts only at step starts), `buildCompactionPrompt` (optional `<focus>` block from `/compact`), `` and change the `hardTruncate` text to `` `hardTruncate` (last-resort shrink when LLM compaction cannot help; drops whole turns, then the oldest steps of an oversized final turn) ``.
  - `loop.ts` row: append `` Compaction is progress-based: `compact()` returns a `CompactOutcome`, truncates in the same call when the summarized transcript is still over the target, and sets `compactionStalled` (automatic compaction then only truncates) when a compaction shrinks the context by < `MIN_COMPACTION_GAIN` (20%); `MAX_COMPACT_PER_RUN` (10) is a cost guard, overflow retries use `MAX_OVERFLOW_RETRIES` (2); `lastTokens` is cleared whenever compaction replaces the transcript. `requestCompact(focus?)` (mid-run `/compact`, honored at the next step boundary, dropped at run end) and `compactNow(focus?, signal?)` (idle `/compact`, works with auto off, ignores the stall flag) are the manual entry points; they emit `notice` events for "nothing to compact" / "low gain". `` before the closing `|`.
  - `commands.ts` row: change `built-ins (init/review/Superpowers skills)` to `built-ins (init/review/Superpowers skills; system commands `new` and `compact`, dispatched by the manager)`.

- [ ] **Step 2: `src/main/AGENTS.md`** — in the `meow-agent-manager.ts` bullet, after the sentence ending `…falls back to the active project path, so \`@\`-file completion works before the session exists.`, add: `` `compactSession(agentId, focus)` backs `/compact`: mid-turn it calls `runner.requestCompact`; idle it claims `running` + `compacting` and a controller (so sends queue and `stop()` aborts), runs `runner.compactNow`, then drains the queue. ``

- [ ] **Step 3: `src/renderer/src/components/chat/AGENTS.md`** — in the `ChatPanel.tsx` row, after `Transient status lines (compaction, retry) live only in feed state — never written to the transcript.` add ` A `notice` ChatEvent (e.g. `/compact`'s "Nothing to compact yet.") appends a feed-only `notice` row.`

- [ ] **Step 4: Reference pages**
  - `01-product-overview.md:61`: `` Built-ins `/init`, `/review`, `/new`, `/compact`, `/frontend-design`, … `` (insert `/compact` after `/new`).
  - `02-architecture.md:125`: add `` `planCompaction`, `splitWithinTurn`, `` after `` `selectHeadTail`, ``.
  - `03-agent-runtime.md:228`: replace the row with two rows: `` | `MAX_COMPACT_PER_RUN` (cost guard) | 10 | `loop.ts` | `` and `` | `MAX_OVERFLOW_RETRIES` | 2 | `loop.ts` | ``, and add `` | `MIN_COMPACTION_GAIN` | 0.2 | `loop.ts` | ``.
  - `03-agent-runtime.md` ladder (379-396): in step 1 after the `selectHeadTail` bullet add `` - When that head is empty (one long turn), `splitWithinTurn` summarizes the older steps of the last turn instead: the result is `[marker, summary, original request, recent steps…]`, cut only at step starts so no tool result loses its assistant message. ``; after the `On success` bullet add `` - If the result is still over the target it is hard-truncated in the same call. A compaction that shrinks the context by less than `MIN_COMPACTION_GAIN` (20%) marks the run stalled: later automatic compactions in that run only truncate. `MAX_COMPACT_PER_RUN` (10) is a cost guard. `lastTokens` is cleared on every replacement so stale provider usage cannot re-trigger compaction. ``; in step 2 replace `the per-run compaction budget (\`MAX_COMPACT_PER_RUN = 2\`) is spent` with `the run is stalled or the cost guard is spent` and replace `always keeping the final turn even if it alone exceeds the target` with `then the oldest steps of the final turn, always keeping its request and last step`.
  - `03-agent-runtime.md:407`: `Bounded by \`MAX_OVERFLOW_RETRIES\` (2)`.
  - `03-agent-runtime.md` after the "Idle compaction" section add a `### Manual compaction (\`/compact\`)` subsection: `` `/compact [focus]` is a system command. Mid-turn, `requestCompact` makes the next step boundary compact regardless of the threshold. Idle, the manager claims the running slot (prompts queue, `stop()` aborts, `compaction-failed` is emitted on abort) and calls `compactNow`. Manual compaction runs even with auto-compaction off, ignores the stall flag and cost guard, passes the focus text to the summary prompt as a `<focus>` block, runs `PreCompact` hooks with trigger `manual`, and emits a `notice` when there is nothing to compact or the gain is below 20%. ``
  - `03-agent-runtime.md:606`: add a row after `/new`: `` | `/compact [focus]` | **system** | Summarizes older context now (next step boundary if a turn is running); never creates a user message | ``
  - `05-ipc-contract.md`: after the `compaction-failed` row add `` | `notice` | `text: string` | Feed-only notice (e.g. `/compact` had nothing to do); never persisted | ``.
  - `11-conventions-and-pitfalls.md:211`: `` | Context overflow loops | `MAX_OVERFLOW_RETRIES`, `MIN_COMPACTION_GAIN` stall flag, `tryRecoverFromReject`, `hardTruncate` | ``.

- [ ] **Step 5: Spec status** — change `Status: pending review` to `Status: implemented` in the spec.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck` and `npm test` — expected PASS.

```bash
git add src/main/agent/AGENTS.md src/main/AGENTS.md src/renderer/src/components/chat/AGENTS.md docs/reference docs/superpowers/specs/2026-09-28-manual-compact-design.md
git commit -m "docs: document /compact and progress-based compaction"
```
