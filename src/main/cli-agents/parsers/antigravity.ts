import type { CliTaskStatus, CliTranscriptItem, TokenUsage } from '../../../shared/types'
import type { CliParseResult, CliTerminalResult } from './types'

export type { CliParseResult, CliTerminalResult }

export interface AntigravityParserState {
  conversationId?: string
  lastUsage?: TokenUsage
  pendingTools: Map<string, { tool: string; input?: Record<string, unknown> }>
  completedSteps: Set<string>
}

export function createAntigravityState(initial?: Partial<AntigravityParserState>): AntigravityParserState {
  return {
    conversationId: initial?.conversationId,
    lastUsage: initial?.lastUsage,
    pendingTools: initial?.pendingTools ?? new Map(),
    completedSteps: initial?.completedSteps ?? new Set()
  }
}

export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const input = Number(obj.input_tokens ?? obj.inputTokens ?? obj.input ?? obj.prompt_tokens)
  const output = Number(obj.output_tokens ?? obj.outputTokens ?? obj.output ?? obj.completion_tokens)
  const total = Number(obj.total_tokens ?? obj.totalTokens ?? obj.total)

  const hasInput = !isNaN(input)
  const hasOutput = !isNaN(output)
  const hasTotal = !isNaN(total)

  if (!hasInput && !hasOutput && !hasTotal) return undefined

  const inVal = hasInput ? input : 0
  const outVal = hasOutput ? output : 0
  const totVal = hasTotal ? total : inVal + outVal

  return { input: inVal, output: outVal, total: totVal }
}

export function formatDeniedAction(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw || typeof raw !== 'object') return String(raw)
  const obj = raw as Record<string, unknown>
  const action = String(obj.action ?? obj.type ?? 'action')
  const params = obj.parameters as Record<string, unknown> | undefined
  const target =
    obj.target ??
    obj.command ??
    params?.CommandLine ??
    params?.command ??
    params?.path
  return target ? `${action}(${target})` : `${action}(*)`
}

export function parseAntigravityLine(
  line: string,
  state: AntigravityParserState,
  now = Date.now()
): CliParseResult {
  const trimmed = line.trim()
  if (!trimmed) {
    return { items: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { items: [] }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { items: [] }
  }

  const obj = parsed as Record<string, unknown>
  const event = obj.event

  if (event === 'init') {
    const rawInit = obj.init as Record<string, unknown> | undefined
    const conversationId = String(obj.conversation_id ?? rawInit?.conversation_id ?? '')
    if (conversationId) {
      state.conversationId = conversationId
    }

    return {
      items: [],
      conversationId: state.conversationId
    }
  }

  if (event === 'step_update') {
    const step = (obj.step_update ?? {}) as Record<string, unknown>
    const items: CliTranscriptItem[] = []

    if (step.conversation_id && !state.conversationId) {
      state.conversationId = String(step.conversation_id)
    }

    const usage = parseTokenUsage(step.usage)
    if (usage) {
      state.lastUsage = usage
    }

    const stepType = step.step_type
    const stepIndex = step.step_index !== undefined ? String(step.step_index) : undefined

    if (stepType === 'agent_response') {
      const textDelta = typeof step.text_delta === 'string' ? step.text_delta : undefined
      if (textDelta && textDelta.length > 0) {
        items.push({
          kind: 'assistant',
          text: textDelta,
          at: now
        })
      }
    } else if (stepType === 'tool') {
      const toolInfo = step.tool_info as Record<string, unknown> | undefined
      const toolName = String(step.tool_name ?? toolInfo?.name ?? 'unknown_tool')
      const input = (toolInfo?.parameters ?? toolInfo?.input ?? step.parameters ?? step.input) as Record<string, unknown> | undefined
      const stepState = step.state

      if (stepState === 'ACTIVE') {
        if (stepIndex) {
          state.pendingTools.set(stepIndex, { tool: toolName, input })
        }
        // Emit DONE item only to prevent duplicate cards in an append-only transcript.
      } else if (stepState === 'DONE') {
        if (stepIndex && state.completedSteps.has(stepIndex)) {
          return { items: [], usage, conversationId: state.conversationId }
        }
        if (stepIndex) {
          state.completedSteps.add(stepIndex)
        }

        const pending = stepIndex ? state.pendingTools.get(stepIndex) : undefined
        if (stepIndex) {
          state.pendingTools.delete(stepIndex)
        }

        const finalTool = toolName !== 'unknown_tool' ? toolName : (pending?.tool ?? 'unknown_tool')
        const finalInput = input ?? pending?.input

        let output: string | undefined
        if (toolInfo?.output !== undefined) {
          output = typeof toolInfo.output === 'string' ? toolInfo.output : JSON.stringify(toolInfo.output)
        }

        let error: string | undefined
        if (toolInfo?.error !== undefined) {
          if (typeof toolInfo.error === 'string') {
            error = toolInfo.error
          } else if (typeof (toolInfo.error as Record<string, unknown>).message === 'string') {
            error = (toolInfo.error as Record<string, unknown>).message as string
          } else {
            error = JSON.stringify(toolInfo.error)
          }
        }

        items.push({
          kind: 'tool',
          tool: finalTool,
          input: finalInput,
          output,
          error,
          at: now
        })
      }
    }

    return {
      items,
      conversationId: state.conversationId,
      usage
    }
  }

  if (event === 'result') {
    const res = (obj.result ?? {}) as Record<string, unknown>
    const items: CliTranscriptItem[] = []

    if (res.conversation_id && !state.conversationId) {
      state.conversationId = String(res.conversation_id)
    }

    // Flush any pending tool that never got a DONE event
    for (const [, pending] of state.pendingTools.entries()) {
      items.push({
        kind: 'tool',
        tool: pending.tool,
        input: pending.input,
        output: undefined,
        at: now
      })
    }
    state.pendingTools.clear()

    const rawStatus = String(res.status ?? '').toUpperCase()
    let status: CliTaskStatus = 'failed'

    if (rawStatus === 'SUCCESS') {
      status = 'completed'
    } else if (rawStatus === 'ERROR') {
      status = 'failed'
    } else if (rawStatus === 'CANCELED' || rawStatus === 'CANCELLED') {
      status = 'cancelled'
    } else if (rawStatus === 'INTERRUPTED') {
      status = 'interrupted'
    } else if (rawStatus === 'RUNNING') {
      status = 'timeout'
      items.push({
        kind: 'notice',
        level: 'warn',
        text: `CLI task ended with status: ${rawStatus}`,
        at: now
      })
    } else if (rawStatus === 'INVALID' || rawStatus === 'WAITING') {
      status = 'failed'
      items.push({
        kind: 'notice',
        level: 'warn',
        text: `CLI task ended with status: ${rawStatus}`,
        at: now
      })
    } else {
      status = 'failed'
      items.push({
        kind: 'notice',
        level: 'warn',
        text: `CLI task ended with status: ${rawStatus || 'UNKNOWN'}`,
        at: now
      })
    }

    const deniedList = Array.isArray(res.denied_actions) ? res.denied_actions : []
    const deniedActions = deniedList.map(formatDeniedAction)

    if (deniedActions.length > 0) {
      items.push({
        kind: 'notice',
        level: 'warn',
        text: `Actions denied by policy: ${deniedActions.join(', ')}`,
        at: now
      })
    }

    const text = typeof res.response === 'string' ? res.response : (res.response !== undefined ? String(res.response) : '')
    const error = res.error ? (typeof res.error === 'string' ? res.error : JSON.stringify(res.error)) : undefined
    const usage = parseTokenUsage(res.usage) ?? state.lastUsage

    items.push({
      kind: 'result',
      status,
      text,
      usage,
      deniedActions: deniedActions.length > 0 ? deniedActions : undefined,
      at: now
    })

    const terminal: CliTerminalResult = {
      status,
      text,
      usage,
      deniedActions: deniedActions.length > 0 ? deniedActions : undefined,
      error
    }

    return {
      items,
      conversationId: state.conversationId,
      usage,
      terminal
    }
  }

  return { items: [] }
}

export function createAntigravityParser(initialState?: Partial<AntigravityParserState>) {
  const state = createAntigravityState(initialState)

  return {
    parseLine(line: string, now = Date.now()): CliParseResult {
      return parseAntigravityLine(line, state, now)
    },
    getState(): AntigravityParserState {
      return state
    }
  }
}
