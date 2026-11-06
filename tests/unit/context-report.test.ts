import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MCP_TOOL_PREFIX,
  buildContextSections,
  isMcpToolName,
  sumTokens,
  systemSectionTokens,
  toolDefinitionTokens
} from '../../src/main/agent/context-report'
import type { SystemPromptSection } from '../../src/main/agent/prompt'

const system: SystemPromptSection[] = [
  { key: 'system', title: 'Identity & how to work', text: 'You are Meow.' },
  { key: 'instructions', title: 'Project instructions', text: 'Repo rules here.' }
]

function tool(name: string, description = 'does a thing', schema: unknown = { type: 'object', properties: {} }) {
  return { name, description, schema }
}

describe('systemSectionTokens', () => {
  it('charges the rendered heading as well as the body', () => {
    const section = system[0]
    const bodyOnly = Math.round(section.text.length / 3.5)
    expect(systemSectionTokens(section)).toBeGreaterThan(bodyOnly)
  })
})

describe('toolDefinitionTokens', () => {
  it('counts a zod schema as its JSON schema, not as an empty object', () => {
    const zodTool = {
      name: 'grep',
      description: 'search files',
      schema: z.object({
        pattern: z.string().describe('regex to search for'),
        path: z.string().optional(),
        caseSensitive: z.boolean().optional()
      })
    }
    const bareTool = { name: 'grep', description: 'search files', schema: {} }
    // A zod schema stringifies to `{}`, which would make every tool look tiny.
    expect(toolDefinitionTokens(zodTool)).toBeGreaterThan(toolDefinitionTokens(bareTool) + 20)
  })

  it('falls back to the description when a schema cannot be converted', () => {
    const broken = { name: 'x', description: 'y'.repeat(700), schema: z.string() }
    expect(toolDefinitionTokens(broken)).toBeGreaterThan(150)
  })
})

describe('isMcpToolName', () => {
  it('recognises the mcp__server__tool prefix only', () => {
    expect(isMcpToolName(`${MCP_TOOL_PREFIX}github__create_issue`)).toBe(true)
    expect(isMcpToolName('read')).toBe(false)
    expect(isMcpToolName('mcp')).toBe(false)
  })
})

describe('buildContextSections', () => {
  it('orders system sections, memory index, tools, MCP tools, then messages', () => {
    const sections = buildContextSections({
      system,
      memoryIndex: 'Memory index (path):\n- [A](a.md) — hook',
      tools: [tool('read'), tool(`${MCP_TOOL_PREFIX}github__issue`), tool('write')],
      messagesTokens: 4200
    })
    expect(sections.map(s => s.label)).toEqual([
      'System prompt',
      'Instructions',
      'Memory index',
      'Tools',
      'MCP tools',
      'Messages'
    ])
    expect(sections.map(s => s.kind)).toEqual(['system', 'system', 'system', 'tools', 'mcp', 'messages'])
  })

  it('splits the tool total by server prefix', () => {
    const sections = buildContextSections({
      system: [],
      tools: [
        tool('read', 'small'),
        tool('grep', 'g'.repeat(3000)),
        tool(`${MCP_TOOL_PREFIX}a__one`, 'x'),
        tool(`${MCP_TOOL_PREFIX}b__two`, 'y'.repeat(3000))
      ],
      messagesTokens: 10
    })
    const builtin = sections.find(s => s.kind === 'tools')!
    const mcp = sections.find(s => s.kind === 'mcp')!
    expect(builtin.label).toBe('Tools')
    expect(builtin.tokens).toBeGreaterThan(800)
    expect(mcp.tokens).toBeGreaterThan(0)
    // Section totals are the sum of their tools, nothing else.
    expect(builtin.tokens + mcp.tokens).toBe(
      sections.filter(s => s.kind === 'tools' || s.kind === 'mcp').reduce((n, s) => n + s.tokens, 0)
    )
  })

  it('omits Messages for an empty transcript and skips empty tool buckets', () => {
    const sections = buildContextSections({ system, tools: [], messagesTokens: null })
    expect(sections.some(s => s.label === 'Messages')).toBe(false)
    expect(sections.some(s => s.kind === 'tools' || s.kind === 'mcp')).toBe(false)
    expect(sumTokens(sections)).toBe(sections.reduce((n, s) => n + s.tokens, 0))
  })
})
