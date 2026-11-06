import { z } from 'zod'
import type { ContextSection } from '../../shared/types'
import { estimateTokens, estimateUsage } from './token'
import type { SystemPromptSection, SystemPromptSectionKey } from './prompt'
import type { ToolSchema } from './tools/types'

// What the model is charged for a request, split into the buckets the context
// readout shows: the static prompt (one line per labeled section), the turn's
// memory index, tool definitions (built-in / user / MCP), and the transcript.
// Estimates only — no provider tokenizer is available in the main process — so
// the numbers track `estimateTokens` (3.5 chars/token), the same measure the
// compaction threshold uses.

/** Display label per system-prompt section; the prompt itself uses the longer titles. */
export const SECTION_LABELS: Record<SystemPromptSectionKey, string> = {
  system: 'System prompt',
  instructions: 'Instructions',
  memory: 'Memory',
  skills: 'Skills',
  mode: 'Mode'
}

export const MCP_TOOL_PREFIX = 'mcp__'

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

/** Tokens of one rendered `# <title>` section, header included. */
export function systemSectionTokens(section: SystemPromptSection): number {
  return estimateTokens(`# ${section.title}\n\n${section.text}`)
}

export interface ToolLike {
  name: string
  description: string
  schema: ToolSchema
}

/**
 * Tokens one tool definition adds to the request: name + description + JSON
 * schema. Zod schemas stringify to `{}`, which would count every tool as a few
 * dozen tokens, so they are converted to JSON Schema first — that is the shape
 * the provider actually receives.
 */
export function toolDefinitionTokens(tool: ToolLike): number {
  return estimateUsage({ name: tool.name, description: tool.description, schema: schemaJson(tool.schema) })
}

function schemaJson(schema: ToolSchema): unknown {
  if (typeof (schema as { parse?: unknown }).parse !== 'function') return schema
  try {
    return z.toJSONSchema(schema as z.ZodType)
  } catch {
    return {}
  }
}

export interface ContextReportInput {
  /** Non-empty system-prompt sections, in prompt order. */
  system: SystemPromptSection[]
  /** Memory index text appended to the turn reminder, if any. */
  memoryIndex?: string
  /** Every tool definition the next request carries. */
  tools: ToolLike[]
  /** Estimated tokens of the transcript; null when the session is empty. */
  messagesTokens: number | null
}

/** Section totals in display order, with the tool list split into built-in and MCP. */
export function buildContextSections(input: ContextReportInput): ContextSection[] {
  const sections: ContextSection[] = input.system.map(section => ({
    kind: 'system',
    label: SECTION_LABELS[section.key],
    tokens: systemSectionTokens(section)
  }))

  const index = input.memoryIndex?.trim()
  if (index) sections.push({ kind: 'system', label: 'Memory index', tokens: estimateTokens(index) })

  let builtin = 0
  let mcp = 0
  for (const tool of input.tools) {
    if (isMcpToolName(tool.name)) mcp += toolDefinitionTokens(tool)
    else builtin += toolDefinitionTokens(tool)
  }
  if (builtin > 0) sections.push({ kind: 'tools', label: 'Tools', tokens: builtin })
  if (mcp > 0) sections.push({ kind: 'mcp', label: 'MCP tools', tokens: mcp })

  if (input.messagesTokens !== null) {
    sections.push({ kind: 'messages', label: 'Messages', tokens: input.messagesTokens })
  }
  return sections
}

export function sumTokens(sections: ContextSection[]): number {
  return sections.reduce((total, section) => total + section.tokens, 0)
}
