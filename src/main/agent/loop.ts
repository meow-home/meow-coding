import { randomUUID } from 'node:crypto'
import type { ArtifactEntry, ChatEvent, ChatMessage, MessageTokens, PendingPromptInfo, PromptResponse, QuestionPrompt, QueuedMessage, TodoItem, ToolCallData } from '../../shared/types'
import { appendStreamDelta } from '../../shared/text'
import type { LlmClient, LlmStreamPart } from './llm'
import type { AgentRunContext } from './run-context'
import { formatLlmError } from './llm'
import { toLlmMessages } from './message'
import type { ToLlmOptions, TranscriptItem } from './message'
import type { ToolContext, ToolDefinition } from './tools/types'
import type { PermissionDecision } from './permission'
import { planCompaction, serializeItems, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, hardTruncate, usableContextTokens, fitHeadToBudget, resolveCompactionSettings } from './compact'
import { instructionFilesForFile } from './instructions'
import { gitFreshnessReminder } from './env'
import { isMemoryPath } from './memory'
import { resolveCwd } from './tools/bash'
import type { CompactionSettings, ResolvedCompaction } from './compact'
import { estimateUsage } from './token'
import { DEFAULT_MAX_CONTEXT_TOKENS } from './config'
import { classifyContextOverflowError } from './limits'
import { toolLoopDetector } from './repetition'
import type { ToolLoopDetector, ToolLoopVerdict } from './repetition'
import { createResponseGuard, MAX_TOOL_CALLS_PER_RESPONSE } from './response-guard'
import type { GuardVerdict } from './response-guard'
import { runWithConcurrency, scheduleBatches } from './tool-scheduler'
import { attachNote, cutNote, recoveryNote, toolLoopNote } from './harness-note'
import type { CutReason } from './harness-note'
import { RECOVERY_AUTO_LEVELS, recoveryPolicy } from './recovery-policy'
import type { RecoveryHit, RecoveryLevel, RecoveryPolicy } from './recovery-policy'
import type { TruncationStore } from './truncation'
import type { SnapshotStore } from './snapshot'
import type { HooksRunner } from './hooks'
import type { BackgroundProcessStore } from './background-process-store'
import type { MonitorStore } from './monitor-store'
import type { PollMonitorStore } from './poll-monitor-store'

export interface LoopDeps {
  agentId: string
  taskId?: string
  turn?: number
  model: string
  /**
   * A function is re-resolved at the start of every run, so skills added or an
   * AGENTS.md edited mid-session take effect on the next turn instead of only
   * after a reload. Resolved once per run, not per step, because building it
   * reads instruction files off disk.
   */
  system: string | (() => string)
  systemInstructionPaths?: ReadonlySet<string>
  /**
   * Per-turn dynamic context (environment snapshot + memory index) rendered as
   * a `<system-reminder>` block. Resolved once per run and prepended to the LLM
   * messages on every step; never written to the session store. Return '' to
   * inject nothing.
   */
  turnContext?: () => Promise<string>
/** Fixed identity of the run that started this turn. Resolved once per run and
 *  snapshot per tool invocation so the `delegate_session` tool can correlate
 *  the source run (a delegated turn carries its own `AgentRunContext`). */
  runContext?: () => AgentRunContext | undefined
  /** Absolute path of the per-project memory dir; undefined = memory disabled. */
  memoryDir?: string
  cwd: string
  llm: LlmClient
  tools: Map<string, ToolDefinition>
  decidePermission: (toolName: string, input?: Record<string, unknown>) => PermissionDecision
  ask: (promptId: string, tool: string | undefined, info: PendingPromptInfo) => Promise<PromptResponse | null>
  /**
   * Top-level sessions pause and ask the user once automatic recovery is
   * exhausted; subagents (unset) end the turn as 'stuck' for their parent.
   */
  pauseOnStuck?: boolean
  maxSteps?: number
  maxContextTokens?: number
  /**
   * Tokens the model may generate. Reserved from the context budget as well as
   * sent to the provider: leaving it out let the prompt grow to the limit and
   * then be rejected once the model started writing its answer.
   */
  maxOutputTokens?: number
  /**
   * Sent to the provider as `max_tokens`. The manager always sets it to the
   * output reserve (a bound capped at half the context window), so a runaway
   * answer cannot fill the context; undefined omits `max_tokens` entirely.
   */
  maxOutputTokensWire?: number
  /** Provider reject context overflow — ghi trần context học được. */
  onContextOverflow?: (promptTokens: number, message?: string) => void
  compaction?: CompactionSettings
  toolOutput?: { maxBytes: number; maxLines: number }
  truncation?: TruncationStore
  replaceItems?: (items: TranscriptItem[]) => void
  snapshots?: SnapshotStore
  snapshotAgentId?: string
  onEvent: (e: ChatEvent) => void
  onArtifact?: (entry: Omit<ArtifactEntry, 'id' | 'ts'>) => void
  /** Long-lived background shell processes for bash run_in_background. */
  backgroundProcs?: BackgroundProcessStore
  /** Async watches over background shells for the monitor tool. */
  monitors?: MonitorStore
  pollMonitors?: PollMonitorStore
  getItems: () => TranscriptItem[]
  appendMessage: (msg: ChatMessage) => void
  appendTool: (tool: ToolCallData) => void
  // Returns and clears all pending steered messages (injected at the next step
  // boundary while a turn is running, opencode-style).
  takeSteers?: () => QueuedMessage[]
  setTodos?: (todos: TodoItem[]) => void
  variantOptions?: Record<string, unknown>
  onUsage?: (tokens: MessageTokens) => void
  computeCost?: (usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) => number
  diagnostics?: (filePath: string, text: string) => Promise<string>
  // Resolved once per run, like `system`, so edits to the hooks config take
  // effect on the next turn rather than needing a restart.
  hooks?: () => HooksRunner
}

const DEFAULT_MAX_STEPS = 0
const DEFAULT_KEEP_FULL_TURNS = 2
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
const MAX_STEPS_PROMPT = 'Final step: wrap up and provide your final answer now. Tool calls are disabled.'
const MAX_LENGTH_RESUMES = 3
const RECOVERY_PAUSE_QUESTION = 'The model keeps repeating itself and could not recover on its own. Continue this turn?'
const RECOVERY_CONTINUE = 'Continue'
const RECOVERY_STOP = 'Stop'
// A Stop hook that never lets go would loop the turn forever; past this many
// consecutive blocks the turn ends regardless.
export const MAX_STOP_BLOCKS = 8
const CONTINUE_TRUNCATED_PROMPT =
  '<system-reminder>\nYour previous answer was cut off at the output token limit. ' +
  'Continue from where you stopped, without repeating what you already wrote.\n</system-reminder>'

interface StepAdjust {
  /** Re-run the same step without consuming a step. */
  rerun: boolean
  note: boolean
  antiRepetition: boolean
}

function classifyFinish(reason: string | undefined): 'complete' | 'length' | 'refusal' {
  if (reason === 'length' || reason === 'max_tokens') return 'length'
  if (reason === 'refusal' || reason === 'content_filter' || reason === 'content-filter') return 'refusal'
  return 'complete'
}

interface DecidedCall {
  call: ToolCallData
  blocked: boolean
  decision: PermissionDecision
  preContext?: string
}

// Tool run() calls can throw; normalize to a string the model can read instead
// of String(err), which turns plain objects into "[object Object]".
export function formatToolError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    const json = JSON.stringify(err)
    if (json !== undefined) return json
  } catch {
    // circular reference — fall through
  }
  return String(err)
}

// Hook context rides alongside the tool output rather than replacing it, so the
// model still sees what the tool actually returned.
function appendHookContext(output: string | undefined, ...parts: (string | undefined)[]): string | undefined {
  const extra = parts.filter((p): p is string => Boolean(p)).join('\n')
  if (!extra) return output
  return output ? `${output}\n${extra}` : extra
}

export class SessionRunner {
  private readonly maxSteps: number
  private compactedThisRun = 0
  // Compaction knobs resolved once per run from the model's context window
  // (auto knobs filled by ratio; overrides pass through).
  private compaction!: ResolvedCompaction
  // Số lần đã tự sửa reject context-overflow trong một run — bounded by
  // MAX_OVERFLOW_RETRIES so a prompt truly over the limit emits an error instead of looping.
  private rejectRetriesThisRun = 0
  // Set when an automatic compaction shrank the context by less than
  // MIN_COMPACTION_GAIN; later automatic compactions in the run only truncate.
  private compactionStalled = false
  // A /compact that arrived mid-run, honored at the next step boundary.
  private manualCompact: { focus?: string } | undefined
  // Truncation resumes in one run (not reset between tool steps); caps the cost
  // keeps hitting the output limit.
  private lengthResumesThisRun = 0
  // Sliding-window recovery ladder for repetition and tool loops (see recovery-policy.ts).
  private recovery: RecoveryPolicy = recoveryPolicy()
  private recoveryHitsThisRun = 0
  // Provider-reported usage of the last LLM call; overflow detection trusts it
  // over the transcript char estimate because it includes the system prompt and
  // tool definitions (see maybeCompact).
  private lastTokens: MessageTokens | undefined
  // AGENTS.md paths already attached to a read output this session; cross-message
  // dedupe so instructions are not repeated across turns (opencode claims set).
  private attachedInstructions = new Set<string>()
  // Per-turn dynamic context, resolved once per run (see LoopDeps.turnContext).
  private turnContext = ''
  // Hooks for this run, resolved once so config edits land on the next turn.
  private hooks: HooksRunner | undefined
  // Consecutive Stop-hook blocks in this run; capped by MAX_STOP_BLOCKS.
  private stopBlocksThisRun = 0
  // Per run: a tool loop spans steps. The stream guard is per step (see run()).
  private toolLoop: ToolLoopDetector = toolLoopDetector()
  // Fixed run identity for this turn; snapshot per tool invocation.
  private runContext: AgentRunContext | undefined

  constructor(private deps: LoopDeps) {
    this.maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS
  }

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

  private async runSteps(signal?: AbortSignal): Promise<void> {
    const { agentId } = this.deps
    const system = typeof this.deps.system === 'function' ? this.deps.system() : this.deps.system
    let steps = 0
    let pending: StepAdjust | undefined
    this.compactedThisRun = 0
    this.compactionStalled = false
    this.rejectRetriesThisRun = 0
    this.lengthResumesThisRun = 0
    this.recovery = recoveryPolicy()
    this.recoveryHitsThisRun = 0
    this.stopBlocksThisRun = 0
    this.toolLoop = toolLoopDetector()
    this.hooks = this.deps.hooks?.()
    this.compaction = resolveCompactionSettings(
      this.deps.compaction ?? { auto: false, tailTurns: 2 },
      this.deps.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      this.deps.maxOutputTokens ?? 0
    )
    const runUsage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }
    this.turnContext = signal?.aborted ? '' : await this.snapshotTurnContext()
    this.runContext = this.deps.runContext?.()
    while (true) {
      if (signal?.aborted) {
        this.deps.onEvent({ type: 'done', agentId, reason: 'stopped' })
        return
      }
      const steers = this.deps.takeSteers?.() ?? []
      if (steers.length > 0) {
        for (const s of steers) {
          const msg: ChatMessage = {
            id: s.id,
            role: 'user',
            text: s.text,
            displayText: s.displayText ?? s.text,
            images: s.images,
            createdAt: Date.now()
          }
          this.deps.appendMessage(msg)
          this.deps.onEvent({ type: 'user-message', agentId, message: msg })
        }
        // Fresh step budget for the continued work, like opencode's
        // currentStep reset after promoting steers; a steer is new user
        // guidance, like a custom pause answer, so it also resets the ladder.
        steps = 0
        pending = undefined
        this.recovery.reset()
        continue
      }
      const adjust = pending
      pending = undefined
      if (!adjust?.rerun) steps++
      const isLastStep = this.maxSteps > 0 && steps >= this.maxSteps

      await this.compactIfOverThreshold(signal)

      const llmMessages = this.buildMessages(isLastStep, adjust?.note === true)
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
          ...(adjust?.antiRepetition ? { antiRepetition: true } : {})
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
              if (adjust) pending = adjust
              if (!adjust?.rerun) steps--
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
          if (adjust) pending = adjust
          if (!adjust?.rerun) steps--
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
        const level = this.recovery.onHit('repetition')
        this.recoveryHitsThisRun++
        this.logRecovery('repetition', verdict.channel, level, steps, verdict.channel === 'text' ? textBuffer : reasoningBuffer)
        // The looped output never reaches the transcript; the UI drops its bubble.
        this.deps.onEvent({
          type: 'step-discarded', agentId, reason: 'repetition',
          ...(level <= RECOVERY_AUTO_LEVELS ? { recovery: { level: level as 1 | 2 | 3, of: RECOVERY_AUTO_LEVELS as 3 } } : {})
        })
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
        if (level === 3) await this.forceCompact(signal)
        pending = { rerun: true, note: true, antiRepetition: level >= 2 }
        continue
      }

      // Any other verdict cuts the response but keeps the calls already
      // announced: each must get a result.
      const cut: CutReason | undefined = verdict.kind === 'ok' ? undefined : verdict.kind
      // Captured before the cut below slices the buffers, so a later recovery
      // log sees the actual repeating tail instead of the kept clean prefix.
      const recoveryTail = verdict.kind === 'repetition' && verdict.channel === 'reasoning' ? reasoningBuffer : textBuffer
      if (cut) {
        let keepText = guard.textBeforeFirstCall()
        if (verdict.kind === 'repetition') {
          if (verdict.channel === 'reasoning') reasoningBuffer = reasoningBuffer.slice(0, verdict.keepChars)
          else keepText = Math.min(keepText, verdict.keepChars)
        }
        textBuffer = textBuffer.slice(0, keepText)
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
          tripped ? tripped.tool : recoveryTail
        )
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
          if (level === 3) await this.forceCompact(signal)
          if (level >= 2) pending = { rerun: false, note: false, antiRepetition: true }
        }
      } else if (!cut) {
        this.recovery.onCleanStep()
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
        const reason = isLastStep ? 'max-steps' : classifyFinish(finishReason)
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
  }

  // Runs Stop hooks before a normal end-of-turn. A block keeps the loop going
  // with the hook's reason as the next instruction, the way a steer does; the
  // cap stops a hook that is never satisfied from looping forever.
  private async blockedByStopHook(lastAssistantMessage: string): Promise<boolean> {
    if (!this.hooks || this.stopBlocksThisRun >= MAX_STOP_BLOCKS) return false
    const result = await this.hooks.runStop(lastAssistantMessage, this.stopBlocksThisRun > 0)
    if (!result.block) return false
    this.stopBlocksThisRun++
    this.deps.appendMessage({
      id: randomUUID(),
      role: 'user',
      text: result.reason ?? 'Keep working: a Stop hook blocked the end of this turn.',
      createdAt: Date.now()
    })
    return true
  }

  private async snapshotTurnContext(): Promise<string> {
    try {
      return (await this.deps.turnContext?.()) ?? ''
    } catch {
      // A failed snapshot (slow git, unreadable index) must never block a turn.
      return ''
    }
  }

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

  private logRecovery(hit: RecoveryHit, channel: 'text' | 'reasoning' | undefined, level: RecoveryLevel, step: number, tail: string): void {
    const clean = tail.replace(/\s+/g, ' ').slice(-160).replace(/"/g, "'")
    console.warn(`[meow] recovery agent=${this.deps.agentId} model=${this.deps.model} hit=${hit} channel=${channel ?? '-'} level=${level} step=${step} tail="${clean}"`)
  }

  // Level 4: automatic recovery is exhausted. Top-level sessions pause and ask
  // the user (pauseOnStuck); subagents (unset) fall straight through to 'stop'
  // so the turn ends stuck for their parent, same as before this task.
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

  // Runs one decided call and fills in its result. Appending is left to
  // finishCall so results reach the transcript in model order.
  private async runCall(d: DecidedCall, signal?: AbortSignal): Promise<void> {
    if (d.blocked) return
    const { call, decision, preContext } = d
    // A Stop during an earlier batch must not let queued calls run or prompt.
    if (signal?.aborted) {
      call.permission = 'denied'
      call.error = 'aborted by user'
      return
    }
    const { agentId } = this.deps
    let allowed: boolean
    if (decision === 'allow') {
      allowed = true
    } else if (decision === 'deny') {
      allowed = false
    } else {
      const promptId = randomUUID()
      this.deps.onEvent({ type: 'prompt-request', agentId, promptId, kind: 'permission', call })
      const resp = await this.deps.ask(promptId, call.tool, { promptId, kind: 'permission', call })
      allowed = resp?.allow ?? false
    }

    if (!allowed) {
      call.permission = 'denied'
      call.error = decision === 'deny'
        ? `tool "${call.tool}" is not permitted in the current mode`
        : 'permission denied by user'
    } else {
      call.permission = 'allowed'
      const def = this.deps.tools.get(call.tool)
      if (!def) {
        call.error = `unknown tool: ${call.tool}`
      } else {
        const toolCtx: ToolContext = {
          cwd: this.deps.cwd,
          runContext: this.runContext,
          signal,
          agentId: this.deps.agentId,
          taskId: this.deps.taskId,
          turn: this.deps.turn,
          snapshots: this.deps.snapshots,
          snapshotAgentId: this.deps.snapshotAgentId,
          diagnostics: this.deps.diagnostics,
          setTodos: (todos) => this.deps.setTodos?.(todos),
          emitSubagent: (taskId, e) => this.deps.onEvent({
            type: 'subagent-event',
            agentId: this.deps.agentId,
            taskId,
            parentTaskId: e.parentTaskId,
            sub: e.sub,
            subagentType: e.subagentType,
            text: e.text,
            tool: e.tool,
            state: e.state
          }),
          ask: async (question: QuestionPrompt) => {
            const promptId = randomUUID()
            this.deps.onEvent({
              type: 'prompt-request',
              agentId,
              promptId,
              kind: 'question',
              question: question.question,
              options: question.options,
              multiple: question.multiple,
              custom: question.custom
            })
            const resp = await this.deps.ask(promptId, undefined, {
              promptId,
              kind: 'question',
              question: question.question,
              options: question.options,
              multiple: question.multiple,
              custom: question.custom
            })
            return resp?.text ?? null
          },
          onFileRead: (filePath) => {
            const skip = new Set([...this.attachedInstructions, ...(this.deps.systemInstructionPaths ?? [])])
            const files = instructionFilesForFile(filePath, skip)
            if (files.length === 0) return ''
            for (const f of files) this.attachedInstructions.add(f.path)
            return `<system-reminder>\n${files.map(f => `Instructions from: ${f.path}\n${f.content}`).join('\n\n')}\n</system-reminder>`
          },
          onArtifact: (entry) => this.deps.onArtifact?.(entry),
          backgroundProcs: this.deps.backgroundProcs,
          monitors: this.deps.monitors,
          pollMonitors: this.deps.pollMonitors
        }
        try {
          const r = await def.run(call.input, toolCtx)
          call.output = r.output
          call.error = r.error
          if (r.metadata) call.metadata = r.metadata
          if (!r.error) {
            // The tool has already run, so PostToolUse can only reshape what the
            // model reads: replace the output, or add context beside it.
            let output = call.output
            if (this.hooks) {
              const post = await this.hooks.runPostToolUse(call.tool, call.input, r)
              if (post.updatedToolOutput !== undefined) output = post.updatedToolOutput
              output = appendHookContext(output, post.additionalContext, post.warning)
            }
            call.output = await this.appendToolReminder(call, appendHookContext(output, preContext))
          }
        } catch (err) {
          call.error = formatToolError(err)
        }
      }
    }
  }

  // A tool can change the very state the model reasons about: a `git` call (or
  // a bash command touching git) changes the branch/dirty count, a write/edit
  // into the memory dir needs MEMORY.md kept in sync. Nudge the model inline so
  // its next claim is not based on stale context.
  private async toolResultReminder(call: ToolCallData): Promise<string> {
    if (call.tool === 'write' || call.tool === 'edit') {
      const memDir = this.deps.memoryDir
      if (memDir) {
        const input = call.input as { file_path?: unknown } | undefined
        const file = typeof input?.file_path === 'string' ? input.file_path : ''
        if (file && isMemoryPath(memDir, resolveCwd(this.deps.cwd, file))) {
          return '<system-reminder>\nMemory: you wrote a file under .meow/memory/. If you created a new fact, add a one-line entry to .meow/memory/MEMORY.md; if you edited an existing one, keep its frontmatter (name/description/metadata.type) valid.\n</system-reminder>'
        }
      }
      return ''
    }
    const command = (call.input as { command?: unknown } | undefined)?.command
    if (call.tool === 'git' || (call.tool === 'bash' && typeof command === 'string' && /\bgit\b/.test(command))) {
      return gitFreshnessReminder(this.deps.cwd)
    }
    return ''
  }

  // A failed reminder (slow git, weird path) must never turn a successful
  // tool call into an errored one — the model still gets the real output.
  private async appendToolReminder(call: ToolCallData, output: string | undefined): Promise<string | undefined> {
    try {
      const reminder = await this.toolResultReminder(call)
      return reminder ? (output ? `${output}\n${reminder}` : reminder) : output
    } catch {
      return output
    }
  }

  private visibleToolDefs(): ToolDefinition[] {
    return [...this.deps.tools.values()]
      .filter(t => this.deps.decidePermission(t.name) !== 'deny')
  }

  // Khi usable <= 0 (context nhỏ hơn buffer + reserve — thường là model có
  // context thật nhỏ học từ learned-limits), compaction phải vẫn chạy, không
  // được tắt: dùng trần cứng limit - reserve (luôn >= limit/2 vì reserve <=
  // floor(limit/2)), để self-heal (compact-on-reject / forceCompact) còn chỗ
  // thu gọn transcript.
  private compactionTarget(limit: number, buffer: number, reserve = 0): number {
    const usable = usableContextTokens(limit, buffer, reserve)
    return usable > 0 ? usable : Math.max(1, limit - reserve)
  }

  // Token-based overflow detection (modeled on opencode session/compaction.ts):
  // when the estimated request size approaches the model context limit, run an
  // LLM compaction that summarizes the older head and keeps the recent tail
  // verbatim.
  async compactIfOverThreshold(signal?: AbortSignal): Promise<void> {
    const manual = this.manualCompact
    if (manual) {
      this.manualCompact = undefined
      await this.compact(signal, manual)
      return
    }
    const compaction = this.compaction
    const { maxContextTokens, replaceItems } = this.deps
    if (!compaction?.auto || !maxContextTokens || maxContextTokens <= 0 || !replaceItems) return
    const usable = this.compactionTarget(maxContextTokens, compaction.buffer, this.deps.maxOutputTokens)
    let items = this.deps.getItems()
    const opts = this.toLlmOpts()
    // Trust the provider-reported usage when available (mirrors opencode's
    // overflow check): it covers the system prompt + tool definitions, which
    // the transcript char estimate never counts. But it lags behind tool
    // outputs appended after the last response — take the max with a fresh
    // estimate of the current transcript so a big tool result still trips the
    // threshold at the next step boundary instead of being counted late.
    const estimate = estimateUsage(toLlmMessages(items, opts))
    const providerTokens = this.lastTokens
      ? this.lastTokens.total ||
        this.lastTokens.input + this.lastTokens.output +
        (this.lastTokens.cacheRead ?? 0) + (this.lastTokens.cacheWrite ?? 0)
      : 0
    const usedTokens = Math.max(estimate, providerTokens)
    if (usedTokens < usable) return

    // Phần thân compaction thật, dùng chung cho cả ngưỡng lẫn force-compact.
    await this.compact(signal)
  }

  /**
   * Compact không kiểm tra threshold — provider vừa báo context đã vượt trần
   * thật. Vẫn giữ các fallback (head rỗng / summary fail → hardTruncate) để
   * retry luôn có transcript nhỏ hơn. No-op khi không thể làm gì.
   */
  private async forceCompact(signal?: AbortSignal): Promise<void> {
    const compaction = this.compaction
    const { replaceItems } = this.deps
    if (!compaction?.auto || !replaceItems) return
    await this.compact(signal)
  }

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

  /**
   * Một reject của provider có thể tự sửa thay vì giết cả turn:
   * context overflow → force-compact transcript rồi retry step. Chặn bởi
   * MAX_OVERFLOW_RETRIES để prompt thật sự quá trần emit lỗi. Caller quản lý
   * `steps--` trước `continue` để retry không tốn step.
   */
  private async tryRecoverFromReject(
    llmMessages: ReturnType<typeof toLlmMessages>,
    message: string | undefined,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (signal?.aborted) return false
    if (this.rejectRetriesThisRun >= MAX_OVERFLOW_RETRIES) return false
    if (!classifyContextOverflowError(message)) return false
    this.rejectRetriesThisRun++
    // Trần context thật ≤ cỡ prompt bị reject (hoặc con số provider đích danh).
    this.deps.onContextOverflow?.(estimateUsage(llmMessages), message)
    await this.forceCompact(signal)
    return true
  }

  // Prompt-building options shared by buildMessages and the overflow estimate,
  // so what we measure is exactly what we send. Tool results in the recent tail
  // reach the model at full size; only older ones are capped, which is what
  // lets a `read` or a test run actually be useful to the model.
  private toLlmOpts(): ToLlmOptions {
    return {
      toolOutputMaxChars: this.compaction?.toolOutputMaxChars,
      keepFullTurns: this.compaction?.tailTurns ?? DEFAULT_KEEP_FULL_TURNS,
      ...(this.turnContext ? { turnContext: this.turnContext } : {}),
      ...this.truncationOpts()
    }
  }

  private truncationOpts(): { truncate?: (toolId: string, text: string) => string } {
    const store = this.deps.truncation
    const cfg = this.deps.toolOutput
    if (!store || !cfg) return {}
    const { maxBytes, maxLines } = cfg
    return { truncate: (toolId, text) => store.truncate(this.deps.agentId, toolId, text, { maxBytes, maxLines }) }
  }

  private findPreviousSummary(items: TranscriptItem[]): string | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind !== 'message' || item.message.role !== 'user') continue
      if (item.message.text !== COMPACTION_MARKER) continue
      const next = items[i + 1]
      if (next?.kind === 'message' && next.message.role === 'assistant') return next.message.text
    }
    return undefined
  }

  private buildMessages(isLastStep = false, withRecoveryNote = false): ReturnType<typeof toLlmMessages> {
    const messages = toLlmMessages(this.deps.getItems(), this.toLlmOpts())
    if (withRecoveryNote) messages.push({ role: 'user', content: recoveryNote() })
    if (isLastStep) messages.push({ role: 'user', content: MAX_STEPS_PROMPT })
    return messages
  }
}
