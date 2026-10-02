import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { asSchema, safeParseJSON } from '@ai-sdk/provider-utils'
import type { JSONSchema7 } from '@ai-sdk/provider'
import { repairToolCall, repairToolCallInput } from '../../src/main/agent/tool-input-repair'
import { questionTool } from '../../src/main/agent/tools/question'
import { grepTool } from '../../src/main/agent/tools/grep'

async function jsonSchemaOf(tool: { schema: unknown }): Promise<JSONSchema7> {
  return (await asSchema(tool.schema as z.ZodType).jsonSchema) as JSONSchema7
}

async function validates(tool: { schema: unknown }, repaired: Record<string, unknown> | null): Promise<boolean> {
  if (!repaired) return false
  const res = await safeParseJSON({ text: JSON.stringify(repaired), schema: asSchema(tool.schema as z.ZodType) })
  return res.success
}

describe('repairToolCallInput', () => {
  it('unwraps a stringified options array and hoists the swallowed question', async () => {
    // The exact shape DeepSeek streams: `options` is a JSON string and the
    // model kept writing `, "question": "…"` after the array closed.
    const raw = JSON.stringify({
      header: 'Ghi session index',
      options: '[{"label":"A"},{"label":"B"}], "question": "Chọn mục nào?"'
    })
    const schema = await jsonSchemaOf(questionTool)
    const repaired = repairToolCallInput(raw, schema)
    expect(repaired).toEqual({
      header: 'Ghi session index',
      options: [{ label: 'A' }, { label: 'B' }],
      question: 'Chọn mục nào?'
    })
    expect(await validates(questionTool, repaired)).toBe(true)
  })

  it('keeps a trailing field that follows the swallowed question', async () => {
    const raw = JSON.stringify({
      header: 'Pick',
      options: '[{"label":"A"}], "question": "Which?", "multiple": true}'
    })
    const repaired = repairToolCallInput(raw, await jsonSchemaOf(questionTool))
    expect(repaired).toMatchObject({ question: 'Which?', multiple: true })
    expect(await validates(questionTool, repaired)).toBe(true)
  })

  it('merges concatenated argument objects', async () => {
    const raw = '{"name":"using-superpowers"}{"name":"frontend-design"}{"file_path":"AGENTS.md"}'
    const schema = { type: 'object', properties: { name: { type: 'string' }, file_path: { type: 'string' } } } as JSONSchema7
    expect(repairToolCallInput(raw, schema)).toEqual({ name: 'frontend-design', file_path: 'AGENTS.md' })
  })

  it('wraps a scalar the schema declares as an array', async () => {
    const raw = JSON.stringify({ pattern: 'foo', include: '*.css' })
    const repaired = repairToolCallInput(raw, await jsonSchemaOf(grepTool))
    expect(repaired).toEqual({ pattern: 'foo', include: ['*.css'] })
    expect(await validates(grepTool, repaired)).toBe(true)
  })

  it('leaves an already-valid call alone', async () => {
    const raw = JSON.stringify({ question: 'ok?', options: [{ label: 'Yes' }] })
    expect(repairToolCallInput(raw, await jsonSchemaOf(questionTool))).toBeNull()
  })

  it('gives up when the arguments are missing the required field entirely', async () => {
    // The model produced options but never a question: nothing to hoist.
    const raw = JSON.stringify({ header: 'Hướng xử lý', options: [{ label: 'A' }] })
    expect(repairToolCallInput(raw, await jsonSchemaOf(questionTool))).toBeNull()
  })

  it('gives up on text that is neither JSON nor concatenated objects', () => {
    expect(repairToolCallInput('not json at all', undefined)).toBeNull()
  })
})

describe('repairToolCall', () => {
  const toolCall = (input: string) => ({ type: 'tool-call' as const, toolCallId: 't1', toolName: 'question', input })

  it('returns the call with repaired, re-serialized arguments', async () => {
    const input = JSON.stringify({ header: 'H', options: '[{"label":"A"}], "question": "Q?"' })
    const repaired = await repairToolCall({
      toolCall: toolCall(input),
      inputSchema: async () => await jsonSchemaOf(questionTool)
    })
    expect(repaired?.toolCallId).toBe('t1')
    expect(JSON.parse(repaired!.input)).toMatchObject({ question: 'Q?', options: [{ label: 'A' }] })
  })

  it('returns null when the call cannot be repaired', async () => {
    const repaired = await repairToolCall({
      toolCall: toolCall(JSON.stringify({ header: 'H' })),
      inputSchema: async () => await jsonSchemaOf(questionTool)
    })
    expect(repaired).toBeNull()
  })

  it('still repairs when the schema resolver fails', async () => {
    const input = '{"name":"a"}{"name":"b"}'
    const repaired = await repairToolCall({
      toolCall: { ...toolCall(input), toolName: 'skill' },
      inputSchema: async () => {
        throw new Error('no such tool')
      }
    })
    expect(JSON.parse(repaired!.input)).toEqual({ name: 'b' })
  })
})
