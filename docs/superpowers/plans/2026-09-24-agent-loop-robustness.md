# Agent Loop Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop character loops, tool-call floods and busy-polling in the native agent loop on
open models served through OpenAI-compatible endpoints, without changing Anthropic/Google
behavior beyond an always-sent output cap.

**Architecture:** `SessionRunner` (`src/main/agent/loop.ts`) stays the orchestrator. The new
behavior lives in small pure modules:

- `response-guard.ts` checks each streamed part;
- `repetition.ts` holds the tandem-repeat and tool-loop detectors;
- `tool-scheduler.ts` batches tool calls;
- `harness-note.ts` builds the `[meow]` notes attached to tool results;
- `sampling.ts` holds sampling presets.

The loop wires them together, emits two new display-only `ChatEvent`s, and the renderer uses
them to open one bubble per step.

**Tech Stack:** Electron 41, TypeScript strict, AI SDK v6 (`ai` 6.0.x,
`@ai-sdk/openai-compatible` 2.x), zod, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-09-24-agent-loop-robustness-design.md`. Read it before
starting. This plan implements it section by section.

## Global Constraints

- Source code, UI labels, test names, docs and commit messages are in **English**.
- Git commits: **do not** add a `Co-Authored-By` trailer (project rule in `AGENTS.md`).
- Do not add comments except to explain a non-obvious decision. Match the surrounding comment
  density.
- IPC: no new channel strings. The two new `ChatEvent` members travel on the existing chat
  event channel.
- Tests never hit a real LLM. Use the stubs in `tests/unit/agent-loop.test.ts` and the
  `vi.mock('ai')` setup in `tests/unit/agent-llm.test.ts`.
- `DEFAULT_OUTPUT_WIRE_CAP = 32000`, `MAX_TOOL_CALLS_PER_RESPONSE = 32`,
  `MAX_TOOL_CONCURRENCY = 10`, `MAX_LOOP_BREAKS = 2` (unchanged),
  `ANTI_REPETITION_FREQUENCY_PENALTY = 0.5`.
- `bash_output` `wait_s`: default 15, clamped to 0–300.
- Repeat detector: anchor 32, up to 16 anchor candidates, check every 64 normalized chars,
  period ≤ 1024, tail 8192, short period (≤ 16) span ≥ 256, long period copies ≥ 3 and span ≥ 200.
- Every code change updates the matching `AGENTS.md` entry and `docs/reference/*` page in the
  same commit. Only touch the entries that changed; keep each file's existing format.
- Run all commands from the repo root `C:\Users\doanp\Documents\GitHub\meow-coding`.
  Single test file: `npx vitest run <path>`.

## Review Focus

Inputs the spec implies but that are easy to miss. Each one has a test in the task named.

1. **Legitimate repetitive code in an answer.** Four near-identical test cases, separator lines
   (`────`, `====`, `|---|`), or indentation must never trip the stream guard (Task 2,
   Task 9).
2. **A repetition verdict after tool calls were already announced.** The announced calls must
   still run and get results, with no dangling `tool-start` (Task 9, "treats repetition after a
   tool call as a cut").
3. **The anti-repetition retry against a model with no preset.** No `frequencyPenalty` may be
   sent, because OpenAI/Codex reasoning models reject it (Task 6, "does not add a penalty for an
   unmatched model").
4. **`bash_output` while the user presses Stop.** The wait must end immediately and leave no
   listeners on the store (Task 8, "stops waiting on abort" + listener-count assertions).
5. **Two bubbles created in the same millisecond.** Bubble ids must stay unique so React keys do
   not collide after `step-start` (Task 10 uses a sequence counter in the id).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/agent/config.ts` | modify | `DEFAULT_OUTPUT_WIRE_CAP`, `resolveWireOutputTokens`, `sampling` key normalize/round-trip |
| `src/main/agent/repetition.ts` | rewrite | `repeatDetector` (tandem repeat), `toolLoopDetector` (verdict API), `isIdlePoll` |
| `src/main/agent/response-guard.ts` | create | Per-step stream guard: tool flood, interleaving, repetition |
| `src/main/agent/tool-scheduler.ts` | create | `scheduleBatches`, `runWithConcurrency`, `MAX_TOOL_CONCURRENCY` |
| `src/main/agent/harness-note.ts` | create | `harnessNote`, `attachNote`, `cutNote`, `toolLoopNote` |
| `src/main/agent/sampling.ts` | create | Presets, overrides, anti-repetition penalty |
| `src/main/agent/llm.ts` | modify | Sampling on the OpenAI-compatible branch, `antiRepetition`, invalid tool-call mapping |
| `src/main/agent/message.ts` | modify | Current-turn-only reasoning replay; drop stub `execute` |
| `src/main/agent/background-process-store.ts` | modify | `waitForNew` |
| `src/main/agent/tools/bash.ts` | modify | `bash_output` `wait_s` |
| `src/main/agent/tools/types.ts` | modify | `ToolDefinition.concurrencySafe` |
| `src/main/agent/tools/{read,glob,grep,webfetch,websearch,lsp,skill,task}.ts` | modify | `concurrencySafe: true` |
| `src/main/agent/tools/task.ts` | modify | Pass the output wire cap to subagents |
| `src/main/agent/loop.ts` | modify | Guard, retry, scheduler, notes, events |
| `src/main/meow-agent-manager.ts` | modify | Wire cap + sampling wiring |
| `src/shared/types.ts` | modify | `step-start`, `step-discarded` events |
| `src/renderer/src/components/chat/ChatPanel.tsx` | modify | New bubble per step, discard handling |

---

### Task 1: Always send a bounded `max_tokens`

**Files:**
- Modify: `src/main/agent/config.ts` (after `resolveOutputTokens`, ~line 112)
- Modify: `src/main/meow-agent-manager.ts` (import block lines 5-12; lines ~1407-1410, ~1482-1491, ~1625)
- Modify: `src/main/agent/tools/task.ts` (opts interface ~line 60, runner construction ~line 160)
- Create: `tests/unit/agent-output-wire.test.ts`
- Modify: `tests/unit/meow-agent-manager.test.ts`
- Docs: `src/main/agent/AGENTS.md`, `docs/reference/03-agent-runtime.md`,
  `docs/reference/06-data-and-storage.md`, `docs/reference/07-providers-and-connections.md`

**Interfaces:**
- Produces: `DEFAULT_OUTPUT_WIRE_CAP: 32000` and
  `resolveWireOutputTokens(limitOutput: number | null | undefined, override?: number): number`
  from `src/main/agent/config.ts`. Also `createTaskTool` opts gains
  `maxOutputTokensWire?: number`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/agent-output-wire.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUT_WIRE_CAP, resolveWireOutputTokens } from '../../src/main/agent/config'

describe('resolveWireOutputTokens', () => {
  it('sends the 32k cap when no limit is known', () => {
    expect(DEFAULT_OUTPUT_WIRE_CAP).toBe(32000)
    expect(resolveWireOutputTokens(null)).toBe(32000)
    expect(resolveWireOutputTokens(undefined)).toBe(32000)
  })

  it('never sends more than the cap even when the model allows more', () => {
    expect(resolveWireOutputTokens(131072)).toBe(32000)
  })

  it('keeps a smaller known or learned limit', () => {
    expect(resolveWireOutputTokens(8192)).toBe(8192)
  })

  it('passes an explicit meow.json override through unchanged', () => {
    expect(resolveWireOutputTokens(8192, 50000)).toBe(50000)
    expect(resolveWireOutputTokens(null, 4096)).toBe(4096)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/agent-output-wire.test.ts`
Expected: FAIL. `resolveWireOutputTokens` is not exported.

- [ ] **Step 3: Implement in `config.ts`**

Insert directly after the closing `}` of `resolveOutputTokens`:

```ts
// Sent as max_tokens on every request. Without a bound, a model that falls into
// a repetition loop keeps generating until the context window is full.
export const DEFAULT_OUTPUT_WIRE_CAP = 32000

export function resolveWireOutputTokens(limitOutput: number | null | undefined, override?: number): number {
  if (override !== undefined) return override
  return Math.min(limitOutput ?? DEFAULT_OUTPUT_WIRE_CAP, DEFAULT_OUTPUT_WIRE_CAP)
}
```

- [ ] **Step 4: Run the unit test and confirm it passes**

Run: `npx vitest run tests/unit/agent-output-wire.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing manager test**

In `tests/unit/meow-agent-manager.test.ts`, inside `makeManager`:

1. After `const llmModels: string[] = []` add:
   `const llmOutputCaps: Array<number | undefined> = []`
2. Inside `stream(request)`, after `llmModels.push(request.model)` add:
   `llmOutputCaps.push(request.maxOutputTokens)`
3. Add `llmOutputCaps` to the object returned by `makeManager`, after `llmModels`.

Append this block at the end of the file:

```ts
describe('MeowAgentManager output cap', () => {
  it('always sends a bounded max_tokens when no limit is configured or known', async () => {
    const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-wire-'))
    const cfgPath = path.join(cfgDir, 'meow.json')
    writeFileSync(cfgPath, JSON.stringify({
      provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
      model: 'test'
    }))
    const { manager, llmOutputCaps } = await makeManager({ configPath: cfgPath })
    await manager.send('a1', 'hello')
    expect(llmOutputCaps[0]).toBe(32000)
  })

  it('passes an explicit maxOutputTokens override through unchanged', async () => {
    const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-wire-'))
    const cfgPath = path.join(cfgDir, 'meow.json')
    writeFileSync(cfgPath, JSON.stringify({
      provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
      model: 'test',
      maxOutputTokens: 50000
    }))
    const { manager, llmOutputCaps } = await makeManager({ configPath: cfgPath })
    await manager.send('a1', 'hello')
    expect(llmOutputCaps[0]).toBe(50000)
  })
})
```

- [ ] **Step 6: Run it and confirm the first test fails**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "output cap"`
Expected: FAIL. The first test receives `undefined`; the second already passes.

- [ ] **Step 7: Wire the manager**

In `src/main/meow-agent-manager.ts`:

1. In the `from './agent/config'` import block, change the line `resolveOutputTokens,` to
   `resolveOutputTokens, resolveWireOutputTokens,`.
2. Replace

```ts
    const outputWire = limits.output
    // Reserve = wire đã xác minh (hoặc 32k) — chỉ cho compaction/footer, không
    // phải giá trị gửi provider.
    const outputReserve = resolveOutputTokens({ output: outputWire ?? undefined }, contextTokens, DEFAULT_MAX_OUTPUT_TOKENS)
```

   with

```ts
    const outputWire = resolveWireOutputTokens(limits.output, cfg.maxOutputTokens)
    // The reserve (compaction budget + footer) follows what is actually sent.
    const outputReserve = resolveOutputTokens({ output: outputWire }, contextTokens, DEFAULT_MAX_OUTPUT_TOKENS)
```

3. In the `new SessionRunner({ ... })` call, change `maxOutputTokensWire: outputWire ?? undefined,`
   to `maxOutputTokensWire: outputWire,`.
4. In the `createTaskTool({ ... })` call, after the line `maxOutputTokens: outputReserve,` add
   `maxOutputTokensWire: outputWire,`.

- [ ] **Step 8: Pass the cap to subagents**

In `src/main/agent/tools/task.ts`:

1. Add the import `import { DEFAULT_OUTPUT_WIRE_CAP } from '../config'` after the line
   `import type { HooksRunner } from '../hooks'`.
2. In the `createTaskTool(opts: { ... })` parameter type, after `maxOutputTokens?: number` add:

```ts
  // Sent as max_tokens for the parent's model. A subagent on a different model
  // gets the default cap instead; a lower real limit is learned on rejection.
  maxOutputTokensWire?: number
```

3. In the subagent `new SessionRunner({ ... })`, after `maxOutputTokens: opts.maxOutputTokens,` add:

```ts
      maxOutputTokensWire: role.model || sub ? DEFAULT_OUTPUT_WIRE_CAP : opts.maxOutputTokensWire,
```

- [ ] **Step 9: Run the tests and typecheck**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts tests/unit/agent-output-wire.test.ts tests/unit/agent-task-tool.test.ts tests/unit/agent-task.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Update docs**

1. `docs/reference/06-data-and-storage.md`: replace
   `"maxOutputTokens": 32000,     // optional override; absent = omit max_tokens (provider decides)`
   with
   `"maxOutputTokens": 32000,     // optional override; absent = min(known model limit, 32000) is sent`.
2. `docs/reference/07-providers-and-connections.md` §7.3: replace the paragraph starting
   `**\`output: null\` means omit \`max_tokens\` from the request entirely.**` (2 lines) with:

```md
**`output: null` means no source knows the cap.** The request still carries a bound:
`resolveWireOutputTokens(output, override)` sends the `maxOutputTokens` override unchanged, else
`min(output ?? 32000, 32000)` (`DEFAULT_OUTPUT_WIRE_CAP`). A real cap below that is learned from
the provider's `max_tokens exceeds` rejection (see *Learning from errors*).
```

3. `docs/reference/03-agent-runtime.md` §3.9: replace the paragraph
   `` `output: null` means *omit `max_tokens` entirely* and let the provider choose — that request can
   never fail with "max_tokens exceeds". `` with:

```md
`output: null` means no source knows the cap. `max_tokens` is still always sent:
`resolveWireOutputTokens` picks the override, else `min(output ?? 32000, 32000)`, so a looping
model can never generate until the context is full. Subagents on a different model get the 32k
default.
```

   In the table below it, change the `maxOutputTokensWire` row meaning to
   `The value sent to the provider as max_tokens (resolveWireOutputTokens); always set by the manager`.
4. `src/main/agent/AGENTS.md`, `config.ts` row: after the sentence
   ``maxOutputTokens` is an optional override too (absent = omit `max_tokens`, provider decides).``
   replace that sentence with:
   ``maxOutputTokens` is an optional override too; `resolveWireOutputTokens` always sends a bound (override, else `min(known limit, DEFAULT_OUTPUT_WIRE_CAP = 32000)`).``

- [ ] **Step 11: Commit**

```bash
git add src/main/agent/config.ts src/main/meow-agent-manager.ts src/main/agent/tools/task.ts tests/unit/agent-output-wire.test.ts tests/unit/meow-agent-manager.test.ts src/main/agent/AGENTS.md docs/reference/03-agent-runtime.md docs/reference/06-data-and-storage.md docs/reference/07-providers-and-connections.md
git commit -m "feat(agent): always send a bounded max_tokens (32k default cap)"
```

---

### Task 2: Tandem-repeat detector

**Files:**
- Modify: `src/main/agent/repetition.ts` (add `repeatDetector`; keep `loopDetector` for now,
  because `loop.ts` still imports it until Task 9)
- Modify: `tests/unit/repetition.test.ts`

**Interfaces:**
- Produces: `repeatDetector(): RepeatDetector`, where `RepeatDetector.push(delta: string): RepeatHit | null`
  and `RepeatHit = { keepChars: number }`. `keepChars` is an index into the raw text fed so far:
  keep `raw.slice(0, keepChars)`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/repetition.test.ts`:

1. Change the import to
   `import { loopDetector, repeatDetector, toolLoopDetector } from '../../src/main/agent/repetition'`.
2. Append this block at the end of the file:

```ts
function feedRepeat(chunks: string[]): { fed: string; kept: string } | null {
  const d = repeatDetector()
  let fed = ''
  for (const c of chunks) {
    fed += c
    const hit = d.push(c)
    if (hit) return { fed, kept: fed.slice(0, hit.keepChars) }
  }
  return null
}

function chunked(s: string, size = 7): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

describe('repeatDetector', () => {
  it('flags a character-level loop with no word boundaries and keeps the clean prefix', () => {
    const prefix = 'Now let me add a test for the getter. '
    const r = feedRepeat([prefix, ...Array<string>(200).fill('counselor')])
    expect(r).not.toBeNull()
    expect(r!.kept.startsWith(prefix)).toBe(true)
    expect(r!.kept.length - prefix.length).toBeLessThan(40)
  })

  it('flags a repeated Vietnamese sentence', () => {
    const sentence = 'Tôi sẽ kiểm tra lại tệp cấu hình trước khi chạy lệnh build. '
    const r = feedRepeat(chunked(sentence.repeat(6)))
    expect(r).not.toBeNull()
    expect(r!.kept.startsWith(sentence)).toBe(true)
  })

  it('flags a cycle of paraphrased sentences that share an ending', () => {
    const r = feedRepeat(Array.from({ length: 20 }, (_, i) => LOOP_SENTENCES[i % LOOP_SENTENCES.length]))
    expect(r).not.toBeNull()
  })

  it('flags a paragraph repeated back to back', () => {
    const para = 'The deploy script builds the backend, then uploads the static bundle to nginx and restarts pm2. '
    expect(feedRepeat(chunked(para.repeat(5)))).not.toBeNull()
  })

  it('does not flag near-identical code', () => {
    const code = ['alpha', 'beta', 'gamma', 'delta'].map(n =>
      `  it('renders the ${n} panel when the store flag is set to true', () => {\n` +
      `    const wrapper = mount(BaseSidePanel, { props: { panelId: '${n}', open: true } })\n` +
      `    expect(wrapper.find('[data-test="side-panel"]').exists()).toBe(true)\n  })\n`
    ).join('')
    expect(feedRepeat(chunked(code))).toBeNull()
  })

  it('does not flag separator lines, table rules, or indentation', () => {
    const text = '─'.repeat(400) + '\n' + '='.repeat(400) + '\n' + ' '.repeat(400) + '|---|---|\n'.repeat(40)
    expect(feedRepeat(chunked(text))).toBeNull()
  })

  it('does not flag two identical lines of code', () => {
    const text = '    expect(a).toBe(true)\n'.repeat(2) + 'and then the rest of a perfectly ordinary answer follows here.'
    expect(feedRepeat(chunked(text))).toBeNull()
  })

  it('does not flag a long, genuinely varied reasoning stream', () => {
    expect(feedRepeat(variedReasoningChunks(80, 7))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/repetition.test.ts`
Expected: FAIL. `repeatDetector` is not exported.

- [ ] **Step 3: Implement `repeatDetector`**

In `src/main/agent/repetition.ts`, insert this block right after the closing `}` of
`loopDetector` and before the `/** Degenerate "tool loop" guard.` comment:

```ts
/**
 * Tandem-repeat guard for one streamed channel (text or reasoning).
 *
 * A degenerate model re-emits the same span back to back — "counselorcounselor…"
 * or one paragraph over and over. Only such consecutive repeats at the tail are
 * flagged, compared per character so any script works and no word boundaries are
 * needed. Content that merely looks alike (test cases differing in one name) is
 * not a tandem repeat and passes.
 */
const REPEAT_ANCHOR = 32
const REPEAT_CHECK_EVERY = 64
const REPEAT_MAX_PERIOD = 1024
// Paraphrased openers that share an ending make the nearest anchor occurrence a
// sub-period; walking back a few occurrences finds the real period.
const REPEAT_MAX_CANDIDATES = 16
const REPEAT_TAIL = 8192
const REPEAT_SHORT_PERIOD = 16
const REPEAT_SHORT_MIN_SPAN = 256
const REPEAT_LONG_MIN_COPIES = 3
const REPEAT_LONG_MIN_SPAN = 200
const MEANINGFUL = /[\p{L}\p{N}]/u
const WHITESPACE = /\s/u

export interface RepeatHit {
  /** Raw length to keep: everything before the repeat plus one copy of it. */
  keepChars: number
}

export interface RepeatDetector {
  push(delta: string): RepeatHit | null
}

export function repeatDetector(): RepeatDetector {
  let rawLength = 0
  let norm = ''
  // norm index → raw index, so a hit found on normalized text maps back.
  const rawIndex: number[] = []
  let prevSpace = false
  let lastCheck = 0

  const copiesAt = (p: number, end: number, floor: number): number => {
    const unit = norm.slice(end - p, end)
    let copies = 1
    while (end - (copies + 1) * p >= floor && norm.slice(end - (copies + 1) * p, end - copies * p) === unit) copies++
    return copies
  }

  const check = (): RepeatHit | null => {
    const end = norm.length
    const floor = Math.max(0, end - REPEAT_TAIL)
    if (end - floor < REPEAT_ANCHOR * 2) return null
    const anchor = norm.slice(end - REPEAT_ANCHOR)
    let from = end - REPEAT_ANCHOR - 1
    for (let c = 0; c < REPEAT_MAX_CANDIDATES && from >= floor; c++) {
      const idx = norm.lastIndexOf(anchor, from)
      if (idx < floor) break
      const p = end - REPEAT_ANCHOR - idx
      if (p > REPEAT_MAX_PERIOD) break
      if (MEANINGFUL.test(norm.slice(end - p, end))) {
        const copies = copiesAt(p, end, floor)
        const span = copies * p
        const hit = p <= REPEAT_SHORT_PERIOD
          ? span >= REPEAT_SHORT_MIN_SPAN
          : copies >= REPEAT_LONG_MIN_COPIES && span >= REPEAT_LONG_MIN_SPAN
        if (hit) {
          const keepNorm = end - span + p
          return { keepChars: keepNorm < rawIndex.length ? rawIndex[keepNorm] : rawLength }
        }
      }
      from = idx - 1
    }
    return null
  }

  return {
    push(delta: string): RepeatHit | null {
      for (const ch of delta) {
        const at = rawLength
        rawLength += ch.length
        if (WHITESPACE.test(ch)) {
          if (prevSpace) continue
          prevSpace = true
          norm += ' '
          rawIndex.push(at)
          continue
        }
        prevSpace = false
        const low = ch.toLowerCase()
        norm += low
        for (let k = 0; k < low.length; k++) rawIndex.push(at)
      }
      if (norm.length - lastCheck < REPEAT_CHECK_EVERY) return null
      lastCheck = norm.length
      return check()
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/repetition.test.ts`
Expected: PASS. The new `repeatDetector` tests pass and the old `loopDetector`/`toolLoopDetector`
tests are still green.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/repetition.ts tests/unit/repetition.test.ts
git commit -m "feat(agent): add a character-level tandem-repeat detector"
```

(No docs change yet: the detector is wired in Task 9, which updates the docs.)

---

### Task 3: Tool-loop detector with verdicts

**Files:**
- Modify: `src/main/agent/repetition.ts` (the `toolLoopDetector` section)
- Modify: `src/main/agent/loop.ts` (one call site, ~lines 439-447)
- Modify: `tests/unit/repetition.test.ts` (the `describe('toolLoopDetector')` block)

**Interfaces:**
- Produces, from `src/main/agent/repetition.ts`:

```ts
export interface ToolObservation { tool: string; input: unknown; output?: string; error?: string; mutationDigest?: string }
export type ToolLoopVerdict = { kind: 'ok' } | { kind: 'poll' | 'repeat'; tool: string; count: number }
export interface ToolLoopDetector { observe(call: ToolObservation): ToolLoopVerdict; reset(): void }
export function toolLoopDetector(opts?: { history?: number; minRepeats?: number }): ToolLoopDetector
export function isIdlePoll(call: ToolObservation): boolean
```

- [ ] **Step 1: Replace the tool-loop tests**

In `tests/unit/repetition.test.ts`:

1. Change the import to
   `import { isIdlePoll, loopDetector, repeatDetector, toolLoopDetector } from '../../src/main/agent/repetition'`.
2. Replace the whole `describe('toolLoopDetector', () => { ... })` block with:

```ts
describe('toolLoopDetector', () => {
  const read = (file: string, output = 'content') => ({ tool: 'read', input: { file_path: file }, output })

  it('reports the same call with the same result three times as a repeat', () => {
    const d = toolLoopDetector()
    expect(d.observe(read('a.ts'))).toEqual({ kind: 'ok' })
    expect(d.observe(read('a.ts'))).toEqual({ kind: 'ok' })
    expect(d.observe(read('a.ts'))).toEqual({ kind: 'repeat', tool: 'read', count: 3 })
  })

  it('does not flag the same tool with different input', () => {
    const d = toolLoopDetector()
    for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) expect(d.observe(read(f)).kind).toBe('ok')
  })

  it('does not flag the same call when its result changes (progress)', () => {
    const d = toolLoopDetector()
    for (const out of ['1 failing', '2 failing', '0 failing']) {
      expect(d.observe({ tool: 'bash', input: { command: 'npm test' }, output: out }).kind).toBe('ok')
    }
  })

  it('does not flag different tools', () => {
    const d = toolLoopDetector()
    expect(d.observe(read('a.ts')).kind).toBe('ok')
    expect(d.observe({ tool: 'grep', input: { pattern: 'x' }, output: 'hit' }).kind).toBe('ok')
    expect(d.observe({ tool: 'bash', input: { command: 'ls' }, output: 'a' }).kind).toBe('ok')
  })

  it('forgets old fingerprints once they slide out of the window', () => {
    const d = toolLoopDetector({ history: 2, minRepeats: 3 })
    expect(d.observe(read('a.ts')).kind).toBe('ok')
    expect(d.observe(read('a.ts')).kind).toBe('ok')
    expect(d.observe(read('b.ts')).kind).toBe('ok')
    expect(d.observe(read('c.ts')).kind).toBe('ok')
    expect(d.observe(read('a.ts')).kind).toBe('ok')
  })

  it('reports idle bash_output polling as a poll', () => {
    const d = toolLoopDetector()
    const poll = { tool: 'bash_output', input: { id: '7285d08b' }, output: '<bash id="7285d08b" status="running">\n(no new output)\n</bash>' }
    expect(d.observe(poll).kind).toBe('ok')
    expect(d.observe(poll).kind).toBe('ok')
    expect(d.observe(poll)).toEqual({ kind: 'poll', tool: 'bash_output', count: 3 })
  })

  it('starts counting again after reset', () => {
    const d = toolLoopDetector()
    d.observe(read('a.ts'))
    d.observe(read('a.ts'))
    d.reset()
    expect(d.observe(read('a.ts')).kind).toBe('ok')
  })
})

describe('isIdlePoll', () => {
  it('matches only a running shell with no new output', () => {
    expect(isIdlePoll({ tool: 'bash_output', input: {}, output: '<bash id="x" status="running">\n(no new output)\n</bash>' })).toBe(true)
    expect(isIdlePoll({ tool: 'bash_output', input: {}, output: '<bash id="x" status="exited" exit_code="0">\n(no new output)\n</bash>' })).toBe(false)
    expect(isIdlePoll({ tool: 'bash_output', input: {}, output: '<bash id="x" status="running">\nbuilding…\n</bash>' })).toBe(false)
    expect(isIdlePoll({ tool: 'bash', input: {}, output: '(no new output) status="running"' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/repetition.test.ts`
Expected: FAIL. `observe`, `reset` and `isIdlePoll` do not exist.

- [ ] **Step 3: Rewrite the `toolLoopDetector` section**

In `src/main/agent/repetition.ts`, replace everything from the line
`const DEFAULT_TOOL_HISTORY = 8` to the end of the file with:

```ts
const DEFAULT_TOOL_HISTORY = 8
const DEFAULT_TOOL_MIN_REPEATS = 3

export interface ToolObservation {
  tool: string
  input: unknown
  output?: string
  error?: string
  mutationDigest?: string
}

export type ToolLoopVerdict = { kind: 'ok' } | { kind: 'poll' | 'repeat'; tool: string; count: number }

export interface ToolLoopDetector {
  /** Record one completed call; reports when it repeats with the same result. */
  observe(call: ToolObservation): ToolLoopVerdict
  reset(): void
}

/** A background shell checked while still running with nothing new to show. */
export function isIdlePoll(call: ToolObservation): boolean {
  return call.tool === 'bash_output' && !call.error && typeof call.output === 'string' &&
    call.output.includes('status="running"') && call.output.includes('(no new output)')
}

export function toolLoopDetector(opts?: {
  history?: number
  minRepeats?: number
}): ToolLoopDetector {
  const history = opts?.history ?? DEFAULT_TOOL_HISTORY
  const minRepeats = opts?.minRepeats ?? DEFAULT_TOOL_MIN_REPEATS
  const recent: string[] = []
  const stableJson = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16)
  const fingerprint = (call: ToolObservation): string => {
    let inputJson: string
    try {
      inputJson = stableJson(call.input ?? {})
    } catch {
      inputJson = String(call.input)
    }
    return digest(`${call.tool}:${inputJson}:output=${call.output ?? ''}:error=${call.error ?? ''}:mutation=${call.mutationDigest ?? ''}`)
  }
  return {
    observe(call): ToolLoopVerdict {
      const key = fingerprint(call)
      recent.push(key)
      if (recent.length > history) recent.shift()
      const count = recent.filter(k => k === key).length
      if (count < minRepeats) return { kind: 'ok' }
      return { kind: isIdlePoll(call) ? 'poll' : 'repeat', tool: call.tool, count }
    },
    reset(): void {
      recent.length = 0
    }
  }
}
```

Keep the existing `import { createHash } from 'node:crypto'` line and the "Degenerate tool
loop guard" doc comment above it.

- [ ] **Step 4: Update the single call site in `loop.ts`**

In `src/main/agent/loop.ts`, replace

```ts
      if (calls.length > 0 && this.toolLoop.next(calls.map(c => ({
        tool: c.tool,
        input: c.input,
        output: c.output,
        error: c.error
      })))) {
```

with

```ts
      if (calls.length > 0 && calls.map(c => this.toolLoop.observe({
        tool: c.tool,
        input: c.input,
        output: c.output,
        error: c.error
      })).some(v => v.kind !== 'ok')) {
```

(Task 9 replaces this block entirely. This keeps the build green in between.)

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/unit/repetition.test.ts tests/unit/agent-loop.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/repetition.ts src/main/agent/loop.ts tests/unit/repetition.test.ts
git commit -m "refactor(agent): tool-loop detector reports poll/repeat verdicts per call"
```

---

### Task 4: Response guard

**Files:**
- Create: `src/main/agent/response-guard.ts`
- Create: `tests/unit/response-guard.test.ts`

**Interfaces:**
- Consumes: `repeatDetector` (Task 2).
- Produces, from `src/main/agent/response-guard.ts`:

```ts
export const MAX_TOOL_CALLS_PER_RESPONSE = 32
export type GuardVerdict =
  | { kind: 'ok' }
  | { kind: 'tool-flood' }
  | { kind: 'interleaved' }
  | { kind: 'repetition'; channel: 'text' | 'reasoning'; keepChars: number }
export interface ResponseGuard {
  text(delta: string): GuardVerdict
  reasoning(delta: string): GuardVerdict
  toolCall(): GuardVerdict          // 'ok' = accept the call
  textBeforeFirstCall(): number     // raw text length streamed before the first accepted call
}
export function createResponseGuard(opts?: { maxToolCalls?: number }): ResponseGuard
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/response-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createResponseGuard, MAX_TOOL_CALLS_PER_RESPONSE } from '../../src/main/agent/response-guard'

describe('createResponseGuard', () => {
  it('accepts 32 tool calls and flags the 33rd as a flood', () => {
    expect(MAX_TOOL_CALLS_PER_RESPONSE).toBe(32)
    const g = createResponseGuard()
    for (let i = 0; i < 32; i++) expect(g.toolCall()).toEqual({ kind: 'ok' })
    expect(g.toolCall()).toEqual({ kind: 'tool-flood' })
  })

  it('flags call → text → call as interleaved', () => {
    const g = createResponseGuard()
    expect(g.text('Checking the file. ').kind).toBe('ok')
    expect(g.toolCall().kind).toBe('ok')
    expect(g.text('Now the result shows the getter is missing. ').kind).toBe('ok')
    expect(g.toolCall()).toEqual({ kind: 'interleaved' })
  })

  it('allows text before calls and whitespace between calls', () => {
    const g = createResponseGuard()
    g.text('I will read both files. ')
    expect(g.toolCall().kind).toBe('ok')
    g.text('\n ')
    expect(g.toolCall().kind).toBe('ok')
  })

  it('reports the raw length of text streamed before the first call', () => {
    const g = createResponseGuard()
    g.text('abc ')
    g.text('def')
    g.toolCall()
    g.text(' tail that must be dropped')
    expect(g.textBeforeFirstCall()).toBe(7)
  })

  it('flags repetition on the text channel with a keep offset', () => {
    const g = createResponseGuard()
    let verdict = g.text('Intro. ')
    for (let i = 0; i < 200 && verdict.kind === 'ok'; i++) verdict = g.text('counselor')
    expect(verdict.kind).toBe('repetition')
    if (verdict.kind === 'repetition') {
      expect(verdict.channel).toBe('text')
      expect(verdict.keepChars).toBeGreaterThanOrEqual('Intro. '.length)
    }
  })

  it('tracks reasoning separately from text', () => {
    const g = createResponseGuard()
    let verdict = g.reasoning('Thinking. ')
    for (let i = 0; i < 200 && verdict.kind === 'ok'; i++) verdict = g.reasoning('loop ')
    expect(verdict).toMatchObject({ kind: 'repetition', channel: 'reasoning' })
    expect(g.text('A normal answer.').kind).toBe('ok')
  })

  it('honors a custom tool-call cap', () => {
    const g = createResponseGuard({ maxToolCalls: 2 })
    g.toolCall()
    g.toolCall()
    expect(g.toolCall().kind).toBe('tool-flood')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/response-guard.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `response-guard.ts`**

Create `src/main/agent/response-guard.ts`:

```ts
import { repeatDetector } from './repetition'

/**
 * Per-step guard over one model response. Native APIs stop after a tool call
 * and always bound output; OpenAI-compatible translation layers (Ollama /v1,
 * gateways) do not guarantee either, so a degenerate model can emit hundreds
 * of calls, keep writing "results" it never received, or loop on one span.
 */
export const MAX_TOOL_CALLS_PER_RESPONSE = 32

export type GuardVerdict =
  | { kind: 'ok' }
  | { kind: 'tool-flood' }
  | { kind: 'interleaved' }
  | { kind: 'repetition'; channel: 'text' | 'reasoning'; keepChars: number }

export interface ResponseGuard {
  text(delta: string): GuardVerdict
  reasoning(delta: string): GuardVerdict
  /** Ask before accepting a streamed tool call; 'ok' means accept it. */
  toolCall(): GuardVerdict
  /** Raw length of the text streamed before the first accepted tool call. */
  textBeforeFirstCall(): number
}

const OK: GuardVerdict = { kind: 'ok' }

export function createResponseGuard(opts?: { maxToolCalls?: number }): ResponseGuard {
  const maxToolCalls = opts?.maxToolCalls ?? MAX_TOOL_CALLS_PER_RESPONSE
  const textRepeat = repeatDetector()
  const reasoningRepeat = repeatDetector()
  let calls = 0
  let textLength = 0
  let preCallText = 0
  let textAfterCall = false
  return {
    text(delta: string): GuardVerdict {
      textLength += delta.length
      if (calls === 0) preCallText = textLength
      else if (/\S/.test(delta)) textAfterCall = true
      const hit = textRepeat.push(delta)
      return hit ? { kind: 'repetition', channel: 'text', keepChars: hit.keepChars } : OK
    },
    reasoning(delta: string): GuardVerdict {
      const hit = reasoningRepeat.push(delta)
      return hit ? { kind: 'repetition', channel: 'reasoning', keepChars: hit.keepChars } : OK
    },
    toolCall(): GuardVerdict {
      if (textAfterCall) return { kind: 'interleaved' }
      if (calls >= maxToolCalls) return { kind: 'tool-flood' }
      calls++
      return OK
    },
    textBeforeFirstCall: () => preCallText
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/response-guard.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/response-guard.ts tests/unit/response-guard.test.ts
git commit -m "feat(agent): add a per-response stream guard"
```

---

### Task 5: Tool scheduler, harness notes, `concurrencySafe` flags

**Files:**
- Create: `src/main/agent/tool-scheduler.ts`, `src/main/agent/harness-note.ts`
- Create: `tests/unit/tool-scheduler.test.ts`, `tests/unit/harness-note.test.ts`
- Modify: `src/main/agent/tools/types.ts` (`ToolDefinition`)
- Modify: `src/main/agent/tools/read.ts`, `glob.ts`, `grep.ts`, `webfetch.ts`, `websearch.ts`,
  `lsp.ts`, `skill.ts`, `bash.ts` (`bashOutputTool` only), `task.ts`
- Modify: `tests/unit/agent-tools-registry.test.ts`
- Docs: `src/main/agent/tools/AGENTS.md`, `docs/reference/04-tool-catalog.md`

**Interfaces:**
- Consumes: `MAX_TOOL_CALLS_PER_RESPONSE` (Task 4), `ToolLoopVerdict` (Task 3).
- Produces:

```ts
// tool-scheduler.ts
export const MAX_TOOL_CONCURRENCY = 10
export function scheduleBatches<T>(items: readonly T[], parallel: (item: T) => boolean): T[][]
export function runWithConcurrency(tasks: ReadonlyArray<() => Promise<void>>, limit?: number): Promise<void>
// harness-note.ts
export type CutReason = 'tool-flood' | 'interleaved' | 'repetition'
export function harnessNote(text: string): string
export function attachNote(call: ToolCallData, note: string): void
export function cutNote(reason: CutReason, maxToolCalls: number): string
export function toolLoopNote(verdict: { kind: 'poll' | 'repeat'; tool: string; count: number }): string
// tools/types.ts
ToolDefinition.concurrencySafe?: boolean
```

- [ ] **Step 1: Write the failing scheduler tests**

Create `tests/unit/tool-scheduler.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing note tests**

Create `tests/unit/harness-note.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { attachNote, cutNote, harnessNote, toolLoopNote } from '../../src/main/agent/harness-note'
import type { ToolCallData } from '../../src/shared/types'

const call = (over: Partial<ToolCallData> = {}): ToolCallData => ({ id: 'c', tool: 'read', input: {}, permission: 'allowed', ...over })

describe('harness notes', () => {
  it('wraps text as a [meow] system reminder', () => {
    expect(harnessNote('hello')).toBe('<system-reminder>\n[meow] hello\n</system-reminder>')
  })

  it('appends to output, to error, or stands alone', () => {
    const withOutput = call({ output: 'data' })
    attachNote(withOutput, 'N')
    expect(withOutput.output).toBe('data\nN')

    const withError = call({ error: 'boom', output: 'partial' })
    attachNote(withError, 'N')
    expect(withError.error).toBe('boom\nN')
    expect(withError.output).toBe('partial')

    const empty = call()
    attachNote(empty, 'N')
    expect(empty.output).toBe('N')
  })

  it('explains each cut reason', () => {
    expect(cutNote('tool-flood', 32)).toContain('after 32 tool calls')
    expect(cutNote('interleaved', 32)).toContain('kept writing after calling tools')
    expect(cutNote('repetition', 32)).toContain('started repeating itself')
    for (const r of ['tool-flood', 'interleaved', 'repetition'] as const) {
      expect(cutNote(r, 32).startsWith('<system-reminder>\n[meow] ')).toBe(true)
    }
  })

  it('tells a polling model to wait and a repeating model to change course', () => {
    expect(toolLoopNote({ kind: 'poll', tool: 'bash_output', count: 3 })).toContain('wait_s')
    const repeat = toolLoopNote({ kind: 'repeat', tool: 'read', count: 3 })
    expect(repeat).toContain('read')
    expect(repeat).toContain('3 times')
  })
})
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run tests/unit/tool-scheduler.test.ts tests/unit/harness-note.test.ts`
Expected: FAIL. The modules are not found.

- [ ] **Step 4: Implement `tool-scheduler.ts`**

Create `src/main/agent/tool-scheduler.ts`:

```ts
/**
 * Claude Code-style tool execution: read-only, concurrency-safe calls run in
 * parallel; anything that writes, prompts, or is unknown runs alone, and the
 * model's call order is preserved across batches.
 */
export const MAX_TOOL_CONCURRENCY = 10

export function scheduleBatches<T>(items: readonly T[], parallel: (item: T) => boolean): T[][] {
  const batches: T[][] = []
  for (const item of items) {
    const last = batches[batches.length - 1]
    if (last && parallel(item) && parallel(last[0])) last.push(item)
    else batches.push([item])
  }
  return batches
}

export async function runWithConcurrency(
  tasks: ReadonlyArray<() => Promise<void>>,
  limit = MAX_TOOL_CONCURRENCY
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++
      await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}
```

- [ ] **Step 5: Implement `harness-note.ts`**

Create `src/main/agent/harness-note.ts`:

```ts
import type { ToolCallData } from '../../shared/types'

/**
 * The loop talks to the model mid-turn only through notes attached to a tool
 * result, the way Claude Code and Codex annotate tool output. A synthetic user
 * message would read as the user scolding the model and stay in history.
 */
export type CutReason = 'tool-flood' | 'interleaved' | 'repetition'

export function harnessNote(text: string): string {
  return `<system-reminder>\n[meow] ${text}\n</system-reminder>`
}

export function attachNote(call: ToolCallData, note: string): void {
  if (call.error) call.error = `${call.error}\n${note}`
  else call.output = call.output ? `${call.output}\n${note}` : note
}

export function cutNote(reason: CutReason, maxToolCalls: number): string {
  if (reason === 'tool-flood') {
    return harnessNote(
      `Your response was cut after ${maxToolCalls} tool calls; the rest were dropped. Tool results only ` +
      'arrive after your response ends — call the tools you need, then wait for their results.'
    )
  }
  if (reason === 'interleaved') {
    return harnessNote(
      'Your response was cut: it kept writing after calling tools, and the calls that followed were ' +
      'dropped. Tool results only arrive after your response ends — call tools, then stop and wait for their results.'
    )
  }
  return harnessNote(
    'Your response was cut because it started repeating itself. The tool calls above ran; continue ' +
    'from their results without restating earlier text.'
  )
}

export function toolLoopNote(verdict: { kind: 'poll' | 'repeat'; tool: string; count: number }): string {
  if (verdict.kind === 'poll') {
    return harnessNote(
      `The shell is still running with no new output (${verdict.count} identical checks). Wait with ` +
      'bash_output({ id, wait_s: 120 }), or end your turn — you will be woken when it exits.'
    )
  }
  return harnessNote(
    `This exact ${verdict.tool} call returned the same result ${verdict.count} times; repeating it will ` +
    'not change the result. Use what you have, try a different approach, or end your turn and explain what is blocking you.'
  )
}
```

- [ ] **Step 6: Run both test files and confirm they pass**

Run: `npx vitest run tests/unit/tool-scheduler.test.ts tests/unit/harness-note.test.ts`
Expected: PASS.

- [ ] **Step 7: Add the `concurrencySafe` flag to `ToolDefinition`**

In `src/main/agent/tools/types.ts`, change the `ToolDefinition` interface to:

```ts
export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema
  /**
   * Read-only and safe to run alongside other safe calls. Absent = runs alone,
   * which is the only safe default for MCP and user tools.
   */
  concurrencySafe?: boolean
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}
```

- [ ] **Step 8: Write the failing registry test**

In `tests/unit/agent-tools-registry.test.ts`, add a new `it` inside the existing top-level
`describe` (or append a new `describe` at the end of the file):

```ts
describe('concurrency-safe tools', () => {
  it('marks read-only tools safe and leaves writers and shells serial', () => {
    const tools = createDefaultTools()
    for (const name of ['read', 'glob', 'grep', 'webfetch', 'websearch', 'skill', 'bash_output']) {
      expect(tools.get(name)?.concurrencySafe, name).toBe(true)
    }
    for (const name of ['bash', 'write', 'edit', 'apply-patch', 'todowrite', 'question', 'kill_shell', 'monitor']) {
      expect(tools.get(name)?.concurrencySafe, name).toBeFalsy()
    }
  })
})
```

Run: `npx vitest run tests/unit/agent-tools-registry.test.ts`
Expected: FAIL.

- [ ] **Step 9: Flag the tools**

Add the line `  concurrencySafe: true,` directly after the `name:` line of each tool object:

- `src/main/agent/tools/read.ts`: after `  name: 'read',`
- `src/main/agent/tools/glob.ts`: after `  name: 'glob',`
- `src/main/agent/tools/grep.ts`: after `  name: 'grep',`
- `src/main/agent/tools/webfetch.ts`: after `  name: 'webfetch',`
- `src/main/agent/tools/websearch.ts`: after `  name: 'websearch',`
- `src/main/agent/tools/bash.ts`: after `  name: 'bash_output',` (not `bash`, not `kill_shell`)
- `src/main/agent/tools/lsp.ts`: after `    name: 'lsp',` (indent 4 spaces, inside `return {`)
- `src/main/agent/tools/skill.ts`: after `    name: 'skill',` (indent 4 spaces)
- `src/main/agent/tools/task.ts`: after `    name: 'task',` (indent 4 spaces). Subagents run
  in parallel, matching the tool description "Launch multiple task calls in a single message
  to run them in parallel".

- [ ] **Step 10: Run the tests and typecheck**

Run: `npx vitest run tests/unit/agent-tools-registry.test.ts tests/unit/tool-scheduler.test.ts tests/unit/harness-note.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 11: Update docs**

1. `src/main/agent/tools/AGENTS.md`, `types.ts` row: change it to
   ``| `types.ts` | `ToolDefinition` interface + `ToolSchema` type — the contract every tool implements. `concurrencySafe?: boolean` marks read-only tools that may run in parallel (default: runs alone). |``
2. Same file, `## Conventions`: add the bullet
   `- Mark a new tool \`concurrencySafe: true\` only if it never writes files, spawns a foreground process, or prompts the user; everything else runs alone, in model order.`
3. `src/main/agent/AGENTS.md`, `## Key files` table: add these two rows after the `repetition.ts` row:

```md
| `tool-scheduler.ts` | `scheduleBatches` splits a response's calls, in model order, into batches (consecutive `concurrencySafe` + `allow` calls together, everything else alone); `runWithConcurrency` runs a batch with at most `MAX_TOOL_CONCURRENCY` (10) in flight. |
| `harness-note.ts` | `harnessNote` / `attachNote` / `cutNote` / `toolLoopNote`: the `<system-reminder>[meow] …` notes the loop attaches to a tool result — the only way it speaks to the model mid-turn (no synthetic user messages). |
```

4. `docs/reference/04-tool-catalog.md`: after the tool table that contains the `bash_output`
   row (the table ending near line 80), add:

```md
**Concurrency.** Tools flagged `concurrencySafe` — `read`, `glob`, `grep`, `webfetch`,
`websearch`, `lsp`, `skill`, `bash_output`, `task` — run in parallel (at most 10 at once) when
the model emits them back to back and they are auto-allowed. Every other call, including MCP and
user tools and any call that prompts for permission, runs alone. Results always reach the
transcript in the model's call order.
```

- [ ] **Step 12: Commit**

```bash
git add src/main/agent/tool-scheduler.ts src/main/agent/harness-note.ts src/main/agent/tools tests/unit/tool-scheduler.test.ts tests/unit/harness-note.test.ts tests/unit/agent-tools-registry.test.ts src/main/agent/AGENTS.md docs/reference/04-tool-catalog.md
git commit -m "feat(agent): tool scheduler, harness notes, concurrency-safe tool flags"
```

---

### Task 6: Sampling presets and LLM provider layer

**Files:**
- Create: `src/main/agent/sampling.ts`, `tests/unit/agent-sampling.test.ts`
- Modify: `src/main/agent/config.ts` (`MeowConfig`, `mergeDefaults`, `settingsToConfig`, new `normalizeSampling`)
- Modify: `src/main/agent/llm.ts` (`LlmStreamPart`, `LlmStreamOptions`, `createLlm`, `rawStream`)
- Modify: `src/main/meow-agent-manager.ts` (the `createLlm` dep type at ~line 69, both `createLlm` calls)
- Modify: `tests/unit/agent-llm.test.ts`, `tests/unit/meow-agent-manager.test.ts`
- Docs: `src/main/agent/AGENTS.md`, `docs/reference/06-data-and-storage.md`, `docs/reference/07-providers-and-connections.md`

**Interfaces:**
- Produces:

```ts
// sampling.ts
export interface SamplingParams { temperature?: number; topP?: number; frequencyPenalty?: number; presencePenalty?: number }
export type SamplingOverrides = Record<string, SamplingParams>
export const ANTI_REPETITION_FREQUENCY_PENALTY = 0.5
export function resolveSampling(modelId: string, overrides?: SamplingOverrides, opts?: { antiRepetition?: boolean }): SamplingParams
// llm.ts
LlmStreamPart.invalid?: boolean; LlmStreamPart.invalidReason?: string
LlmStreamOptions.antiRepetition?: boolean
createLlm(provider, apiKey, baseUrl?, retry?, providerType?, sampling?: SamplingOverrides): LlmClient
// config.ts
MeowConfig.sampling?: SamplingOverrides
```

- [ ] **Step 1: Write the failing sampling tests**

Create `tests/unit/agent-sampling.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/agent-sampling.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Verify the preset values against the model cards**

Open each source with the WebFetch tool and check the recommended sampling. If a card states a
different value, use the card's value in Step 4 **and** in the Step 1 test.

| Family regex | Values | Source |
|---|---|---|
| `/qwen.*coder/i` | temperature 0.7, topP 0.8 | https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct (Best Practices) |
| `/qwen/i` | temperature 0.6, topP 0.95 | https://huggingface.co/Qwen/Qwen3-235B-A22B (Best Practices, thinking mode) |
| `/glm/i` | temperature 1.0, topP 0.95 | https://huggingface.co/zai-org/GLM-4.6 |
| `/kimi.*think/i` | temperature 1.0 | https://huggingface.co/moonshotai/Kimi-K2-Thinking |
| `/kimi/i` | temperature 0.6 | https://huggingface.co/moonshotai/Kimi-K2-Instruct |
| `/minimax/i` | temperature 1.0, topP 0.95 | https://huggingface.co/MiniMaxAI/MiniMax-M2 |
| `/deepseek/i` | temperature 0.6, topP 0.95 | https://huggingface.co/deepseek-ai/DeepSeek-R1 (Usage Recommendations) |
| `/gpt-oss/i` | temperature 1.0, topP 1.0 | https://huggingface.co/openai/gpt-oss-120b |
| `/gemma/i` | temperature 1.0, topP 0.95 | https://huggingface.co/google/gemma-3-27b-it |
| `/nemotron/i` | temperature 0.6, topP 0.95 | https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2 (reasoning on) |

Only `temperature` and `topP` are used; `top_k` is not a standard AI SDK setting on this path.

- [ ] **Step 4: Implement `sampling.ts`**

Create `src/main/agent/sampling.ts`, with values as confirmed in Step 3:

```ts
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
```

Run: `npx vitest run tests/unit/agent-sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing config test**

Create `tests/unit/agent-config-sampling.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configToSettings, loadMeowConfig, settingsToConfig } from '../../src/main/agent/config'

function load(json: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-sampling-'))
  const file = path.join(dir, 'meow.json')
  writeFileSync(file, JSON.stringify(json))
  return loadMeowConfig(file)
}

describe('meow.json sampling', () => {
  it('keeps valid numeric fields and drops everything else', () => {
    const cfg = load({ sampling: { 'glm-*': { temperature: 0.7, topP: 'x', bogus: 1 }, 'bad': 3, 'empty': {} } })
    expect(cfg.sampling).toEqual({ 'glm-*': { temperature: 0.7 } })
  })

  it('is undefined when absent', () => {
    expect(load({}).sampling).toBeUndefined()
  })

  it('survives a settings save round-trip', () => {
    const cfg = load({ provider: { p: { apiKey: 'k', models: ['m'] } }, model: 'p', sampling: { 'qwen*': { temperature: 0.5 } } })
    const next = settingsToConfig(configToSettings(cfg), cfg)
    expect(next.sampling).toEqual({ 'qwen*': { temperature: 0.5 } })
  })
})
```

Run: `npx vitest run tests/unit/agent-config-sampling.test.ts`
Expected: FAIL. `sampling` is `undefined`, or there is a type error.

- [ ] **Step 6: Implement the config support**

In `src/main/agent/config.ts`:

1. After `import type { HooksConfig } from './hooks'` add
   `import type { SamplingOverrides, SamplingParams } from './sampling'`.
2. In `interface MeowConfig`, after `hooks?: HooksConfig` add:

```ts
  /** Per-model sampling overrides, keyed by model-id pattern (see agent/sampling.ts). */
  sampling?: SamplingOverrides
```

3. Add this function right after `normalizeMcpOutput`:

```ts
function normalizeSampling(raw: unknown): SamplingOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: SamplingOverrides = {}
  for (const [pattern, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const source = value as Record<string, unknown>
    const params: SamplingParams = {}
    for (const key of ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'] as const) {
      const n = source[key]
      if (typeof n === 'number' && Number.isFinite(n)) params[key] = n
    }
    if (Object.keys(params).length > 0) out[pattern] = params
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```

4. In `mergeDefaults`, after `hooks: normalizeHooks(raw.hooks)` change that line to
   `hooks: normalizeHooks(raw.hooks),` and add `sampling: normalizeSampling(raw.sampling)`.
5. In `settingsToConfig`, after the line `hooks: normalizeHooks(base.hooks),` add:

```ts
    // Like hooks, sampling is edited in meow.json only and must survive a settings save.
    sampling: normalizeSampling(base.sampling),
```

Run: `npx vitest run tests/unit/agent-config-sampling.test.ts tests/unit/agent-config.test.ts`
Expected: PASS. If an existing `agent-config.test.ts` assertion compares a full config object
with `toStrictEqual` and now fails on `sampling: undefined`, change that assertion to `toEqual`.
`toEqual` ignores `undefined` properties.

- [ ] **Step 7: Write the failing LLM tests**

Append to `tests/unit/agent-llm.test.ts`:

```ts
describe('sampling and invalid tool calls', () => {
  const finishOnly = () => ({ fullStream: fakeFullStream([{ type: 'finish', finishReason: 'stop' }]) })
  const drain = async (llm: ReturnType<typeof createLlm>, opts: Partial<Parameters<ReturnType<typeof createLlm>['stream']>[0]> = {}) => {
    const out: LlmStreamPart[] = []
    for await (const p of llm.stream({ model: 'glm-5.1', system: 's', messages: [], tools: [], ...opts })) out.push(p)
    return out
  }

  it('sends the family preset on the OpenAI-compatible branch', async () => {
    streamTextMock.mockReturnValue(finishOnly())
    await drain(createLlm('ollama-cloud', 'k', 'https://ollama.com/v1'))
    const call = streamTextMock.mock.calls[0][0] as Record<string, unknown>
    expect(call.temperature).toBe(1.0)
    expect(call.topP).toBe(0.95)
    expect(call).not.toHaveProperty('frequencyPenalty')
  })

  it('sends nothing for an unknown model', async () => {
    streamTextMock.mockReturnValue(finishOnly())
    await drain(createLlm('openai', 'k'), { model: 'llama3' })
    const call = streamTextMock.mock.calls[0][0] as Record<string, unknown>
    expect(call).not.toHaveProperty('temperature')
    expect(call).not.toHaveProperty('topP')
  })

  it('applies meow.json overrides passed to createLlm', async () => {
    streamTextMock.mockReturnValue(finishOnly())
    await drain(createLlm('ollama-cloud', 'k', undefined, undefined, undefined, { 'glm-*': { temperature: 0.7 } }))
    expect((streamTextMock.mock.calls[0][0] as Record<string, unknown>).temperature).toBe(0.7)
  })

  it('adds the anti-repetition penalty only when asked', async () => {
    streamTextMock.mockReturnValue(finishOnly())
    await drain(createLlm('ollama-cloud', 'k'), { antiRepetition: true })
    expect((streamTextMock.mock.calls[0][0] as Record<string, unknown>).frequencyPenalty).toBe(0.5)
  })

  it('never sends sampling to anthropic, even on an anti-repetition retry', async () => {
    streamTextMock.mockReturnValue(finishOnly())
    await drain(createLlm('anthropic', 'k'), { model: 'claude-opus-4.6', antiRepetition: true })
    const call = streamTextMock.mock.calls[0][0] as Record<string, unknown>
    expect(call).not.toHaveProperty('temperature')
    expect(call).not.toHaveProperty('frequencyPenalty')
  })

  it('marks an SDK-invalid tool call with its reason', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([
        { type: 'tool-call', toolCallId: 't1', toolName: 'nope', input: {}, dynamic: true, invalid: true, error: new Error('Model tried to call unavailable tool nope') },
        { type: 'finish', finishReason: 'tool-calls' }
      ])
    })
    const out = await drain(createLlm('openai', 'k'), { model: 'llama3' })
    expect(out[0]).toEqual({
      kind: 'tool-call', toolName: 'nope', toolCallId: 't1', toolInput: {},
      invalid: true, invalidReason: 'Model tried to call unavailable tool nope'
    })
  })

  it('does not mark a valid tool call', async () => {
    streamTextMock.mockReturnValue({
      fullStream: fakeFullStream([{ type: 'tool-call', toolCallId: 't1', toolName: 'read', input: { file_path: 'a' } }])
    })
    const out = await drain(createLlm('openai', 'k'), { model: 'llama3' })
    expect(out[0]).not.toHaveProperty('invalid')
  })
})
```

Run: `npx vitest run tests/unit/agent-llm.test.ts`
Expected: FAIL. No sampling is sent, there is no 6th param, and no `invalid` field.

- [ ] **Step 8: Implement the LLM changes**

In `src/main/agent/llm.ts`:

1. Add the import after `import type { ToolDefinition } from './tools/types'`:

```ts
import { resolveSampling } from './sampling'
import type { SamplingOverrides } from './sampling'
```

2. In `interface LlmStreamPart`, after `toolInput?: Record<string, unknown>` add:

```ts
  /** Set on tool-call parts the SDK could not validate (unknown tool, bad arguments). */
  invalid?: boolean
  invalidReason?: string
```

3. In `interface LlmStreamOptions`, after `maxOutputTokens?: number` add:

```ts
  /** Retry of a step discarded for repetition: add a frequency penalty where supported. */
  antiRepetition?: boolean
```

4. Change the `createLlm` signature to:

```ts
export function createLlm(provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions, providerType?: string, sampling?: SamplingOverrides): LlmClient {
```

5. In `rawStream`, right before `const result = streamText({` add:

```ts
    // Anthropic and Google keep their own tuned defaults; sampling is only for
    // the OpenAI-compatible branch that serves open models.
    const samplingParams = provider === 'anthropic' || provider === 'google'
      ? {}
      : resolveSampling(opts.model, sampling, { antiRepetition: opts.antiRepetition })
```

   and inside the `streamText({ ... })` object, after the `maxOutputTokens` spread line, add
   `...samplingParams,`.

6. Replace the `case 'tool-call':` block with:

```ts
        case 'tool-call': {
          const invalid = (part as { invalid?: boolean }).invalid === true
          const error = (part as { error?: unknown }).error
          yield {
            kind: 'tool-call',
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            toolInput: normalizeToolInput(part.input),
            ...(invalid ? { invalid: true, invalidReason: error instanceof Error ? error.message : formatLlmError(error) } : {})
          }
          break
        }
```

Run: `npx vitest run tests/unit/agent-llm.test.ts tests/unit/agent-llm-retry.test.ts tests/unit/llm-variant.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire sampling through the manager (test first)**

Append to `tests/unit/meow-agent-manager.test.ts`:

```ts
describe('MeowAgentManager sampling', () => {
  it('hands meow.json sampling overrides to the LLM client', async () => {
    const cfgDir = mkdtempSync(path.join(tmpdir(), 'meow-mgr-sampling-'))
    const cfgPath = path.join(cfgDir, 'meow.json')
    writeFileSync(cfgPath, JSON.stringify({
      provider: { test: { apiKey: 'sk-test', models: ['test-model'] } },
      model: 'test',
      sampling: { 'test-*': { temperature: 0.3 } }
    }))
    const { createLlm } = await makeManager({ configPath: cfgPath })
    expect((createLlm.mock.calls[0] as unknown[])[5]).toEqual({ 'test-*': { temperature: 0.3 } })
  })
})
```

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts -t "sampling"`
Expected: FAIL (`undefined`).

In `src/main/meow-agent-manager.ts`:

1. Add the import `import type { SamplingOverrides } from './agent/sampling'` after
   `import type { LlmClient } from './agent/llm'`.
2. Change the dep type line
   `createLlm?: (provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions, providerType?: string) => LlmClient`
   to
   `createLlm?: (provider: string, apiKey: string, baseUrl?: string, retry?: RetryOptions, providerType?: string, sampling?: SamplingOverrides) => LlmClient`.
3. In the main `llmClient` construction, change the closing arguments
   `      resolved.providerType\n    )` to `      resolved.providerType,\n      cfg.sampling\n    )`.
4. Change the subagent line to
   `const subLlm = (this.deps.createLlm ?? createLlm)(subResolved.provider, subResolved.apiKey, subResolved.baseUrl, undefined, subResolved.providerType, cfg.sampling)`.

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Update docs**

1. `docs/reference/06-data-and-storage.md`: after the line
   `  "mcpOutput":  { "maxTokens": 25000 },     // absent = DEFAULT_MCP_OUTPUT_TOKENS` add:

```jsonc
  "sampling": { "glm-*": { "temperature": 0.7 } }, // optional per-model override of the built-in presets (temperature/topP/frequencyPenalty/presencePenalty); OpenAI-compatible providers only
```

2. `docs/reference/07-providers-and-connections.md` §7.1: after the **opencode handling**
   paragraph, add:

```md
**Sampling** (`agent/sampling.ts`) applies only to the OpenAI-compatible branch. `resolveSampling`
matches the bare model id against built-in publisher presets (qwen, qwen-coder, glm, kimi,
kimi-thinking, minimax, deepseek, gpt-oss, gemma, nemotron) and the optional `meow.json` `sampling`
overrides (patterns as in permission rules; override fields win). An unmatched model gets no
sampling parameters. When a step is retried after a repetition cut, the runner sets
`antiRepetition` and a matched model also gets `frequencyPenalty` ≥ 0.5 for that retry only.
Anthropic and Google always keep their provider defaults.

**Invalid tool calls.** A `tool-call` part the SDK marks `invalid` (unknown tool or arguments
failing the schema) is passed on with `invalid: true` and `invalidReason`. The loop records it
with an error and never executes it.
```

3. `src/main/agent/AGENTS.md`: add a row after the `limits.ts` row:

```md
| `sampling.ts` | `resolveSampling(modelId, overrides?, { antiRepetition? })`: publisher sampling presets by model family plus `meow.json` `sampling` overrides, for the OpenAI-compatible branch only; unmatched models get nothing; `antiRepetition` adds `frequencyPenalty` ≥ `ANTI_REPETITION_FREQUENCY_PENALTY` (0.5) to a matched model. |
```

   In the `llm.ts` row, append the sentence:
   `createLlm takes an optional 6th \`sampling\` argument (meow.json overrides) and sends \`resolveSampling\` params on the OpenAI-compatible branch; \`LlmStreamOptions.antiRepetition\` adds the retry penalty; SDK-invalid tool calls are yielded with \`invalid\`/\`invalidReason\`.`
   In the `config.ts` row, append: `\`sampling\` (per-model overrides) is normalized on load and survives a settings save.`

- [ ] **Step 11: Commit**

```bash
git add src/main/agent/sampling.ts src/main/agent/config.ts src/main/agent/llm.ts src/main/meow-agent-manager.ts tests/unit/agent-sampling.test.ts tests/unit/agent-config-sampling.test.ts tests/unit/agent-llm.test.ts tests/unit/agent-config.test.ts tests/unit/meow-agent-manager.test.ts src/main/agent/AGENTS.md docs/reference/06-data-and-storage.md docs/reference/07-providers-and-connections.md
git commit -m "feat(agent): per-model sampling presets and invalid tool-call marking"
```

---

### Task 7: Current-turn reasoning replay; drop the stub `execute`

**Files:**
- Modify: `src/main/agent/message.ts`
- Modify: `tests/unit/agent-message.test.ts`
- Docs: `src/main/agent/AGENTS.md`, `docs/reference/07-providers-and-connections.md`

**Interfaces:**
- Produces: `toLlmMessages` emits `{ type: 'reasoning', text }` (no `provider` field) only for
  assistant messages after the last user message. `toToolDefinition(def)` returns
  `{ description, inputSchema }` with no `execute`.

- [ ] **Step 1: Update and add the tests**

In `tests/unit/agent-message.test.ts`:

1. In the test `'echoes the assistant reasoning back before its text and tool calls'`, change
   the expected first part to `{ type: 'reasoning', text: 'I should list the files first.' }`
   (remove `provider: 'deepseek'`).
2. Add these tests in the same `describe` block:

```ts
  it('replays reasoning only for the current turn, not earlier turns', () => {
    const earlier: ChatMessage = { ...msg('assistant', 'first answer'), reasoning: 'old thoughts' }
    const current: ChatMessage = { ...msg('assistant', ''), reasoning: 'current thoughts' }
    const items = [
      { kind: 'message' as const, message: msg('user', 'first question') },
      { kind: 'message' as const, message: earlier },
      { kind: 'message' as const, message: msg('user', 'second question') },
      { kind: 'message' as const, message: current },
      { kind: 'tool' as const, tool: toolCall('glob', { pattern: '*' }) }
    ]
    const llm = toLlmMessages(items)
    const assistants = llm.filter(m => m.role === 'assistant') as Array<{ content: Array<{ type: string; text?: string }> }>
    expect(assistants[0].content).toEqual([{ type: 'text', text: 'first answer' }])
    expect(assistants[1].content[0]).toEqual({ type: 'reasoning', text: 'current thoughts' })
  })

  it('does not give tool definitions an execute function', () => {
    const def = { name: 'read', description: 'Read a file', schema: { type: 'object', properties: {} }, run: async () => ({}) } as unknown as ToolDefinition
    expect(toToolDefinition(def)).not.toHaveProperty('execute')
  })
```

3. Search the file for `execute`. If any existing assertion expects `execute` on a
   `toToolDefinition` result, delete that assertion line.

Run: `npx vitest run tests/unit/agent-message.test.ts`
Expected: FAIL. The old reasoning is still replayed, the `provider` field is present, and
`execute` exists.

- [ ] **Step 2: Implement it in `message.ts`**

1. Change the `AssistantPart` type's reasoning member to `{ type: 'reasoning'; text: string }`.
2. In `toLlmMessages`, right after `const fullFrom = recentTurnStart(items, opts?.keepFullTurns ?? 0)` add:

```ts
  // Reasoning is echoed only inside the current tool loop (after the last user
  // message), matching DeepSeek/Anthropic semantics. Replaying every past
  // turn's reasoning bloats context and primes the model to repeat itself.
  let lastUserIndex = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'message' && it.message.role === 'user') { lastUserIndex = i; break }
  }
```

3. Replace the line
   `pendingAssistant = { text: item.message.text, calls: [], reasoning: item.message.reasoning }`
   with
   `pendingAssistant = { text: item.message.text, calls: [], reasoning: index > lastUserIndex ? item.message.reasoning : undefined }`.
4. Replace
   `content.push({ type: 'reasoning', text: pendingAssistant.reasoning, provider: 'deepseek' })`
   with `content.push({ type: 'reasoning', text: pendingAssistant.reasoning })`.
5. Replace the `toToolDefinition` body with:

```ts
export function toToolDefinition(def: ToolDefinition): Tool {
  // No execute: the SDK only reports calls; SessionRunner runs them.
  return {
    description: def.description,
    inputSchema: toInputSchema(def.schema)
  }
}
```

Run: `npx vitest run tests/unit/agent-message.test.ts tests/unit/agent-loop.test.ts tests/unit/agent-llm.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0. If `Tool` requires `execute`, it does not in `ai` 6; `execute` is optional.

- [ ] **Step 3: Update docs**

1. `src/main/agent/AGENTS.md`, `message.ts` row: append
   `Reasoning parts are replayed only for assistant messages after the last user message (the current tool loop); \`toToolDefinition\` has no \`execute\` (the SDK reports calls, the runner runs them).`
2. `docs/reference/07-providers-and-connections.md`, in the **DeepSeek handling** paragraph,
   replace the sentence starting `` `providerType` is also what drives echoing `` (through
   `emits a \`reasoning\` assistant part).`) with:
   ``Reasoning is echoed back as `reasoning_content` only for assistant messages after the last user message (the current tool loop, where thinking-mode tool use requires it); earlier turns are replayed without reasoning (`agent/message.ts`).``

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/message.ts tests/unit/agent-message.test.ts src/main/agent/AGENTS.md docs/reference/07-providers-and-connections.md
git commit -m "fix(agent): replay reasoning only for the current turn; drop stub tool execute"
```

---

### Task 8: `bash_output` waits for output

**Files:**
- Modify: `src/main/agent/background-process-store.ts` (add `waitForNew`)
- Modify: `src/main/agent/tools/bash.ts` (`bashOutputTool`)
- Modify: `tests/unit/background-process-store.test.ts`, `tests/unit/agent-tools-background-bash.test.ts`
- Docs: `src/main/agent/AGENTS.md`, `src/main/agent/tools/AGENTS.md`, `docs/reference/04-tool-catalog.md`

**Interfaces:**
- Produces: `BackgroundProcessStore.waitForNew(id: string, ms: number, signal?: AbortSignal): Promise<void>`
  and the `bash_output` input `wait_s?: number` (default 15, clamped 0–300).

- [ ] **Step 1: Write the failing store tests**

Append inside `describe('BackgroundProcessStore', ...)` in
`tests/unit/background-process-store.test.ts`:

```ts
  it('waitForNew resolves as soon as new output arrives', async () => {
    const { store } = makeStore()
    const { id } = store.start('a1', 'sleep 1 && echo LATE_MARKER && sleep 20', dir) as { id: string }
    store.readNew(id)
    const before = store.listenerCount('data')
    const started = Date.now()
    await store.waitForNew(id, 15000)
    expect(Date.now() - started).toBeLessThan(10000)
    await waitFor(() => {
      const r = store.readNew(id)
      return 'text' in r && r.text.includes('LATE_MARKER')
    })
    expect(store.listenerCount('data')).toBe(before)
    store.kill(id)
  }, 30000)

  it('waitForNew resolves on timeout and cleans up its listeners', async () => {
    const { store } = makeStore()
    const { id } = store.start('a1', 'sleep 20', dir) as { id: string }
    const before = { data: store.listenerCount('data'), exit: store.listenerCount('exit') }
    const started = Date.now()
    await store.waitForNew(id, 300)
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(5000)
    expect(store.listenerCount('data')).toBe(before.data)
    expect(store.listenerCount('exit')).toBe(before.exit)
    store.kill(id)
  }, 20000)

  it('waitForNew resolves immediately on abort', async () => {
    const { store } = makeStore()
    const { id } = store.start('a1', 'sleep 20', dir) as { id: string }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    await store.waitForNew(id, 15000, controller.signal)
    expect(Date.now() - started).toBeLessThan(5000)
    store.kill(id)
  }, 20000)

  it('waitForNew returns at once for an unknown id or an exited shell', async () => {
    const { store, exits } = makeStore()
    const started = Date.now()
    await store.waitForNew('deadbeef', 5000)
    const { id } = store.start('a1', 'exit 0', dir) as { id: string }
    await waitFor(() => exits.length === 1)
    await store.waitForNew(id, 5000)
    expect(Date.now() - started).toBeLessThan(4000)
  }, 20000)
```

Run: `npx vitest run tests/unit/background-process-store.test.ts`
Expected: FAIL. `waitForNew` is not a function.

- [ ] **Step 2: Implement `waitForNew`**

In `src/main/agent/background-process-store.ts`, add this method right after `readNew`:

```ts
  /**
   * Resolves when the shell has unread output, exits, `ms` elapses, or `signal`
   * aborts — whichever comes first. Lets bash_output block like Codex's
   * yield_time instead of forcing the model into a tight polling loop.
   */
  waitForNew(id: string, ms: number, signal?: AbortSignal): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.status === 'exited' || entry.buffer.length > entry.readOffset || ms <= 0 || signal?.aborted) {
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      const finish = (): void => {
        clearTimeout(timer)
        this.off('data', onData)
        this.off('exit', onExit)
        signal?.removeEventListener('abort', finish)
        resolve()
      }
      // 'data' fires before the chunk is buffered; the awaiting caller resumes
      // on a later microtask, after appendOutput has finished.
      const onData = (e: BgDataEvent): void => { if (e.id === id) finish() }
      const onExit = (e: BgExitEvent): void => { if (e.id === id) finish() }
      const timer = setTimeout(finish, ms)
      this.on('data', onData)
      this.on('exit', onExit)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }
```

Run: `npx vitest run tests/unit/background-process-store.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing tool tests**

Append inside `describe('background bash tools', ...)` in
`tests/unit/agent-tools-background-bash.test.ts`:

```ts
  it('bash_output waits for output instead of returning empty', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 1 && echo WAITED_OUT && sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const out = await bashOutputTool.run({ id, wait_s: 10 }, ctx)
    expect(out.output).toContain('WAITED_OUT')
    store.kill(id)
  }, 30000)

  it('bash_output with wait_s 0 returns immediately', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const t0 = Date.now()
    const out = await bashOutputTool.run({ id, wait_s: 0 }, ctx)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.output).toContain('(no new output)')
    store.kill(id)
  }, 20000)

  it('bash_output stops waiting on abort', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const t0 = Date.now()
    await bashOutputTool.run({ id, wait_s: 60 }, { ...ctx, signal: controller.signal })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(store.listenerCount('data')).toBe(0)
    store.kill(id)
  }, 20000)

  it('bash_output with a filter keeps waiting for a matching line', async () => {
    const { ctx, store } = ctxWithStore()
    const started = await bashTool.run({ command: 'echo noise && sleep 1 && echo READY_LINE && sleep 20', run_in_background: true }, ctx)
    const id = (started.output ?? '').match(/id=([0-9a-f]{8})/)![1]
    const out = await bashOutputTool.run({ id, filter: 'READY', wait_s: 10 }, ctx)
    expect(out.output).toContain('READY_LINE')
    store.kill(id)
  }, 30000)
```

Run: `npx vitest run tests/unit/agent-tools-background-bash.test.ts`
Expected: FAIL. The wait test returns `(no new output)` and the filter test misses the line.

- [ ] **Step 4: Implement `wait_s` in `bashOutputTool`**

In `src/main/agent/tools/bash.ts`, replace the whole `export const bashOutputTool: ToolDefinition = { ... }`
object with the following (keep `concurrencySafe: true` from Task 5):

```ts
const BASH_OUTPUT_DEFAULT_WAIT_S = 15
const BASH_OUTPUT_MAX_WAIT_S = 300

export const bashOutputTool: ToolDefinition = {
  name: 'bash_output',
  concurrencySafe: true,
  description:
    'Read new stdout/stderr produced by a background shell (started with bash run_in_background) since your last read. ' +
    `Waits up to wait_s seconds (default ${BASH_OUTPUT_DEFAULT_WAIT_S}, max ${BASH_OUTPUT_MAX_WAIT_S}) and returns as soon as ` +
    'there is new output or the shell exits, so never call it in a tight loop: pass a larger wait_s to wait longer, or end ' +
    'your turn — you are woken when the shell exits. Optionally pass a regex filter to keep only matching lines.',
  schema: z.object({
    id: z.string().describe('The background shell id returned by bash run_in_background.'),
    filter: z.string().optional().describe('Optional regex; only matching lines are returned.'),
    wait_s: z.number().optional()
      .describe(`Seconds to wait for new output (default ${BASH_OUTPUT_DEFAULT_WAIT_S}, max ${BASH_OUTPUT_MAX_WAIT_S}); 0 returns immediately.`)
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { id, filter, wait_s } = input as unknown as { id: string; filter?: string; wait_s?: number }
    const store = ctx.backgroundProcs
    if (!store) return { error: 'bash_output: background processes are not available here' }
    const waitS = typeof wait_s === 'number' && Number.isFinite(wait_s)
      ? Math.min(Math.max(wait_s, 0), BASH_OUTPUT_MAX_WAIT_S)
      : BASH_OUTPUT_DEFAULT_WAIT_S
    const deadline = Date.now() + waitS * 1000
    let r = store.readNew(id, filter)
    while (!('error' in r) && !r.text && r.status === 'running' && !ctx.signal?.aborted) {
      const left = deadline - Date.now()
      if (left <= 0) break
      await store.waitForNew(id, left, ctx.signal)
      r = store.readNew(id, filter)
    }
    if ('error' in r) return { error: r.error }
    const attrs = r.status === 'exited'
      ? `status="exited" exit_code="${r.exitCode ?? 'null'}"`
      : 'status="running"'
    return { output: `<bash id="${id}" ${attrs}>\n${r.text || '(no new output)'}\n</bash>` }
  }
}
```

Run: `npx vitest run tests/unit/agent-tools-background-bash.test.ts tests/unit/background-process-store.test.ts tests/unit/agent-tools-bash.test.ts`
Expected: PASS.

- [ ] **Step 5: Update docs**

1. `docs/reference/04-tool-catalog.md`, `### bash_output`: replace
   `` `{ id: string, filter?: string }` `` with `` `{ id: string, filter?: string, wait_s?: number }` ``
   and insert this sentence after `filter` is an optional regex pattern to filter lines.:
   ``` `wait_s` (default 15, clamped 0–300) blocks until there is new output (a matching line when `filter` is set), the shell exits, the time runs out, or the turn is stopped — so the model waits instead of busy-polling.```
2. `src/main/agent/tools/AGENTS.md`, `bash.ts` row: append
   `\`bash_output\` blocks up to \`wait_s\` (default 15, max 300) via \`BackgroundProcessStore.waitForNew\`, returning early on new/matching output, exit, or abort.`
3. `src/main/agent/AGENTS.md`, `background-process-store.ts` row: append
   `\`waitForNew(id, ms, signal)\` resolves on unread output, exit, timeout, or abort and always removes its listeners.`

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/background-process-store.ts src/main/agent/tools/bash.ts tests/unit/background-process-store.test.ts tests/unit/agent-tools-background-bash.test.ts src/main/agent/AGENTS.md src/main/agent/tools/AGENTS.md docs/reference/04-tool-catalog.md
git commit -m "feat(agent): bash_output waits for new output (wait_s, default 15s)"
```

---

### Task 9: Loop integration

This is the core task. It replaces the old guards in `SessionRunner` with the response guard,
the anti-repetition retry, the scheduler and the harness notes, and it emits the two new events.

**Files:**
- Modify: `src/shared/types.ts` (the `ChatEvent` union)
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/agent/repetition.ts` (delete the old `loopDetector`)
- Modify: `tests/unit/repetition.test.ts` (delete the `loopDetector` tests)
- Modify: `tests/unit/agent-loop.test.ts`
- Docs: `src/main/agent/AGENTS.md`, `docs/reference/03-agent-runtime.md`, `docs/reference/05-ipc-contract.md`

**Interfaces:**
- Consumes:
  - `createResponseGuard`, `MAX_TOOL_CALLS_PER_RESPONSE`, `GuardVerdict` (Task 4);
  - `toolLoopDetector`, `ToolLoopVerdict` (Task 3);
  - `scheduleBatches`, `runWithConcurrency` (Task 5);
  - `attachNote`, `cutNote`, `toolLoopNote`, `CutReason` (Task 5);
  - `LlmStreamPart.invalid/invalidReason`, `LlmStreamOptions.antiRepetition` (Task 6);
  - `ToolDefinition.concurrencySafe` (Task 5).
- Produces: `ChatEvent` members
  `{ type: 'step-start'; agentId: string; step: number }` and
  `{ type: 'step-discarded'; agentId: string; reason: 'repetition' }`.

- [ ] **Step 1: Add the event types**

In `src/shared/types.ts`, in the `ChatEvent` union, directly after the line
`  | { type: 'reasoning-delta'; agentId: string; delta: string }` add:

```ts
  | { type: 'step-start'; agentId: string; step: number }
  | { type: 'step-discarded'; agentId: string; reason: 'repetition' }
```

- [ ] **Step 2: Replace the old loop-guard tests with the new behavior tests**

In `tests/unit/agent-loop.test.ts`, delete everything from the comment line
`// Degenerate "thinking loop": a reasoning model that keeps re-emitting the same`
to the end of the file, and put this in its place:

```ts
function seedRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function variedReasoningStream(chunks: number): LlmStreamPart[] {
  const rnd = seedRng(7)
  const pool = Array.from({ length: 300 }, (_, i) => `w${i}`)
  const out: LlmStreamPart[] = []
  for (let i = 0; i < chunks; i++) {
    const n = 12 + Math.floor(rnd() * 10)
    const words = Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)])
    out.push({ kind: 'reasoning', text: words.join(' ') + '. ' })
  }
  out.push({ kind: 'finish' })
  return out
}

// "counselorcounselor…" — the character-level loop seen in a real session.
function repeatingStream(kind: 'text' | 'reasoning', prefix = ''): LlmStreamPart[] {
  return [
    ...(prefix ? [{ kind, text: prefix }] : []),
    ...Array.from({ length: 200 }, () => ({ kind, text: 'counselor' })),
    { kind: 'finish' as const, finishReason: 'length' }
  ]
}

const toolItems = (items: TranscriptItem[]) =>
  items.filter((i): i is Extract<TranscriptItem, { kind: 'tool' }> => i.kind === 'tool').map(i => i.tool)
const userTexts = (items: TranscriptItem[]) =>
  items.filter((i): i is { kind: 'message'; message: ChatMessage } => i.kind === 'message' && i.message.role === 'user').map(i => i.message.text)
const doneEvent = (events: ChatEvent[]) => events.find(e => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>

describe('SessionRunner stream repetition guard', () => {
  it('discards a repeating stream and retries the step once with anti-repetition sampling', async () => {
    const h = makeHarness()
    h.llm.queue = [repeatingStream('reasoning'), textParts('final answer')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))

    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(2)
    expect(h.llm.calls[0].antiRepetition).toBeUndefined()
    expect(h.llm.calls[1].antiRepetition).toBe(true)
    expect(h.events.some(e => e.type === 'step-discarded' && e.reason === 'repetition')).toBe(true)
    // No synthetic user message and no looped text in the transcript.
    expect(userTexts(h.items)).toEqual([])
    expect(JSON.stringify(h.items)).not.toContain('counselorcounselor')
  })

  it('ends as stuck/stream when the retry repeats too, keeping the clean prefix', async () => {
    const h = makeHarness()
    h.llm.queue = [repeatingStream('text', 'Here is the plan. '), repeatingStream('text', 'Here is the plan. ')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))

    const done = doneEvent(h.events)
    expect(done.reason).toBe('stuck')
    expect(done.stuckCategory).toBe('stream')
    expect(h.llm.calls.length).toBe(2)
    const assistant = h.items.find(i => i.kind === 'message' && i.message.role === 'assistant')
    expect(assistant?.kind === 'message' && assistant.message.text.startsWith('Here is the plan. ')).toBe(true)
    expect(assistant?.kind === 'message' && assistant.message.text.length).toBeLessThan(60)
  })

  it('aborts the underlying provider stream when it cuts a loop', async () => {
    let sawAbort = false
    const h = makeHarness({
      llm: {
        async *stream(opts: LlmStreamOptions) {
          opts.signal?.addEventListener('abort', () => { sawAbort = true }, { once: true })
          for (;;) {
            if (opts.signal?.aborted) return
            yield { kind: 'reasoning', text: 'counselor' }
            await new Promise(r => setTimeout(r, 0))
          }
        }
      } as LlmClient
    })
    h.runner.run()
    await new Promise(r => setTimeout(r, 200))
    expect(sawAbort).toBe(true)
  })

  it('leaves a long but non-repetitive reasoning stream untouched', async () => {
    const h = makeHarness()
    h.llm.queue = [variedReasoningStream(80)]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(1)
  })

  it('does not flag near-identical code in an answer', async () => {
    const code = ['alpha', 'beta', 'gamma', 'delta'].map(n =>
      `  it('renders the ${n} panel when the store flag is set to true', () => {\n` +
      `    const wrapper = mount(BaseSidePanel, { props: { panelId: '${n}', open: true } })\n` +
      `    expect(wrapper.find('[data-test="side-panel"]').exists()).toBe(true)\n  })\n`
    ).join('')
    const h = makeHarness()
    const chunks: string[] = []
    for (let i = 0; i < code.length; i += 7) chunks.push(code.slice(i, i + 7))
    h.llm.queue = [textParts(...chunks)]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(1)
  })

  it('emits step-start before every model request', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]) })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a' } }, { kind: 'finish' }],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    const starts = h.events.filter(e => e.type === 'step-start')
    expect(starts.length).toBe(h.llm.calls.length)
    expect(starts.map(e => e.type === 'step-start' && e.step)).toEqual([1, 2])
  })
})

describe('SessionRunner response cuts', () => {
  it('cuts a tool-call flood at 32 calls and notes it on the last result', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 5 })
    h.llm.queue = [
      [
        ...Array.from({ length: 40 }, (_, i): LlmStreamPart => ({ kind: 'tool-call', toolCallId: `tc${i}`, toolName: 'read', toolInput: { file_path: `f${i}.ts` } })),
        { kind: 'finish' }
      ],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 60))
    const tools = toolItems(h.items)
    expect(tools).toHaveLength(32)
    expect(tools[31].output).toContain('[meow]')
    expect(tools[31].output).toContain('after 32 tool calls')
    expect(tools[0].output).not.toContain('[meow]')
    expect(h.events.filter(e => e.type === 'tool-start')).toHaveLength(32)
    expect(userTexts(h.items)).toEqual([])
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('cuts call → text → call and drops the hallucinated tail', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]) })
    h.llm.queue = [
      [
        { kind: 'text', text: 'Checking. ' },
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } },
        { kind: 'text', text: 'The result shows the getter is missing, so now I will edit it. ' },
        { kind: 'tool-call', toolCallId: 'tc2', toolName: 'read', toolInput: { file_path: 'b.ts' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    const tools = toolItems(h.items)
    expect(tools.map(t => t.id)).toEqual(['tc1'])
    expect(tools[0].output).toContain('kept writing after calling tools')
    expect(h.events.some(e => e.type === 'tool-start' && e.call.id === 'tc2')).toBe(false)
    const firstAssistant = h.items.find(i => i.kind === 'message' && i.message.role === 'assistant')
    expect(firstAssistant?.kind === 'message' && firstAssistant.message.text).toBe('Checking. ')
  })

  it('treats repetition after a tool call as a cut: the call runs and gets a result', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]) })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'tc1', toolName: 'read', toolInput: { file_path: 'a.ts' } },
        ...Array.from({ length: 200 }, (): LlmStreamPart => ({ kind: 'reasoning', text: 'counselor' })),
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    const tools = toolItems(h.items)
    expect(tools.map(t => t.id)).toEqual(['tc1'])
    expect(tools[0].output).toContain('started repeating itself')
    expect(h.events.some(e => e.type === 'step-discarded')).toBe(false)
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('never executes an invalid tool call and reports why', async () => {
    const run = vi.fn(async () => ({ output: 'should not run' }))
    const h = makeHarness({ tools: new Map([['read', stubTool('read', run)]]) })
    h.llm.queue = [
      [{ kind: 'tool-call', toolCallId: 'bad', toolName: 'read', toolInput: {}, invalid: true, invalidReason: 'Invalid input: file_path is required' }, { kind: 'finish' }],
      textParts('ok')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    expect(run).not.toHaveBeenCalled()
    const [call] = toolItems(h.items)
    expect(call.permission).toBe('denied')
    expect(call.error).toContain('invalid tool call: Invalid input: file_path is required')
  })
})

describe('SessionRunner tool loops', () => {
  const sameRead = (i: number): LlmStreamPart[] => [
    { kind: 'tool-call', toolCallId: `tc-${i}`, toolName: 'read', toolInput: { file_path: 'a.ts' } },
    { kind: 'finish' }
  ]

  it('notes a repeated identical call in its result instead of adding a user message', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 10 })
    h.llm.queue = [sameRead(1), sameRead(2), sameRead(3), textParts('ok')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 60))
    const tools = toolItems(h.items)
    expect(tools[1].output).not.toContain('[meow]')
    expect(tools[2].output).toContain('returned the same result 3 times')
    expect(userTexts(h.items)).toEqual([])
    expect(doneEvent(h.events).reason).toBe('complete')
  })

  it('ends as stuck/tool when the loop survives two notes', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 20 })
    h.llm.queue = Array.from({ length: 20 }, (_, i) => sameRead(i))
    h.runner.run()
    await new Promise(r => setTimeout(r, 100))
    const done = doneEvent(h.events)
    expect(done.reason).toBe('stuck')
    expect(done.stuckCategory).toBe('tool')
    expect(done.stuckTool).toBe('read')
    expect(h.llm.calls.length).toBe(9)
  })

  it('does not flag varied tool calls as a loop', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 10 })
    h.llm.queue = [
      ...Array.from({ length: 4 }, (_, i): LlmStreamPart[] => [
        { kind: 'tool-call', toolCallId: `tc-${i}`, toolName: 'read', toolInput: { file_path: `file${i}.ts` } },
        { kind: 'finish' }
      ]),
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 60))
    expect(doneEvent(h.events).reason).toBe('complete')
  })
})

describe('SessionRunner tool scheduling', () => {
  it('runs concurrency-safe calls in parallel and everything else alone, in model order', async () => {
    const log: string[] = []
    let active = 0
    let peak = 0
    const tracked = (name: string, safe: boolean): ToolDefinition => ({
      ...stubTool(name, async (input) => {
        const tag = `${name}:${(input as { file_path?: string }).file_path ?? ''}`
        active++
        peak = Math.max(peak, active)
        log.push(`start ${tag}`)
        await new Promise(r => setTimeout(r, 10))
        log.push(`end ${tag}`)
        active--
        return { output: tag }
      }),
      ...(safe ? { concurrencySafe: true } : {})
    })
    const h = makeHarness({ tools: new Map([['read', tracked('read', true)], ['edit', tracked('edit', false)]]) })
    h.llm.queue = [
      [
        { kind: 'tool-call', toolCallId: 'r1', toolName: 'read', toolInput: { file_path: 'a' } },
        { kind: 'tool-call', toolCallId: 'r2', toolName: 'read', toolInput: { file_path: 'b' } },
        { kind: 'tool-call', toolCallId: 'e1', toolName: 'edit', toolInput: { file_path: 'c' } },
        { kind: 'tool-call', toolCallId: 'r3', toolName: 'read', toolInput: { file_path: 'd' } },
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 120))
    expect(peak).toBe(2)
    const at = (s: string) => log.indexOf(s)
    expect(at('start edit:c')).toBeGreaterThan(at('end read:a'))
    expect(at('start edit:c')).toBeGreaterThan(at('end read:b'))
    expect(at('start read:d')).toBeGreaterThan(at('end edit:c'))
    expect(toolItems(h.items).map(t => t.id)).toEqual(['r1', 'r2', 'e1', 'r3'])
  })
})
```

- [ ] **Step 3: Run the loop tests and confirm the new ones fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: FAIL on the new tests: no `step-start`, no `antiRepetition`, and none of the cut
notes, scheduling or invalid-call handling.

- [ ] **Step 4: Update the imports and fields in `loop.ts`**

In `src/main/agent/loop.ts`:

1. Replace the two lines

```ts
import { loopDetector, toolLoopDetector } from './repetition'
import type { LoopDetector, ToolLoopDetector } from './repetition'
```

   with

```ts
import { toolLoopDetector } from './repetition'
import type { ToolLoopDetector, ToolLoopVerdict } from './repetition'
import { createResponseGuard, MAX_TOOL_CALLS_PER_RESPONSE } from './response-guard'
import type { GuardVerdict } from './response-guard'
import { runWithConcurrency, scheduleBatches } from './tool-scheduler'
import { attachNote, cutNote, toolLoopNote } from './harness-note'
import type { CutReason } from './harness-note'
```

2. Delete the `LOOP_RECOVERY_PROMPT` constant and the two comment lines above
   `const MAX_LOOP_BREAKS = 2`. Put this comment above `MAX_LOOP_BREAKS` instead:

```ts
// Recoveries of every kind (repetition retry, response cut, tool-loop note) per
// run; past this many the turn ends as 'stuck'.
```

3. After the `classifyFinish` function, add:

```ts
interface DecidedCall {
  call: ToolCallData
  blocked: boolean
  decision: PermissionDecision
  preContext?: string
}
```

4. In the class fields, replace

```ts
  // Times the thinking-loop guard has nudged the model out of a repetition loop
  // in this run; past MAX_LOOP_BREAKS the turn ends as 'stuck'.
  private loopBreaksThisRun = 0
```

   with

```ts
  // Recoveries in this run; past MAX_LOOP_BREAKS the turn ends as 'stuck'.
  private loopBreaksThisRun = 0
```

   and replace

```ts
  // Text/reasoning + tool-call repetition guards, per-run (not per-step): a
  // loop that spans several steps — same sentence, tool call, same sentence
  // again — never accumulates enough repetition inside any single step for a
  // per-step detector to catch it.
  private loop: LoopDetector = loopDetector()
  private toolLoop: ToolLoopDetector = toolLoopDetector()
```

   with

```ts
  // Per run: a tool loop spans steps. The stream guard is per step (see run()).
  private toolLoop: ToolLoopDetector = toolLoopDetector()
```

5. In `run()`, delete the line `this.loop = loopDetector()`.

- [ ] **Step 5: Replace the step body in `run()`**

In `run()`:

1. Replace

```ts
    let steps = 0
```

   with

```ts
    let steps = 0
    // A step discarded for repetition is re-run once with anti-repetition
    // sampling; the retry does not consume a step.
    let retryStep = false
```

2. Replace the block from `      steps++` through the closing `}` of the `while (true)` loop
   (i.e. everything after the steering `if (steers.length > 0) { ... }` block, up to but not
   including the closing `  }` of `run()`) with:

```ts
      const antiRepetition = retryStep
      retryStep = false
      if (!antiRepetition) steps++
      const isLastStep = steps >= this.maxSteps

      await this.compactIfOverThreshold(signal)

      const llmMessages = this.buildMessages(isLastStep)
      let textBuffer = ''
      let reasoningBuffer = ''
      let tokens: MessageTokens | undefined
      let finishReason: string | undefined
      const calls: ToolCallData[] = []
      const guard = createResponseGuard()
      let verdict: GuardVerdict = { kind: 'ok' }
      const persistPartial = () => {
        if (!textBuffer && !reasoningBuffer) return
        this.deps.appendMessage({
          id: randomUUID(),
          role: 'assistant',
          text: textBuffer,
          reasoning: reasoningBuffer || undefined,
          tokens,
          createdAt: Date.now()
        })
      }
      let recover = false
      // Each step gets its own controller chained to the run's. Aborting it
      // when the guard cuts a stream short actually cancels the provider's
      // HTTP/SSE request — a `break` out of the `for await` only stops
      // consuming parts; it does not guarantee the underlying stream (and its
      // token bill) stops.
      const stepController = new AbortController()
      const stepSignal = stepController.signal
      const onRunAbort = (): void => stepController.abort()
      if (signal?.aborted) stepController.abort()
      else signal?.addEventListener('abort', onRunAbort, { once: true })
      this.deps.onEvent({ type: 'step-start', agentId, step: steps })
      try {
        const stream = this.deps.llm.stream({
          model: this.deps.model,
          system,
          messages: llmMessages,
          tools: isLastStep ? [] : this.visibleToolDefs(),
          signal: stepSignal,
          maxOutputTokens: this.deps.maxOutputTokensWire,
          variantOptions: this.deps.variantOptions,
          ...(antiRepetition ? { antiRepetition: true } : {})
        })
        for await (const part of stream) {
          if (stepSignal.aborted) {
            persistPartial()
            this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
            return
          }
          if (part.kind === 'text') {
            const delta = part.text ?? ''
            textBuffer = appendStreamDelta(textBuffer, delta)
            this.deps.onEvent({ type: 'text-delta', agentId, delta })
            verdict = guard.text(delta)
            if (verdict.kind !== 'ok') break
          } else if (part.kind === 'reasoning') {
            const delta = part.text ?? ''
            reasoningBuffer = appendStreamDelta(reasoningBuffer, delta)
            this.deps.onEvent({ type: 'reasoning-delta', agentId, delta })
            verdict = guard.reasoning(delta)
            if (verdict.kind !== 'ok') break
          } else if (part.kind === 'tool-call') {
            // A call the guard rejects is never announced, so no tool-start is
            // left without a result.
            verdict = guard.toolCall()
            if (verdict.kind !== 'ok') break
            const call: ToolCallData = {
              id: part.toolCallId ?? randomUUID(),
              tool: part.toolName ?? 'unknown',
              input: part.toolInput ?? {},
              permission: 'pending'
            }
            if (part.invalid) {
              call.permission = 'denied'
              call.error = `invalid tool call: ${part.invalidReason ?? 'unknown tool or malformed arguments'}. ` +
                'Check the tool name and arguments against the schema.'
            }
            calls.push(call)
            this.deps.onEvent({ type: 'tool-start', agentId, call })
          } else if (part.kind === 'finish') {
            tokens = part.tokens
            finishReason = part.finishReason
            if (part.tokens) {
              this.lastTokens = part.tokens
              runUsage.input += part.tokens.input
              runUsage.output += part.tokens.output
              runUsage.total += part.tokens.total
              runUsage.cacheRead += part.tokens.cacheRead ?? 0
              runUsage.cacheWrite += part.tokens.cacheWrite ?? 0
              this.deps.onUsage?.(part.tokens)
            }
          } else if (part.kind === 'error') {
            if (await this.tryRecoverFromReject(llmMessages, part.error, signal)) {
              // A retried step was never counted; keep retrying it instead.
              if (antiRepetition) retryStep = true
              else steps--
              recover = true
              break
            }
            persistPartial()
            this.deps.onEvent({ type: 'error', agentId, message: part.error ?? 'llm error' })
            return
          }
        }
      } catch (err) {
        const message = formatLlmError(err)
        if (await this.tryRecoverFromReject(llmMessages, message, signal)) {
          if (antiRepetition) retryStep = true
          else steps--
          stepController.abort()
          signal?.removeEventListener('abort', onRunAbort)
          continue
        }
        persistPartial()
        if (signal?.aborted) {
          this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        } else {
          this.deps.onEvent({ type: 'error', agentId, message })
        }
        return
      } finally {
        signal?.removeEventListener('abort', onRunAbort)
      }
      if (recover) {
        stepController.abort()
        continue
      }

      if (signal?.aborted) {
        persistPartial()
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }

      if (verdict.kind !== 'ok') stepController.abort()

      if (verdict.kind === 'repetition' && calls.length === 0) {
        this.loopBreaksThisRun++
        if (antiRepetition || this.loopBreaksThisRun > MAX_LOOP_BREAKS) {
          const text = verdict.channel === 'text' ? textBuffer.slice(0, verdict.keepChars) : textBuffer
          const reasoning = verdict.channel === 'reasoning' ? reasoningBuffer.slice(0, verdict.keepChars) : reasoningBuffer
          if (text || reasoning) {
            this.deps.appendMessage({ id: randomUUID(), role: 'assistant', text, reasoning: reasoning || undefined, tokens, createdAt: Date.now() })
          }
          this.deps.onEvent({
            type: 'done', agentId, reason: 'stuck', stuckCategory: 'stream',
            recoveryCount: this.loopBreaksThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
          })
          return
        }
        // The looped output never reaches the transcript; the UI drops its bubble.
        this.deps.onEvent({ type: 'step-discarded', agentId, reason: 'repetition' })
        retryStep = true
        continue
      }

      // Any other verdict cuts the response but keeps the calls already
      // announced: each must get a result.
      const cut: CutReason | undefined = verdict.kind === 'ok' ? undefined : verdict.kind
      if (cut) {
        this.loopBreaksThisRun++
        textBuffer = textBuffer.slice(0, guard.textBeforeFirstCall())
      }

      if (textBuffer || calls.length > 0 || reasoningBuffer) {
        this.deps.appendMessage({
          id: randomUUID(),
          role: 'assistant',
          text: textBuffer,
          reasoning: reasoningBuffer || undefined,
          tokens,
          createdAt: Date.now()
        })
      }

      // PreToolUse hooks and permission decisions run up front for every call,
      // concurrently, the way they did before scheduling existed.
      const decided = await Promise.all(calls.map(call => this.decideCall(call)))
      const lastCall = calls[calls.length - 1]
      const parallel = (d: DecidedCall): boolean =>
        !d.blocked && d.decision === 'allow' && this.deps.tools.get(d.call.tool)?.concurrencySafe === true
      let tripped: Exclude<ToolLoopVerdict, { kind: 'ok' }> | undefined
      for (const batch of scheduleBatches(decided, parallel)) {
        await runWithConcurrency(batch.map(d => () => this.runCall(d, signal)))
        for (const d of batch) {
          const verdictForCall = this.finishCall(d.call, cut && d.call === lastCall ? cut : undefined)
          if (verdictForCall) tripped = verdictForCall
        }
      }

      if (tripped) this.loopBreaksThisRun++
      if ((cut || tripped) && this.loopBreaksThisRun > MAX_LOOP_BREAKS) {
        this.deps.onEvent({
          type: 'done', agentId, reason: 'stuck',
          stuckCategory: tripped ? 'tool' : 'stream',
          ...(tripped ? { stuckTool: tripped.tool } : {}),
          recoveryCount: this.loopBreaksThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
        })
        return
      }

      if (calls.length === 0) {
        // The provider cut the answer at the output cap without calling a tool.
        // Resume the turn with a continuation nudge up to MAX_LENGTH_RESUMES
        // times; past the cap, report 'length' so the UI can tell the user the
        // answer is cut off.
        if (classifyFinish(finishReason) === 'length' && this.lengthResumesThisRun < MAX_LENGTH_RESUMES) {
          this.lengthResumesThisRun++
          this.deps.appendMessage({
            id: randomUUID(),
            role: 'user',
            text: CONTINUE_TRUNCATED_PROMPT,
            createdAt: Date.now()
          })
          continue
        }
        const reason = classifyFinish(finishReason)
        if (await this.blockedByStopHook(textBuffer)) {
          steps = 0
          continue
        }
        this.deps.onEvent({ type: 'done', agentId, reason, tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
      if (isLastStep) {
        if (await this.blockedByStopHook(textBuffer)) {
          steps = 0
          continue
        }
        this.deps.onEvent({ type: 'done', agentId, reason: 'max-steps', tokens, cost: this.deps.computeCost?.(runUsage) })
        return
      }
    }
```

   Make sure the method still ends with its own closing `  }` after this block. The `while`
   loop's closing brace is the last `    }` above.

- [ ] **Step 6: Split `executeCall` into `decideCall` / `runCall` / `finishCall`**

1. Rename the method `private async executeCall(` to `private async runCall(` and change its
   signature and first lines from

```ts
  private async executeCall(
    call: ToolCallData,
    decision: PermissionDecision,
    signal?: AbortSignal,
    preContext?: string
  ): Promise<void> {
    const { agentId } = this.deps
```

   to

```ts
  // Runs one decided call and fills in its result. Appending is left to
  // finishCall so results reach the transcript in model order.
  private async runCall(d: DecidedCall, signal?: AbortSignal): Promise<void> {
    if (d.blocked) return
    const { call, decision, preContext } = d
    const { agentId } = this.deps
```

2. At the end of that method, delete the two lines

```ts
    this.deps.appendTool(call)
    this.deps.onEvent({ type: 'tool-result', agentId, call })
```

   (keep the closing `  }`).

3. Directly above `runCall`, add:

```ts
  private async decideCall(call: ToolCallData): Promise<DecidedCall> {
    // Refused while streaming (SDK-invalid call): never runs.
    if (call.permission === 'denied') return { call, blocked: true, decision: 'deny' }
    const pre = this.hooks ? await this.hooks.runPreToolUse(call.tool, call.input) : undefined
    if (pre?.decision === 'deny') {
      call.permission = 'denied'
      call.error = pre.reason ?? `tool "${call.tool}" was blocked by a PreToolUse hook`
      return { call, blocked: true, decision: 'deny' }
    }
    // Replaces the whole input, so a hook can rewrite a path or drop a flag.
    if (pre?.updatedInput) call.input = pre.updatedInput
    let decision = this.deps.decidePermission(call.tool, call.input)
    // A hook may tighten to 'ask' or waive a prompt, but it can never
    // override a config deny — hooks tighten, they do not loosen.
    if (pre?.decision === 'ask' && decision === 'allow') decision = 'ask'
    else if (pre?.decision === 'allow' && decision === 'ask') decision = 'allow'
    return { call, blocked: false, decision, preContext: pre?.additionalContext }
  }

  // Appends one completed call. The tool-loop check sees the tool's own result
  // (before any note), and its note rides on that result.
  private finishCall(call: ToolCallData, cut?: CutReason): Exclude<ToolLoopVerdict, { kind: 'ok' }> | undefined {
    const verdict = this.toolLoop.observe({ tool: call.tool, input: call.input, output: call.output, error: call.error })
    const tripped = verdict.kind === 'ok' ? undefined : verdict
    if (tripped) {
      attachNote(call, toolLoopNote(tripped))
      this.toolLoop.reset()
    }
    if (cut) attachNote(call, cutNote(cut, MAX_TOOL_CALLS_PER_RESPONSE))
    this.deps.appendTool(call)
    this.deps.onEvent({ type: 'tool-result', agentId: this.deps.agentId, call })
    return tripped
  }
```

- [ ] **Step 7: Remove the old `loopDetector`**

1. In `src/main/agent/repetition.ts`, delete everything from the top doc comment
   `/**\n * Degenerate "thinking loop" guard.` through the closing `}` of `export function loopDetector`
   (the constants `DEFAULT_PHRASE_LEN`, `DEFAULT_MIN_REPEATS`, `DEFAULT_TAIL_WORDS`, the
   `LoopDetector` interface and `loopDetector`). Move the line `import { createHash } from 'node:crypto'`
   to the top of the file.
2. In `tests/unit/repetition.test.ts`, delete the whole `describe('loopDetector', ...)` block and
   the `feedChunks` helper. Change the import to
   `import { isIdlePoll, repeatDetector, toolLoopDetector } from '../../src/main/agent/repetition'`.
   Keep `LOOP_SENTENCES`, `seedRng` and `variedReasoningChunks`; the `repeatDetector` tests use them.

- [ ] **Step 8: Make `task.ts` ignore the new events explicitly**

No code change is needed: `task.ts`'s `onEvent` only matches known types, so `step-start` and
`step-discarded` fall through. Confirm with:
`grep -n "step-" src/main/agent/tools/task.ts`. Expected: no matches.

- [ ] **Step 9: Run the tests and typecheck**

Run: `npx vitest run tests/unit/agent-loop.test.ts tests/unit/agent-loop-steering.test.ts tests/unit/repetition.test.ts tests/unit/agent-task-tool.test.ts tests/unit/agent-task.test.ts`
Expected: PASS.

If `'runs auto-approved calls before prompting for an ask call'` or `'blocks a denied tool call
without running the tool'` fails on event order: both behaviors still hold, but blocked calls
are now appended in model order rather than first. Change only the order assertion so it
matches the model's call order. Do not change the behavior.

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm test`
Expected: all pass.

- [ ] **Step 10: Update docs**

1. `docs/reference/05-ipc-contract.md`, in the ChatEvent table, after the `reasoning-delta` row, add:

```md
| `step-start` | `step: number` | A model request is about to start (display-only; the UI opens a new bubble for the step) |
| `step-discarded` | `reason: 'repetition'` | The step's streamed output was dropped by the repetition guard and the step is retried (display-only) |
```

   and change the `done` row's meaning to
   ``Turn finished. `reason` ∈ `complete` \| `stopped` \| `max-steps` \| `length` \| `refusal` \| `stuck`; `stuck` carries `stuckCategory` (`stream` \| `tool`), `stuckTool?`, `recoveryCount?` ``.

2. `docs/reference/03-agent-runtime.md` §3.4: replace the pseudo-code block (from ```` ``` ````
   after "## 3.4 The turn loop" through its closing ```` ``` ````) with:

````md
```
resolve system prompt (once per run)
resolve compaction knobs from the model context window (once per run)
loop:
  if aborted            → emit done{reason:'stopped'}; return
  steers = takeSteers()
  if steers.length > 0  → append each as a user message, emit user-message,
                          reset steps = 0, continue        ← steering
  steps++ (not on a repetition retry)
  isLastStep = steps >= maxSteps
  await compactIfOverThreshold(signal)
  llmMessages = toLlmMessages(items, opts)  (+ MAX_STEPS_PROMPT when isLastStep)
  emit step-start{step}
  guard = createResponseGuard()
  stream = llm.stream({ ..., antiRepetition only on a repetition retry })
  for each part (every text/reasoning/tool-call part goes through the guard first):
    text / reasoning → append to buffer, emit delta
    tool-call        → accepted: record ToolCallData (SDK-invalid → denied with an error), emit tool-start
    guard verdict ≠ ok → abort the step's stream
    finish / error   → as before (error: compact-on-reject retry)
  repetition with no calls:
    first time  → emit step-discarded, retry the step with antiRepetition (transcript untouched)
    on the retry, or past MAX_LOOP_BREAKS → persist the clean prefix, done{stuck, stuckCategory:'stream'}
  tool-flood / interleaved / repetition after calls → cut: keep text before the first call and the accepted calls
  append the assistant message
  decide hooks + permission for every call (up front, concurrently)
  run calls in model-order batches (concurrencySafe + allow together, ≤ 10 in flight; others alone)
  append each result in model order; a tool-loop verdict or the cut adds a [meow] note to that result
  past MAX_LOOP_BREAKS recoveries → done{stuck, stuckCategory:'tool'|'stream'}
  if no tool call:
    if length/max_tokens and resumes < MAX_LENGTH_RESUMES → append continuation nudge (user msg), continue
    emit done{reason: classifyFinish(finishReason)}; return
  if isLastStep   → emit done{reason:'max-steps'}; return
```
````

   Then replace the notable-details bullet starting `- Stream text and reasoning deltas are incremental`
   with:

```md
- Stream text and reasoning deltas are incremental and concatenated verbatim. The per-step
  response guard (`response-guard.ts`) cuts a response at 32 tool calls (`tool-flood`), at a
  call → text → call pattern (`interleaved`, a model inventing results it never received), or at a
  character-level tandem repeat (`repetition`, `repeatDetector`). A repetition with no calls is
  discarded and retried once with `antiRepetition`; every other cut keeps the accepted calls and
  notes the cut on the last result. The tool-loop detector compares completed call + result
  fingerprints, so test/edit/test progress is not flagged; idle `bash_output` polling gets a
  "wait" note, other repeats a "change course" note. The loop never adds a synthetic user message
  for recovery; all recovery text is a `<system-reminder>[meow]` note on a tool result. Recoveries
  share `MAX_LOOP_BREAKS` (2) per run, then the turn ends `stuck`.
```

   Add these rows to the Constants table:

```md
| `MAX_TOOL_CALLS_PER_RESPONSE` | 32 | `response-guard.ts` |
| `MAX_TOOL_CONCURRENCY` | 10 | `tool-scheduler.ts` |
| `MAX_LOOP_BREAKS` | 2 | `loop.ts` |
```

   In §3.5 step 5, replace `5. Append the tool item to the transcript and emit \`tool-result\`.` with
   `5. After the call's batch settles, \`finishCall\` runs the tool-loop check, attaches any note, appends the tool item in model order, and emits \`tool-result\`.`

3. `src/main/agent/AGENTS.md`:
   - In the `loop.ts` row, replace the text from `a degenerate repetition is cut off by the loop guards`
     through `report \`done('stuck')\`;` with:
     ``each step runs through `createResponseGuard` (tool flood at 32, call → text → call, character-level repetition) and emits `step-start`; a repetition with no calls is discarded (`step-discarded`) and retried once with `antiRepetition`, other cuts keep the accepted calls and note the cut on the last result; calls are decided up front, run in model-order batches (`tool-scheduler.ts`), and appended by `finishCall`, where the per-run `toolLoopDetector` may attach a `[meow]` note; recoveries share `MAX_LOOP_BREAKS` (2) then report `done('stuck')` with `stuckCategory`;``
   - Replace the `repetition.ts` row with:
     ``| `repetition.ts` | Degenerate loop detectors. `repeatDetector` flags a character-level tandem repeat at the tail of one streamed channel (any script; ignores separator-only units) and returns the raw length to keep; `toolLoopDetector.observe` reports `poll` (idle `bash_output`) or `repeat` when the same call + result recurs 3× in 8 completed calls. Both pure + unit-tested. |``
   - Add a row after `repetition.ts`:
     ``| `response-guard.ts` | `createResponseGuard()` per step: `tool-flood` past `MAX_TOOL_CALLS_PER_RESPONSE` (32), `interleaved` on call → text → call, `repetition` from `repeatDetector` per channel; `textBeforeFirstCall()` bounds the text kept on a cut. |``

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/main/agent/loop.ts src/main/agent/repetition.ts tests/unit/agent-loop.test.ts tests/unit/repetition.test.ts src/main/agent/AGENTS.md docs/reference/03-agent-runtime.md docs/reference/05-ipc-contract.md
git commit -m "feat(agent): response guard, repetition retry, scheduled tools, and harness notes in the loop"
```

---

### Task 10: Renderer, one bubble per step

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Docs: `src/renderer/src/components/chat/AGENTS.md`

**Interfaces:**
- Consumes: the `step-start` and `step-discarded` ChatEvents (Task 9).

There are no renderer unit tests in this repo (see `src/renderer/AGENTS.md`). Verification is
typecheck plus the e2e smoke run in Task 11.

- [ ] **Step 1: Add the feed item and refs**

In `ChatPanel.tsx`:

1. In the `type FeedItem =` union, after the `retry` member add:
   `  | { kind: 'notice'; id: string; text: string }`
2. Right after `const retryIdRef = useRef<string | null>(null)` add:

```ts
  // Set by step-start: the next delta opens a new assistant bubble, so each
  // model request renders as its own row instead of being glued to the last.
  const newBubbleRef = useRef(false)
  // Bubbles opened since the last step-start, dropped on step-discarded.
  const stepBubbleIdsRef = useRef<string[]>([])
  // Unique ids even when two bubbles open in the same millisecond.
  const bubbleSeqRef = useRef(0)
  const noticeIdRef = useRef<string | null>(null)
```

- [ ] **Step 2: Replace `flushDeltas`**

Replace the whole `const flushDeltas = useCallback(() => { ... }, [setItems])` with:

```ts
  const flushDeltas = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const { text, reasoning } = deltaBufRef.current
    if (!text && !reasoning) return
    deltaBufRef.current = { text: '', reasoning: '' }
    const forceNew = newBubbleRef.current
    newBubbleRef.current = false
    const newId = `a-${Date.now()}-${++bubbleSeqRef.current}`
    setItems(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!forceNew && last && last.kind === 'message' && last.role === 'assistant') {
        next[next.length - 1] = {
          ...last,
          text: text ? appendStreamDelta(last.text, text) : last.text,
          reasoning: reasoning ? appendStreamDelta(last.reasoning ?? '', reasoning) : last.reasoning
        }
      } else {
        next.push({ kind: 'message', id: newId, role: 'assistant', text, reasoning: reasoning || undefined })
      }
      return next
    })
    if (forceNew) stepBubbleIdsRef.current.push(newId)
  }, [setItems])
```

- [ ] **Step 3: Handle the new events and clear the notice**

In `applyEvent`:

1. Right after the `clearRetry` const, add:

```ts
    const clearNotice = () => {
      if (noticeIdRef.current == null) return
      const id = noticeIdRef.current
      noticeIdRef.current = null
      setItems(prev => prev.filter(i => !(i.kind === 'notice' && i.id === id)))
    }
```

2. Right before `if (e.type === 'text-delta' || e.type === 'reasoning-delta') {` add:

```ts
    if (e.type === 'step-start') {
      flushDeltas()
      newBubbleRef.current = true
      stepBubbleIdsRef.current = []
      return
    }
    if (e.type === 'step-discarded') {
      flushDeltas()
      const drop = new Set(stepBubbleIdsRef.current)
      stepBubbleIdsRef.current = []
      const id = 'n-' + Date.now()
      noticeIdRef.current = id
      setItems(prev => [
        ...prev.filter(i => !(i.kind === 'message' && drop.has(i.id))),
        { kind: 'notice', id, text: 'Model output started repeating — retrying…' }
      ])
      return
    }
```

3. Inside the `if (e.type === 'text-delta' || e.type === 'reasoning-delta') {` block, after
   `clearRetry()` add `clearNotice()`.
4. Inside the `if (e.type === 'done' || e.type === 'error') {` block, after `clearRetry()` add
   `clearNotice()`.
5. In the `stuck` branch, replace

```ts
          : e.stuckCategory === 'stream' ? ' The provider stream repeated the same content.' : ''
```

   with

```ts
          : e.stuckCategory === 'stream' ? ' Its output kept repeating, even after a retry.' : ''
```

- [ ] **Step 4: Render the notice row**

In the feed JSX, right after the `if (item.kind === 'retry') { ... }` block, add:

```tsx
          if (item.kind === 'notice') {
            return <div key={item.id} className="chat-compacted running">{item.text}</div>
          }
```

(`chat-compacted running` is the existing muted transient-line style used by the compaction
line, so no CSS change is needed.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If `feedItemKey` or any `switch` on `FeedItem.kind` reports an unhandled
`'notice'`, handle it the same way as `'retry'`: `feedItemKey` already produces
`` `${item.kind}:${item.id}` ``, which works for `notice`.

- [ ] **Step 6: Update docs**

In `src/renderer/src/components/chat/AGENTS.md`, `ChatPanel.tsx` row, after
`rAF-batches stream deltas,` insert:
``opens a new assistant bubble on each `step-start` (ids carry a sequence counter so same-millisecond bubbles never collide) and, on `step-discarded`, drops that step's bubbles and shows a transient "Model output started repeating — retrying…" notice (feed-only, cleared on the next delta or turn end),``

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/components/chat/AGENTS.md
git commit -m "feat(chat): one bubble per model step; drop discarded repeating output"
```

---

### Task 11: Full verification

**Files:** none (unless a check fails).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Unit and integration tests**

Run: `npm test`
Expected: all test files pass. If a failure is outside the files touched by this plan, re-run
the single file once. Report it if it still fails; do not modify unrelated tests.

- [ ] **Step 3: Build and e2e smoke**

Run: `npm run build`
Expected: exit 0.
Run: `npm run e2e`
Expected: all Playwright specs pass.

- [ ] **Step 4: Check for leftovers**

Run: `git grep -n "loopDetector\b\|LOOP_RECOVERY_PROMPT\|single next concrete action\|provider: 'deepseek'" -- src tests`
Expected: no matches.
Run: `git grep -n "execute: async () => ({ ok: true })" -- src`
Expected: no matches.

- [ ] **Step 5: Final commit (only if Steps 1-4 required fixes)**

```bash
git add -A
git commit -m "chore(agent): fix verification findings for loop robustness"
```
