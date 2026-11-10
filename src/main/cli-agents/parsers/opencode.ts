// TODO: capture the real v2 NDJSON shape with an authenticated provider and tighten the mapping.

import type { CliTaskStatus, CliTranscriptItem, TokenUsage } from '../../../shared/types'
import { parseTokenUsage } from './antigravity'
import type { CliParseResult, CliTerminalResult } from './types'

export type { CliParseResult, CliTerminalResult }

export interface OpenCodeParserState {
  conversationId?: string
  lastUsage?: TokenUsage
  pendingTools: Map<string, { tool: string; input?: Record<string, unknown> }>
  completedSteps: Set<string>
}

export function createOpenCodeState(initial?: Partial<OpenCodeParserState>): OpenCodeParserState {
  return {
    conversationId: initial?.conversationId,
    lastUsage: initial?.lastUsage,
    pendingTools: initial?.pendingTools ?? new Map(),
    completedSteps: initial?.completedSteps ?? new Set()
  }
}

export function parseOpenCodeLine(
  line: string,
  state: OpenCodeParserState,
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
  const type = String(obj.type ?? obj.event ?? obj.kind ?? '').toLowerCase()
  const items: CliTranscriptItem[] = []

  // Extract session/conversation ID if present
  const sessionId = obj.session_id ?? obj.sessionId ?? obj.conversation_id ?? obj.conversationId
  if (sessionId && !state.conversationId) {
    state.conversationId = String(sessionId)
  }

  // Extract usage if present
  const usage = parseTokenUsage(obj.usage ?? obj.tokens)
  if (usage) {
    state.lastUsage = usage
  }

  if (type === 'init') {
    return {
      items: [],
      conversationId: state.conversationId,
      usage
    }
  }

  // Terminal result line
  const isTerminal =
    type === 'result' ||
    type === 'done' ||
    type === 'finish' ||
    obj.status === 'completed' ||
    obj.status === 'success' ||
    obj.status === 'failed' ||
    obj.status === 'error' ||
    obj.status === 'cancelled' ||
    obj.status === 'timeout'

  if (isTerminal) {
    // Flush any pending tools
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

    const rawStatus = String(obj.status ?? (obj.error ? 'failed' : 'completed')).toLowerCase()
    let status: CliTaskStatus = 'failed'

    if (rawStatus === 'completed' || rawStatus === 'success' || rawStatus === 'ok') {
      status = 'completed'
    } else if (rawStatus === 'cancelled') {
      status = 'cancelled'
    } else if (rawStatus === 'timeout') {
      status = 'timeout'
    } else {
      status = 'failed'
    }

    const text = typeof obj.text === 'string'
      ? obj.text
      : (typeof obj.response === 'string'
        ? obj.response
        : (typeof obj.result === 'string'
          ? obj.result
          : (typeof obj.content === 'string'
            ? obj.content
            : (obj.response !== undefined || obj.result !== undefined ? String(obj.response ?? obj.result) : ''))))

    const error = obj.error
      ? (typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error))
      : undefined

    const finalUsage = usage ?? state.lastUsage

    items.push({
      kind: 'result',
      status,
      text,
      usage: finalUsage,
      at: now
    })

    const terminal: CliTerminalResult = {
      status,
      text,
      usage: finalUsage,
      error
    }

    return {
      items,
      conversationId: state.conversationId,
      usage: finalUsage,
      terminal
    }
  }

  // Error event
  if (type === 'error' || (obj.error && !obj.output && !obj.status)) {
    const errorMsg = typeof obj.error === 'string'
      ? obj.error
      : (typeof (obj.error as Record<string, unknown>)?.message === 'string'
        ? (obj.error as Record<string, unknown>).message as string
        : (typeof obj.message === 'string' ? obj.message : 'Unknown error'))

    items.push({
      kind: 'notice',
      level: 'error',
      text: errorMsg,
      at: now
    })

    return {
      items,
      conversationId: state.conversationId,
      usage
    }
  }

  // Tool event
  const hasToolIndicator =
    type.includes('tool') ||
    obj.tool !== undefined ||
    obj.tool_name !== undefined

  if (hasToolIndicator) {
    const toolName = String(obj.tool ?? obj.tool_name ?? obj.name ?? 'unknown_tool')
    const input = (obj.input ?? obj.parameters ?? obj.args) as Record<string, unknown> | undefined
    const callId = String(obj.id ?? obj.call_id ?? obj.tool_call_id ?? `${toolName}_${obj.step ?? Date.now()}`)

    const hasOutput = obj.output !== undefined
    const hasError = obj.error !== undefined

    if (type === 'tool_use' || type === 'tool_start' || (!hasOutput && !hasError)) {
      state.pendingTools.set(callId, { tool: toolName, input })
      return {
        items: [],
        conversationId: state.conversationId,
        usage
      }
    }

    if (state.completedSteps.has(callId)) {
      return { items: [], conversationId: state.conversationId, usage }
    }
    state.completedSteps.add(callId)

    const pending = state.pendingTools.get(callId)
    state.pendingTools.delete(callId)

    const finalTool = toolName !== 'unknown_tool' ? toolName : (pending?.tool ?? 'unknown_tool')
    const finalInput = input ?? pending?.input

    let output: string | undefined
    if (obj.output !== undefined) {
      output = typeof obj.output === 'string' ? obj.output : JSON.stringify(obj.output)
    }

    let error: string | undefined
    if (obj.error !== undefined) {
      error = typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error)
    }

    items.push({
      kind: 'tool',
      tool: finalTool,
      input: finalInput,
      output,
      error,
      at: now
    })

    return {
      items,
      conversationId: state.conversationId,
      usage
    }
  }

  // Text/assistant message
  const textVal = obj.delta ?? obj.text_delta ?? obj.text ?? obj.content
  if (typeof textVal === 'string' && textVal.length > 0) {
    items.push({
      kind: 'assistant',
      text: textVal,
      at: now
    })
  }

  return {
    items,
    conversationId: state.conversationId,
    usage
  }
}

export function createOpenCodeParser(initialState?: Partial<OpenCodeParserState>) {
  const state = createOpenCodeState(initialState)

  return {
    parseLine(line: string, now = Date.now()): CliParseResult {
      return parseOpenCodeLine(line, state, now)
    },
    getState(): OpenCodeParserState {
      return state
    }
  }
}
