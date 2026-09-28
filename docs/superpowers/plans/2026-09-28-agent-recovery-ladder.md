# Agent Recovery Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run-wide `MAX_LOOP_BREAKS` stop rule with a sliding-window recovery ladder, so a looping model is recovered automatically and a turn pauses to ask the user instead of ending with "The model could not make progress…".

**Architecture:** A new pure module `src/main/agent/recovery-policy.ts` maps each repetition / tool-loop hit to a level (1–4) and resets after 3 clean steps. `SessionRunner` (`src/main/agent/loop.ts`) executes the level: re-run with an ephemeral recovery note, add anti-repetition sampling, force-compact, or pause with a `question` prompt. The renderer shows the level in the existing "repeating" notice and a new stuck text.

**Tech Stack:** Electron main process, TypeScript (strict), React 19 renderer, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-agent-recovery-ladder-design.md`

## Global Constraints

- Code, UI labels and docs in English; system-style notices prefixed `[meow]`.
- No hardcoded IPC channel strings; this plan adds no IPC channel.
- Do not add unnecessary comments; comment only non-obvious decisions.
- Git commits: **no** `Co-Authored-By` trailer (AGENTS.md).
- `RECOVERY_RESET_STEPS = 3`; 3 automatic levels before the pause; `ANTI_REPETITION_FREQUENCY_PENALTY` stays 0.5.
- `interleaved` / `tool-flood` cuts are never recovery hits and never end a turn.
- Recovery text never enters the transcript: the no-call re-run note is ephemeral (request only).
- Before completion: `npm run typecheck` and `npm test` pass.
- Code changes update `AGENTS.md` and the matching `docs/reference/*.md` page.

## File Map

| File | Change |
|---|---|
| `src/main/agent/recovery-policy.ts` | **Create** — ladder state machine |
| `tests/unit/recovery-policy.test.ts` | **Create** |
| `src/main/agent/harness-note.ts` | Add `recoveryNote()` |
| `tests/unit/harness-note.test.ts` | Test `recoveryNote()` |
| `src/shared/types.ts:254` | `step-discarded.recovery` |
| `src/main/agent/loop.ts` | Ladder execution, pause, logging; remove `MAX_LOOP_BREAKS`, `loopBreaksThisRun`, `consecutiveCutsThisRun` |
| `tests/unit/agent-loop.test.ts` | Update repetition / cut / tool-loop tests; add ladder + pause tests |
| `src/main/meow-agent-manager.ts:1620` | `pauseOnStuck: true` for top-level sessions |
| `src/renderer/src/components/chat/ChatPanel.tsx:702-756` | Notice level, stuck text |
| `src/main/agent/AGENTS.md`, `docs/reference/03-agent-runtime.md`, `05-ipc-contract.md`, `09-ui-guide.md` | Docs |
| `docs/superpowers/specs/2026-09-28-agent-recovery-ladder-design.md` | Two corrections (Task 1) |

---

### Task 1: Recovery policy module

**Files:**
- Create: `src/main/agent/recovery-policy.ts`
- Create: `tests/unit/recovery-policy.test.ts`
- Modify: `src/main/agent/AGENTS.md` (key-files table)
- Modify: `docs/superpowers/specs/2026-09-28-agent-recovery-ladder-design.md` (§5.4, §5.5)

**Interfaces:**
- Produces:
  ```ts
  export const RECOVERY_RESET_STEPS = 3
  export const RECOVERY_AUTO_LEVELS = 3
  export type RecoveryHit = 'repetition' | 'tool-loop'
  export type RecoveryLevel = 1 | 2 | 3 | 4
  export interface RecoveryPolicy { onHit(hit: RecoveryHit): RecoveryLevel; onCleanStep(): void; reset(): void }
  export function recoveryPolicy(opts?: { resetAfterCleanSteps?: number }): RecoveryPolicy
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/recovery-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RECOVERY_RESET_STEPS, recoveryPolicy } from '../../src/main/agent/recovery-policy'

describe('recoveryPolicy', () => {
  it('escalates one level per hit and caps at the pause level', () => {
    const p = recoveryPolicy()
    expect([p.onHit('repetition'), p.onHit('tool-loop'), p.onHit('repetition'), p.onHit('repetition'), p.onHit('repetition')])
      .toEqual([1, 2, 3, 4, 4])
  })

  it('returns to level 1 after enough consecutive clean steps', () => {
    const p = recoveryPolicy()
    p.onHit('repetition')
    p.onHit('repetition')
    for (let i = 0; i < RECOVERY_RESET_STEPS; i++) p.onCleanStep()
    expect(p.onHit('repetition')).toBe(1)
  })

  it('does not reset when clean steps are interrupted by a hit', () => {
    const p = recoveryPolicy()
    p.onHit('tool-loop')
    p.onCleanStep()
    p.onCleanStep()
    expect(p.onHit('tool-loop')).toBe(2)
    p.onCleanStep()
    p.onCleanStep()
    expect(p.onHit('tool-loop')).toBe(3)
  })

  it('reset() starts the ladder over', () => {
    const p = recoveryPolicy()
    p.onHit('repetition')
    p.onHit('repetition')
    p.onHit('repetition')
    p.onHit('repetition')
    p.reset()
    expect(p.onHit('repetition')).toBe(1)
  })

  it('honors a custom reset window', () => {
    const p = recoveryPolicy({ resetAfterCleanSteps: 1 })
    p.onHit('repetition')
    p.onCleanStep()
    expect(p.onHit('repetition')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/recovery-policy.test.ts`
Expected: FAIL — cannot resolve `../../src/main/agent/recovery-policy`.

- [ ] **Step 3: Write minimal implementation**

`src/main/agent/recovery-policy.ts`:

```ts
/**
 * Recovery ladder for a degenerate model. Each hit (a looping stream or a
 * repeated tool call) climbs one level; enough clean steps in a row drop back
 * to the bottom, so stumbles far apart in a long turn never add up to a stop.
 */
export const RECOVERY_RESET_STEPS = 3
export const RECOVERY_AUTO_LEVELS = 3

export type RecoveryHit = 'repetition' | 'tool-loop'
/** 1–3 are automatic recoveries; 4 pauses and asks the user. */
export type RecoveryLevel = 1 | 2 | 3 | 4

export interface RecoveryPolicy {
  onHit(hit: RecoveryHit): RecoveryLevel
  onCleanStep(): void
  reset(): void
}

export function recoveryPolicy(opts?: { resetAfterCleanSteps?: number }): RecoveryPolicy {
  const resetAfter = opts?.resetAfterCleanSteps ?? RECOVERY_RESET_STEPS
  let level = 0
  let clean = 0
  return {
    onHit(): RecoveryLevel {
      clean = 0
      level = Math.min(level + 1, RECOVERY_AUTO_LEVELS + 1)
      return level as RecoveryLevel
    },
    onCleanStep(): void {
      if (level === 0) return
      clean++
      if (clean >= resetAfter) {
        level = 0
        clean = 0
      }
    },
    reset(): void {
      level = 0
      clean = 0
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/recovery-policy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update AGENTS.md and correct the spec**

In `src/main/agent/AGENTS.md`, add one row to the key-files table directly after the `repetition.ts` row, in the same format:

```
| `recovery-policy.ts` | Recovery ladder for degenerate models: `recoveryPolicy().onHit(hit)` climbs levels 1→4 (1–3 automatic, 4 = pause), `onCleanStep` resets after `RECOVERY_RESET_STEPS` (3) clean steps in a row, `reset()` after the user chooses Continue. Pure + unit-tested. |
```

In the spec, replace the §5.4 paragraph that starts "Subagents and turns without a user" with:

```
Only top-level sessions pause (`LoopDeps.pauseOnStuck`, set by `MeowAgentManager`); delegated
sessions are top-level sessions and already block on permission prompts the same way. Subagents
run by the `task` tool do not pause: level 4 ends the subagent turn with `done{reason:'stuck'}`,
and the parent handles it as today.
```

and in §5.5 replace `model=<provider/model>` with `model=<model id>`.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/recovery-policy.ts tests/unit/recovery-policy.test.ts src/main/agent/AGENTS.md docs/superpowers/specs/2026-09-28-agent-recovery-ladder-design.md
git commit -m "feat(agent): add recovery ladder policy"
```

---

### Task 2: Ephemeral recovery note text

**Files:**
- Modify: `src/main/agent/harness-note.ts`
- Test: `tests/unit/harness-note.test.ts`

**Interfaces:**
- Produces: `export function recoveryNote(): string`

- [ ] **Step 1: Write the failing test**

In `tests/unit/harness-note.test.ts`, change the import to include `recoveryNote` and add inside `describe('harness notes', …)`:

```ts
  it('tells a discarded looping response to act now', () => {
    const note = recoveryNote()
    expect(note.startsWith('<system-reminder>\n[meow] ')).toBe(true)
    expect(note).toContain('started repeating itself and was discarded')
    expect(note).toContain('without restarting your reasoning')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/harness-note.test.ts`
Expected: FAIL — `recoveryNote` is not exported.

- [ ] **Step 3: Implement**

Append to `src/main/agent/harness-note.ts`:

```ts
/** Rides only on the re-run request after a looping response is discarded; never persisted. */
export function recoveryNote(): string {
  return harnessNote(
    'Your previous response started repeating itself and was discarded. You already have the ' +
    'information you need: call the next tool or give your answer now, without restarting your reasoning.'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/harness-note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/harness-note.ts tests/unit/harness-note.test.ts
git commit -m "feat(agent): add ephemeral recovery note"
```

---

### Task 3: Ladder for repetition without tool calls

Replaces the one-shot anti-repetition retry. Levels 1–3 re-run the step; level 4 ends `stuck` for now (the pause arrives in Task 5).

**Files:**
- Modify: `src/shared/types.ts:254`
- Modify: `src/main/agent/loop.ts` (imports; fields ~172-176; `run()` ~205-406; `buildMessages` ~868)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `recoveryPolicy`, `RecoveryHit`, `RecoveryLevel`, `RECOVERY_AUTO_LEVELS` (Task 1); `recoveryNote` (Task 2).
- Produces (used by Tasks 4–5, all inside `SessionRunner`):
  - `private recovery: RecoveryPolicy`
  - `private recoveryHitsThisRun: number`
  - `private logRecovery(hit: RecoveryHit, channel: 'text' | 'reasoning' | undefined, level: RecoveryLevel, step: number, tail: string): void`
  - local in `run()`: `let pending: StepAdjust | undefined` where `interface StepAdjust { rerun: boolean; note: boolean; antiRepetition: boolean }`
  - `ChatEvent` `step-discarded` gains `recovery?: { level: 1 | 2 | 3; of: 3 }`

- [ ] **Step 1: Update the failing tests**

In `tests/unit/agent-loop.test.ts`, add after `const doneEvent = …` (near line 1987):

```ts
const hasRecoveryNote = (opts: LlmStreamOptions) =>
  JSON.stringify(opts.messages[opts.messages.length - 1]).includes('started repeating itself and was discarded')

function loopingReasoning(): LlmStreamPart[] {
  return [
    { kind: 'reasoning', text: 'I will write the mockup file now.\n\n' },
    ...Array.from({ length: 30 }, (): LlmStreamPart => ({ kind: 'reasoning', text: 'Let me write.\n\nWriting.\n\nOK.\n\n' })),
    { kind: 'finish' as const }
  ]
}
```

Replace the test `'discards a repeating stream and retries the step once with anti-repetition sampling'` with:

```ts
  it('discards a repeating stream and re-runs the step with an ephemeral recovery note', async () => {
    const h = makeHarness()
    h.llm.queue = [repeatingStream('reasoning'), textParts('final answer')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))

    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(2)
    expect(h.llm.calls[1].antiRepetition).toBeUndefined()
    expect(hasRecoveryNote(h.llm.calls[0])).toBe(false)
    expect(hasRecoveryNote(h.llm.calls[1])).toBe(true)
    expect(h.events.some(e => e.type === 'step-discarded' && e.recovery?.level === 1)).toBe(true)
    expect(userTexts(h.items)).toEqual([])
    expect(JSON.stringify(h.items)).not.toContain('counselorcounselor')
    expect(JSON.stringify(h.items)).not.toContain('started repeating itself')
  })

  it('recovers the reasoning loop seen in the field instead of stopping', async () => {
    const h = makeHarness()
    h.llm.queue = [loopingReasoning(), loopingReasoning(), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 60))

    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(3)
    expect(hasRecoveryNote(h.llm.calls[1])).toBe(true)
    expect(hasRecoveryNote(h.llm.calls[2])).toBe(true)
    expect(h.llm.calls[1].antiRepetition).toBeUndefined()
    expect(h.llm.calls[2].antiRepetition).toBe(true)
    expect(JSON.stringify(h.llm.calls[2].messages)).not.toContain('Writing.')
    expect(userTexts(h.items)).toEqual([])
  })

  it('force-compacts on the third hit in a row', async () => {
    const h = makeHarness()
    const spy = vi.spyOn(h.runner as unknown as { forceCompact: () => Promise<void> }, 'forceCompact')
    h.llm.queue = [repeatingStream('reasoning'), repeatingStream('reasoning'), repeatingStream('reasoning'), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 80))

    expect(doneEvent(h.events).reason).toBe('complete')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(h.llm.calls[3].antiRepetition).toBe(true)
    expect(h.events.flatMap(e => (e.type === 'step-discarded' ? [e.recovery?.level] : []))).toEqual([1, 2, 3])
  })

  it('does not stop on stumbles separated by clean steps', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 30 })
    const clean = (n: number): LlmStreamPart[] => [
      { kind: 'tool-call', toolCallId: `c-${n}`, toolName: 'read', toolInput: { file_path: `f${n}.ts` } },
      { kind: 'finish' }
    ]
    h.llm.queue = [
      repeatingStream('reasoning'), clean(1), clean(2), clean(3),
      repeatingStream('reasoning'), clean(4), clean(5), clean(6),
      repeatingStream('reasoning'), clean(7), clean(8), clean(9),
      repeatingStream('reasoning'), textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 150))

    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.every(c => c.antiRepetition === undefined)).toBe(true)
    expect(h.events.flatMap(e => (e.type === 'step-discarded' ? [e.recovery?.level] : []))).toEqual([1, 1, 1, 1])
  })
```

Replace the test `'ends as stuck/stream when the retry repeats too, keeping the clean prefix'` with:

```ts
  it('ends as stuck/stream past the last level when it cannot pause, keeping the clean prefix', async () => {
    const h = makeHarness()
    h.llm.queue = Array.from({ length: 4 }, () => repeatingStream('text', 'Here is the plan. '))
    h.runner.run()
    await new Promise(r => setTimeout(r, 80))

    const done = doneEvent(h.events)
    expect(done.reason).toBe('stuck')
    expect(done.stuckCategory).toBe('stream')
    expect(done.recoveryCount).toBe(4)
    expect(h.llm.calls.length).toBe(4)
    expect(h.ask).not.toHaveBeenCalled()
    const assistant = h.items.find(i => i.kind === 'message' && i.message.role === 'assistant')
    expect(assistant?.kind === 'message' && assistant.message.text.startsWith('Here is the plan. ')).toBe(true)
    expect(assistant?.kind === 'message' && assistant.message.text.length).toBeLessThan(60)
  })
```

In `describe('SessionRunner compact-on-reject', …)`, replace `'keeps the anti-repetition retry across a context-overflow recovery'` with:

```ts
  it('keeps the recovery re-run across a context-overflow recovery', async () => {
    const h = makeOverflowHarness({ tools: new Map([['read', stubTool('read')]]) })
    h.seed()
    h.llm.queue = [
      repeatingStream('reasoning'),
      [{ kind: 'error', error: OVERFLOW, retryable: false }],
      textParts('summary'),
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 40))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls).toHaveLength(4)
    expect(hasRecoveryNote(h.llm.calls[1])).toBe(true)
    expect(hasRecoveryNote(h.llm.calls[3])).toBe(true)
    expect(h.events.filter(e => e.type === 'step-start').map(e => e.type === 'step-start' && e.step)).toEqual([1, 1, 1])
  })
```

The helpers are module-level and test bodies run after the module is evaluated, so the compact-on-reject block (earlier in the file) can use `hasRecoveryNote` without moving anything.

In `describe('SessionRunner stop and steering around recovery', …)` → `'drops a pending repetition retry when a steer is promoted'`, add after the `antiRepetition` expectation:

```ts
    expect(hasRecoveryNote(h.llm.calls[1])).toBe(false)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "repetition|recovery|stumbles|force-compacts|reasoning loop"`
Expected: FAIL — no recovery note, `step-discarded` has no `recovery`, stuck after the second hit.

- [ ] **Step 3: Extend the event type**

`src/shared/types.ts:254`:

```ts
  | { type: 'step-discarded'; agentId: string; reason: 'repetition'; recovery?: { level: 1 | 2 | 3; of: 3 } }
```

- [ ] **Step 4: Implement in `loop.ts`**

Imports — change the harness-note import and add the policy import:

```ts
import { attachNote, cutNote, recoveryNote, toolLoopNote } from './harness-note'
import { RECOVERY_AUTO_LEVELS, recoveryPolicy } from './recovery-policy'
import type { RecoveryHit, RecoveryLevel, RecoveryPolicy } from './recovery-policy'
```

Delete the `MAX_LOOP_BREAKS` constant and its comment (lines ~121-123). Add below `MAX_STEPS_PROMPT`'s neighbors:

```ts
interface StepAdjust {
  /** Re-run the same step without consuming a step. */
  rerun: boolean
  note: boolean
  antiRepetition: boolean
}
```

Replace the fields `loopBreaksThisRun` / `consecutiveCutsThisRun` (and their comments) with:

```ts
  // Sliding-window recovery ladder for repetition and tool loops (see recovery-policy.ts).
  private recovery: RecoveryPolicy = recoveryPolicy()
  private recoveryHitsThisRun = 0
```

In `run()`:
- Replace `let retryStep = false` and its comment with `let pending: StepAdjust | undefined`.
- Replace `this.loopBreaksThisRun = 0` / `this.consecutiveCutsThisRun = 0` with `this.recovery = recoveryPolicy()` / `this.recoveryHitsThisRun = 0`.
- In the steer branch replace `retryStep = false` with `pending = undefined`.
- Replace

  ```ts
      const antiRepetition = retryStep
      retryStep = false
      if (!antiRepetition) steps++
  ```
  with
  ```ts
      const adjust = pending
      pending = undefined
      if (!adjust?.rerun) steps++
  ```
- `const llmMessages = this.buildMessages(isLastStep)` → `const llmMessages = this.buildMessages(isLastStep, adjust?.note === true)`.
- In `llm.stream({...})`: `...(antiRepetition ? { antiRepetition: true } : {})` → `...(adjust?.antiRepetition ? { antiRepetition: true } : {})`.
- In both reject-recovery sites replace
  ```ts
              if (antiRepetition) retryStep = true
              else steps--
  ```
  with
  ```ts
              if (adjust?.rerun) pending = adjust
              else steps--
  ```
  (the `catch` site has the same two lines at a different indent).
- Replace the whole `if (verdict.kind === 'repetition' && calls.length === 0) { … }` block with:

  ```ts
      if (verdict.kind === 'repetition' && calls.length === 0) {
        const level = this.recovery.onHit('repetition')
        this.recoveryHitsThisRun++
        this.logRecovery('repetition', verdict.channel, level, steps, verdict.channel === 'text' ? textBuffer : reasoningBuffer)
        // The looped output never reaches the transcript; the UI drops its bubble.
        this.deps.onEvent({
          type: 'step-discarded', agentId, reason: 'repetition',
          ...(level <= RECOVERY_AUTO_LEVELS ? { recovery: { level: level as 1 | 2 | 3, of: RECOVERY_AUTO_LEVELS as 3 } } : {})
        })
        if (level > RECOVERY_AUTO_LEVELS) {
          const text = verdict.channel === 'text' ? textBuffer.slice(0, verdict.keepChars) : textBuffer
          const reasoning = verdict.channel === 'reasoning' ? reasoningBuffer.slice(0, verdict.keepChars) : reasoningBuffer
          if (text || reasoning) {
            this.deps.appendMessage({ id: randomUUID(), role: 'assistant', text, reasoning: reasoning || undefined, tokens, createdAt: Date.now() })
          }
          this.deps.onEvent({
            type: 'done', agentId, reason: 'stuck', stuckCategory: 'stream',
            recoveryCount: this.recoveryHitsThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
          })
          return
        }
        if (level === 3) await this.forceCompact(signal)
        pending = { rerun: true, note: true, antiRepetition: level >= 2 }
        continue
      }
  ```

Leave the after-call cut and tool-loop code for Task 4, but make it compile: in the tool batch loop replace `this.loopBreaksThisRun++` with `this.recoveryHitsThisRun++`; replace `if (tripped && this.loopBreaksThisRun > MAX_LOOP_BREAKS) {` with `if (tripped && this.recoveryHitsThisRun > 2) {`; replace `this.consecutiveCutsThisRun = cut ? this.consecutiveCutsThisRun + 1 : 0` with nothing, and delete the `if (cut && this.consecutiveCutsThisRun > MAX_LOOP_BREAKS) { … }` block. (Task 4 replaces the remaining tool-loop check.)

Add the logger method next to `finishCall`:

```ts
  private logRecovery(hit: RecoveryHit, channel: 'text' | 'reasoning' | undefined, level: RecoveryLevel, step: number, tail: string): void {
    const clean = tail.replace(/\s+/g, ' ').slice(-160).replace(/"/g, "'")
    console.warn(`[meow] recovery agent=${this.deps.agentId} model=${this.deps.model} hit=${hit} channel=${channel ?? '-'} level=${level} step=${step} tail="${clean}"`)
  }
```

Replace `buildMessages`:

```ts
  private buildMessages(isLastStep = false, withRecoveryNote = false): ReturnType<typeof toLlmMessages> {
    const messages = toLlmMessages(this.deps.getItems(), this.toLlmOpts())
    if (withRecoveryNote) messages.push({ role: 'user', content: recoveryNote() })
    if (isLastStep) messages.push({ role: 'user', content: MAX_STEPS_PROMPT })
    return messages
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: the Step 1 tests PASS. The tool-loop tests `'ends as stuck/tool when the loop survives two notes'`, `'counts every tool-loop trip in one response'` and the cut test `'ends as stuck/stream after three consecutive cut steps'` may FAIL — Task 4 rewrites them. Every other test PASSES.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): recover looping responses with a sliding-window ladder"
```

---

### Task 4: Ladder for tool loops and repetition after calls; cuts never stop a turn

**Files:**
- Modify: `src/main/agent/loop.ts` (after-calls section of `run()`, ~408-465)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: `this.recovery`, `this.recoveryHitsThisRun`, `this.logRecovery`, `pending: StepAdjust | undefined` (Task 3).

- [ ] **Step 1: Update the failing tests**

In `describe('SessionRunner response cuts', …)` replace `'ends as stuck/stream after three consecutive cut steps'` with:

```ts
  it('never ends a turn on consecutive cuts', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 10 })
    h.llm.queue = [interleavedStep(1), interleavedStep(2), interleavedStep(3), interleavedStep(4), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 80))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(5)
    expect(h.llm.calls.every(c => c.antiRepetition === undefined)).toBe(true)
  })
```

In `describe('SessionRunner tool loops', …)` replace `'ends as stuck/tool when the loop survives two notes'` and `'counts every tool-loop trip in one response'` with:

```ts
  it('climbs the ladder on a persisting tool loop and ends stuck/tool when it cannot pause', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 30 })
    const spy = vi.spyOn(h.runner as unknown as { forceCompact: () => Promise<void> }, 'forceCompact')
    h.llm.queue = Array.from({ length: 20 }, (_, i) => sameRead(i))
    h.runner.run()
    await new Promise(r => setTimeout(r, 150))
    const done = doneEvent(h.events)
    expect(done.reason).toBe('stuck')
    expect(done.stuckCategory).toBe('tool')
    expect(done.stuckTool).toBe('read')
    expect(done.recoveryCount).toBe(4)
    // Trips on steps 3, 6, 9, 12: level 2 → anti-repetition on step 7, level 3 → compact before step 10.
    expect(h.llm.calls.length).toBe(12)
    expect(h.llm.calls[3].antiRepetition).toBeUndefined()
    expect(h.llm.calls[6].antiRepetition).toBe(true)
    expect(h.llm.calls[9].antiRepetition).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('advances the ladder once for several trips in one response', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 10 })
    h.llm.queue = [
      [
        ...Array.from({ length: 9 }, (_, i): LlmStreamPart => ({ kind: 'tool-call', toolCallId: `tc-${i}`, toolName: 'read', toolInput: { file_path: 'a.ts' } })),
        { kind: 'finish' }
      ],
      textParts('done')
    ]
    h.runner.run()
    await new Promise(r => setTimeout(r, 60))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(2)
    expect(h.llm.calls[1].antiRepetition).toBeUndefined()
  })

  it('applies anti-repetition to the step after a second repetition following calls', async () => {
    const h = makeHarness({ tools: new Map([['read', stubTool('read')]]), maxSteps: 10 })
    const repAfterCall = (n: number): LlmStreamPart[] => [
      { kind: 'tool-call', toolCallId: `r-${n}`, toolName: 'read', toolInput: { file_path: `r${n}.ts` } },
      ...Array.from({ length: 200 }, (): LlmStreamPart => ({ kind: 'reasoning', text: 'counselor' })),
      { kind: 'finish' }
    ]
    h.llm.queue = [repAfterCall(1), repAfterCall(2), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 80))
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls[1].antiRepetition).toBeUndefined()
    expect(h.llm.calls[2].antiRepetition).toBe(true)
    expect(toolItems(h.items).map(t => t.id)).toEqual(['r-1', 'r-2'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "tool loop|cuts|ladder|after a second repetition"`
Expected: FAIL — the tool loop still ends after the third trip and the after-call repetition sets no anti-repetition.

- [ ] **Step 3: Implement**

In `run()`, in the tool batch loop replace

```ts
          if (verdictForCall) {
            tripped = verdictForCall
            this.recoveryHitsThisRun++
          }
```
with
```ts
          if (verdictForCall) tripped = verdictForCall
```

Replace the block from `if (tripped && this.recoveryHitsThisRun > 2) {` through its closing `}` with:

```ts
      // Several trips in one response are one stumble: the ladder moves once per step.
      const hit: RecoveryHit | undefined = tripped ? 'tool-loop' : verdict.kind === 'repetition' ? 'repetition' : undefined
      if (hit) {
        const level = this.recovery.onHit(hit)
        this.recoveryHitsThisRun++
        this.logRecovery(
          hit,
          verdict.kind === 'repetition' ? verdict.channel : undefined,
          level,
          steps,
          tripped ? tripped.tool : verdict.kind === 'repetition' && verdict.channel === 'reasoning' ? reasoningBuffer : textBuffer
        )
        if (level > RECOVERY_AUTO_LEVELS) {
          this.deps.onEvent({
            type: 'done', agentId, reason: 'stuck',
            stuckCategory: hit === 'tool-loop' ? 'tool' : 'stream',
            ...(tripped ? { stuckTool: tripped.tool } : {}),
            recoveryCount: this.recoveryHitsThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
          })
          return
        }
        if (level === 3) await this.forceCompact(signal)
        if (level >= 2) pending = { rerun: false, note: false, antiRepetition: true }
      } else if (!cut) {
        this.recovery.onCleanStep()
      }
```

Also call `this.recovery.onCleanStep()` is **not** needed elsewhere: the no-call repetition branch `continue`s before this point, and every other step reaches it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(agent): route tool loops and post-call repetition through the recovery ladder"
```

---

### Task 5: Pause and ask at level 4; runtime docs

**Files:**
- Modify: `src/main/agent/loop.ts` (`LoopDeps`, both level-4 branches, new `pauseForRecovery`)
- Modify: `src/main/meow-agent-manager.ts:1620` (`new SessionRunner({...})`)
- Modify: `docs/reference/03-agent-runtime.md` (loop pseudo-code ~146-167, notable details ~186-197, constants table)
- Modify: `src/main/agent/AGENTS.md` (`loop.ts`, `harness-note.ts` rows if they mention `MAX_LOOP_BREAKS` / notes)
- Test: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: Task 3/4 level-4 branches.
- Produces: `LoopDeps.pauseOnStuck?: boolean`; `private async pauseForRecovery(signal?: AbortSignal): Promise<'continue' | 'custom' | 'stop'>`; constant `RECOVERY_PAUSE_QUESTION`.

- [ ] **Step 1: Write the failing tests**

Add a new block at the end of `tests/unit/agent-loop.test.ts`:

```ts
describe('SessionRunner recovery pause', () => {
  const fourLoops = () => Array.from({ length: 4 }, () => repeatingStream('reasoning'))

  it('asks the user after the automatic levels and continues on Continue', async () => {
    const ask = vi.fn(async () => ({ allow: true, text: 'Continue' }))
    const h = makeHarness({ ask, pauseOnStuck: true })
    h.llm.queue = [...fourLoops(), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 100))

    expect(ask).toHaveBeenCalledTimes(1)
    const prompt = h.events.find(e => e.type === 'prompt-request')
    expect(prompt?.type === 'prompt-request' && prompt.kind).toBe('question')
    expect(prompt?.type === 'prompt-request' && prompt.options?.map(o => o.label)).toEqual(['Continue', 'Stop'])
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls.length).toBe(5)
    expect(hasRecoveryNote(h.llm.calls[4])).toBe(true)
    expect(h.llm.calls[4].antiRepetition).toBeUndefined()
  })

  it('turns a custom answer into a real user message', async () => {
    const ask = vi.fn(async () => ({ allow: true, text: 'only write file A' }))
    const h = makeHarness({ ask, pauseOnStuck: true })
    h.llm.queue = [...fourLoops(), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 100))

    expect(userTexts(h.items)).toEqual(['only write file A'])
    expect(h.events.some(e => e.type === 'user-message')).toBe(true)
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(hasRecoveryNote(h.llm.calls[4])).toBe(false)
  })

  it('ends stuck when the user chooses Stop or dismisses the prompt', async () => {
    for (const resp of [{ allow: true, text: 'Stop' }, null]) {
      const h = makeHarness({ ask: vi.fn(async () => resp), pauseOnStuck: true })
      h.llm.queue = fourLoops()
      h.runner.run()
      await new Promise(r => setTimeout(r, 100))
      const done = doneEvent(h.events)
      expect(done.reason).toBe('stuck')
      expect(done.stuckCategory).toBe('stream')
      expect(h.llm.calls.length).toBe(4)
    }
  })

  it('ends stopped when the run is aborted while waiting', async () => {
    const controller = new AbortController()
    const ask = vi.fn(async () => { controller.abort(); return null })
    const h = makeHarness({ ask, pauseOnStuck: true })
    h.llm.queue = fourLoops()
    h.runner.run(controller.signal)
    await new Promise(r => setTimeout(r, 100))
    expect(doneEvent(h.events).reason).toBe('stopped')
  })

  it('pauses a persisting tool loop too, and Continue restarts the ladder', async () => {
    const ask = vi.fn(async () => ({ allow: true, text: 'Continue' }))
    const h = makeHarness({ ask, pauseOnStuck: true, tools: new Map([['read', stubTool('read')]]), maxSteps: 40 })
    const sameRead = (i: number): LlmStreamPart[] => [
      { kind: 'tool-call', toolCallId: `tc-${i}`, toolName: 'read', toolInput: { file_path: 'a.ts' } },
      { kind: 'finish' }
    ]
    h.llm.queue = [...Array.from({ length: 12 }, (_, i) => sameRead(i)), textParts('done')]
    h.runner.run()
    await new Promise(r => setTimeout(r, 200))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(doneEvent(h.events).reason).toBe('complete')
    expect(h.llm.calls[12].antiRepetition).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-loop.test.ts -t "recovery pause"`
Expected: FAIL — `pauseOnStuck` is not a `LoopDeps` key (type error surfaces at typecheck; at runtime `ask` is never called and the turn ends `stuck`).

- [ ] **Step 3: Implement the pause**

`LoopDeps` — add after `ask`:

```ts
  /**
   * Top-level sessions pause and ask the user once automatic recovery is
   * exhausted; subagents (unset) end the turn as 'stuck' for their parent.
   */
  pauseOnStuck?: boolean
```

Add near the other constants:

```ts
const RECOVERY_PAUSE_QUESTION = 'The model keeps repeating itself and could not recover on its own. Continue this turn?'
const RECOVERY_CONTINUE = 'Continue'
const RECOVERY_STOP = 'Stop'
```

Add the method next to `logRecovery`:

```ts
  private async pauseForRecovery(signal?: AbortSignal): Promise<'continue' | 'custom' | 'stop'> {
    if (!this.deps.pauseOnStuck || signal?.aborted) return 'stop'
    const { agentId } = this.deps
    const promptId = randomUUID()
    const options = [{ label: RECOVERY_CONTINUE }, { label: RECOVERY_STOP }]
    this.deps.onEvent({ type: 'prompt-request', agentId, promptId, kind: 'question', question: RECOVERY_PAUSE_QUESTION, options, custom: true })
    const resp = await this.deps.ask(promptId, undefined, { promptId, kind: 'question', question: RECOVERY_PAUSE_QUESTION, options, custom: true })
    const answer = resp?.text?.trim() ?? ''
    if (signal?.aborted || !answer || answer === RECOVERY_STOP) {
      console.warn(`[meow] recovery agent=${agentId} pause=stop`)
      return 'stop'
    }
    this.recovery.reset()
    if (answer === RECOVERY_CONTINUE) {
      console.warn(`[meow] recovery agent=${agentId} pause=continue`)
      return 'continue'
    }
    console.warn(`[meow] recovery agent=${agentId} pause=custom`)
    const msg: ChatMessage = { id: randomUUID(), role: 'user', text: answer, displayText: answer, createdAt: Date.now() }
    this.deps.appendMessage(msg)
    this.deps.onEvent({ type: 'user-message', agentId, message: msg })
    return 'custom'
  }
```

In the **no-call repetition** branch (Task 3), replace `if (level > RECOVERY_AUTO_LEVELS) { … return }` with:

```ts
        if (level > RECOVERY_AUTO_LEVELS) {
          const outcome = await this.pauseForRecovery(signal)
          if (outcome === 'stop') {
            const text = verdict.channel === 'text' ? textBuffer.slice(0, verdict.keepChars) : textBuffer
            const reasoning = verdict.channel === 'reasoning' ? reasoningBuffer.slice(0, verdict.keepChars) : reasoningBuffer
            if (text || reasoning) {
              this.deps.appendMessage({ id: randomUUID(), role: 'assistant', text, reasoning: reasoning || undefined, tokens, createdAt: Date.now() })
            }
            this.deps.onEvent(signal?.aborted
              ? { type: 'done', agentId, reason: 'stopped' }
              : {
                  type: 'done', agentId, reason: 'stuck', stuckCategory: 'stream',
                  recoveryCount: this.recoveryHitsThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
                })
            return
          }
          if (outcome === 'custom') {
            steps = 0
            continue
          }
          pending = { rerun: true, note: true, antiRepetition: false }
          continue
        }
```

In the **after-calls** hit block (Task 4), replace `if (level > RECOVERY_AUTO_LEVELS) { … return }` with:

```ts
        if (level > RECOVERY_AUTO_LEVELS) {
          const outcome = await this.pauseForRecovery(signal)
          if (outcome === 'stop') {
            this.deps.onEvent(signal?.aborted
              ? { type: 'done', agentId, reason: 'stopped' }
              : {
                  type: 'done', agentId, reason: 'stuck',
                  stuckCategory: hit === 'tool-loop' ? 'tool' : 'stream',
                  ...(tripped ? { stuckTool: tripped.tool } : {}),
                  recoveryCount: this.recoveryHitsThisRun, tokens, cost: this.deps.computeCost?.(runUsage)
                })
            return
          }
          if (outcome === 'custom') steps = 0
        } else {
```

and turn the existing two lines after it (`if (level === 3) …`, `if (level >= 2) …`) into the body of that `else { … }`.

In `src/main/meow-agent-manager.ts`, in the `new SessionRunner({ … })` object near line 1659, add after the `ask:` line:

```ts
      pauseOnStuck: true,
```

(`src/main/agent/tools/task.ts:146` is left unchanged, so subagents keep ending `stuck`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/agent-loop.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Update runtime docs**

`docs/reference/03-agent-runtime.md`, in the loop pseudo-code, replace

```
  steps++ (not on a repetition retry)
```
with
```
  steps++ (not on a recovery re-run)
```
replace
```
  llmMessages = toLlmMessages(items, opts)  (+ MAX_STEPS_PROMPT when isLastStep)
```
with
```
  llmMessages = toLlmMessages(items, opts)  (+ ephemeral recovery note on a re-run, + MAX_STEPS_PROMPT when isLastStep)
```
replace
```
  stream = llm.stream({ ..., antiRepetition only on a repetition retry })
```
with
```
  stream = llm.stream({ ..., antiRepetition at recovery level ≥ 2 })
```
replace the two lines under `repetition with no calls:` with
```
    level = recovery.onHit('repetition'); emit step-discarded{recovery:{level, of:3}} (transcript untouched)
    level 1 → re-run the step with the ephemeral recovery note
    level 2 → + antiRepetition;  level 3 → forceCompact, then as level 2
    level 4 → pause (top-level sessions: question prompt Continue / Stop / custom text;
              subagents or Stop: persist the clean prefix, done{stuck, stuckCategory:'stream'})
```
and replace the two lines
```
  tool-loop trips past MAX_LOOP_BREAKS per run → done{stuck, stuckCategory:'tool'}
  cuts past MAX_LOOP_BREAKS in a row (a clean step resets the count) → done{stuck, stuckCategory:'stream'}
```
with
```
  a tool-loop trip or repetition after calls → one recovery hit for the step:
    level 2 → next step antiRepetition; level 3 → forceCompact + antiRepetition; level 4 → pause as above
    (Stop → done{stuck, stuckCategory:'tool'|'stream'})
  a step with no hit and no cut → recovery.onCleanStep() (3 in a row reset the ladder)
  tool-flood / interleaved cuts are never hits and never end the turn
```

In "Notable details", replace the sentences from "Repetition retries and tool-loop trips share `MAX_LOOP_BREAKS` (2) per run" to the end of that bullet with:

```
Repetition and tool-loop hits climb the recovery ladder (`recovery-policy.ts`): level 1 re-runs a
discarded step with an ephemeral `[meow]` recovery note (request only, never persisted), level 2
adds anti-repetition sampling, level 3 force-compacts, level 4 pauses top-level sessions with a
Continue / Stop question (custom text becomes a real user message); subagents end `stuck`. Three
clean steps in a row reset the ladder, so stumbles far apart never stop a long turn. Cuts
(`tool-flood`, `interleaved`) are never hits. Each hit logs one `[meow] recovery …` line.
```

In the constants table, replace the `MAX_LOOP_BREAKS` row (if present) with rows `RECOVERY_RESET_STEPS | 3` and `RECOVERY_AUTO_LEVELS | 3`, matching the table's column format.

In `src/main/agent/AGENTS.md`, edit only the `loop.ts` / `harness-note.ts` rows where they mention `MAX_LOOP_BREAKS`, the one-shot retry or "stuck after N": describe the ladder, `pauseOnStuck`, and `recoveryNote()` in the same sentence style.

- [ ] **Step 6: Typecheck and full tests**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/loop.ts src/main/meow-agent-manager.ts tests/unit/agent-loop.test.ts docs/reference/03-agent-runtime.md src/main/agent/AGENTS.md
git commit -m "feat(agent): pause and ask the user when automatic recovery is exhausted"
```

---

### Task 6: Renderer notice and stuck text; IPC and UI docs

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx:702-709` and `:747-756`
- Modify: `docs/reference/05-ipc-contract.md:219,233`
- Modify: `docs/reference/09-ui-guide.md` (chat panel section that lists notices / errors)

**Interfaces:**
- Consumes: `step-discarded.recovery` (Task 3).

- [ ] **Step 1: Update the notice**

In the `step-discarded` handler replace

```ts
        { kind: 'notice', id, text: 'Model output started repeating — retrying…' }
```
with
```ts
        {
          kind: 'notice',
          id,
          text: e.recovery
            ? `[meow] Model started repeating itself — recovering (${e.recovery.level}/${e.recovery.of})`
            : 'Model output started repeating — retrying…'
        }
```

- [ ] **Step 2: Update the stuck text**

Replace the `else if (e.reason === 'stuck') { … }` body with:

```ts
        const text = e.stuckCategory === 'stream'
          ? 'Stopped: the model kept repeating itself after automatic recovery.'
          : e.stuckCategory === 'tool'
            ? `Stopped: the model kept repeating the ${e.stuckTool ?? 'same'} tool after automatic recovery.`
            : 'The model could not make progress and the turn was stopped. Try rewording your request or sending a new message.'
        setItems(prev => [...prev, { kind: 'error', id: 'stuck-' + Date.now(), text }])
```

- [ ] **Step 3: Update IPC and UI docs**

`docs/reference/05-ipc-contract.md`:
- `step-discarded` row → payload `reason: 'repetition'`, `recovery?: { level: 1 \| 2 \| 3; of: 3 }`; description: "The step's streamed output was dropped by the repetition guard and the step is re-run at that recovery level (display-only)".
- `done` row → in the `stuck` explanation, say `stuck` is reported only after the recovery ladder is exhausted and the user chose Stop (or for subagents, which do not pause).

`docs/reference/09-ui-guide.md`: in the chat panel section, add one bullet in the existing style: the `[meow] Model started repeating itself — recovering (n/3)` notice, and that a turn out of automatic recovery shows the question popup (Continue / Stop / custom text) before the `Stopped: …` error.

- [ ] **Step 4: Typecheck and tests**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx docs/reference/05-ipc-contract.md docs/reference/09-ui-guide.md
git commit -m "ui(chat): show recovery level and clearer stuck text"
```

---

## Verification (after Task 6)

- [ ] `npm run typecheck` — PASS.
- [ ] `npm test` — PASS.
- [ ] `grep -rn "MAX_LOOP_BREAKS\|loopBreaksThisRun\|consecutiveCutsThisRun" src docs/reference` — no matches.
- [ ] Manual (optional): `npm run dev`, run a long turn on `ollama-cloud/deepseek-v4.1-flash`; on a loop, the chat shows `recovering (n/3)` and `userData/logs/<date>-log.txt` has `[meow] recovery …` lines.
