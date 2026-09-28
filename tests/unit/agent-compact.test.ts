import { describe, expect, it } from 'vitest'
import { usableContextTokens, fitHeadToBudget, selectHeadTail, buildCompactionPrompt, compactTranscript, COMPACTION_MARKER, truncateToolOutput, serializeItems, hardTruncate, resolveCompactionSettings, COMPACTION_RATIOS, CLEARED_OUTPUT, splitWithinTurn, planCompaction } from '../../src/main/agent/compact'
import type { CompactionSettings } from '../../src/main/agent/compact'
import { estimateTokens, estimateUsage } from '../../src/main/agent/token'
import type { TranscriptItem } from '../../src/main/agent/message'
import type { ChatMessage, ToolCallData } from '../../src/shared/types'
import type { LlmClient, LlmStreamPart } from '../../src/main/agent/llm'

function msg(role: ChatMessage['role'], text: string): TranscriptItem {
  return { kind: 'message', message: { id: Math.random().toString(36), role, text, createdAt: 1 } }
}
function tool(text: string): TranscriptItem {
  const t: ToolCallData = { id: 't', tool: 'bash', input: {}, permission: 'allowed', output: text }
  return { kind: 'tool', tool: t }
}
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

describe('selectHeadTail', () => {
  it('keeps the recent tail turns and summarizes the older head', () => {
    const items = [
      msg('user', 'old prompt'),
      msg('assistant', 'old answer'),
      msg('user', 'recent prompt'),
      msg('assistant', 'recent answer'),
      msg('user', 'latest prompt')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 2)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'old prompt')).toBe(true)
    expect(tail.some(i => i.kind === 'message' && i.message.text === 'latest prompt')).toBe(true)
    expect(tail[0].kind === 'message' && tail[0].message.role === 'user').toBe(true)
  })

  it('returns everything as head when tailTurns is 0', () => {
    const items = [msg('user', 'a'), msg('user', 'b')]
    const { head, tail } = selectHeadTail(items, 100, 0)
    expect(head).toHaveLength(2)
    expect(tail).toHaveLength(0)
  })

  it('ignores the compaction marker user message when counting turns', () => {
    const items = [
      { kind: 'message' as const, message: { id: 's', role: 'user' as const, text: COMPACTION_MARKER, createdAt: 1 } },
      { kind: 'message' as const, message: { id: 'sa', role: 'assistant' as const, text: 'summary', createdAt: 1 } },
      msg('user', 'real question'),
      msg('assistant', 'answer')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 1)
    expect(head).toHaveLength(0)
    expect(tail).toHaveLength(2)
    expect(tail[0].kind === 'message' && tail[0].message.text === 'real question').toBe(true)
  })

  it('excludes a prior compaction pair from the head', () => {
    const items = [
      { kind: 'message' as const, message: { id: 's', role: 'user' as const, text: COMPACTION_MARKER, createdAt: 1 } },
      { kind: 'message' as const, message: { id: 'sa', role: 'assistant' as const, text: 'summary', createdAt: 1 } },
      msg('user', 'old question'),
      msg('assistant', 'old answer'),
      msg('user', 'recent question')
    ]
    const { head, tail } = selectHeadTail(items, 1000000, 1)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'summary')).toBe(false)
    expect(head.some(i => i.kind === 'message' && i.message.text === 'old question')).toBe(true)
    expect(tail.some(i => i.kind === 'message' && i.message.text === 'recent question')).toBe(true)
  })
})

describe('serializeItems / truncateToolOutput', () => {
  it('serializes messages and tool calls into prompt text', () => {
    const items: TranscriptItem[] = [
      msg('user', 'hello'),
      { kind: 'tool', tool: { id: 't', tool: 'bash', input: { command: 'ls' }, permission: 'allowed', output: 'a\nb\nc\n'.repeat(20) } }
    ]
    const text = serializeItems(items, 5)
    expect(text).toContain('[User]: hello')
    expect(text).toContain('[Assistant tool call]: bash({"command":"ls"})')
    expect(text).toContain('[truncated]')
  })

  it('truncateToolOutput keeps short outputs unchanged', () => {
    expect(truncateToolOutput('short', 100)).toBe('short')
    expect(truncateToolOutput('x'.repeat(300), 200)).toMatch(/\[truncated\]/)
  })
})

describe('buildCompactionPrompt', () => {
  it('creates a fresh summary prompt without a previous summary', () => {
    const prompt = buildCompactionPrompt(undefined, '[User]: hi')
    expect(prompt).toContain('Create a new anchored summary')
    expect(prompt).toContain('## Objective')
    expect(prompt).toContain('[User]: hi')
  })

  it('requests an update when a previous summary exists', () => {
    const prompt = buildCompactionPrompt('old summary', '[User]: hi')
    expect(prompt).toContain('Update the anchored summary')
    expect(prompt).toContain('<previous-summary>\nold summary\n</previous-summary>')
  })
})

describe('compactTranscript', () => {
  function stubLlm(parts: LlmStreamPart[]): LlmClient {
    return {
      async *stream(): AsyncGenerator<LlmStreamPart> {
        for (const p of parts) yield p
      }
    }
  }

  it('returns the concatenated summary text', async () => {
    const llm = stubLlm([
      { kind: 'text', text: '## Objective' },
      { kind: 'text', text: '\n- build the feature' },
      { kind: 'finish' }
    ])
    const summary = await compactTranscript({ llm, model: 'm', prompt: 'summarize' })
    expect(summary).toBe('## Objective\n- build the feature')
  })

  it('returns null on an llm error part', async () => {
    const llm = stubLlm([{ kind: 'error', error: 'boom' }])
    expect(await compactTranscript({ llm, model: 'm', prompt: 'summarize' })).toBeNull()
  })

  it('returns null on an empty result', async () => {
    const llm = stubLlm([{ kind: 'finish' }])
    expect(await compactTranscript({ llm, model: 'm', prompt: 'summarize' })).toBeNull()
  })

  it('returns null when aborted mid-stream', async () => {
    const controller = new AbortController()
    const llm: LlmClient = {
      async *stream(): AsyncGenerator<LlmStreamPart> {
        yield { kind: 'text', text: 'partial' }
        controller.abort()
      }
    }
    expect(await compactTranscript({ llm, model: 'm', prompt: 'x', signal: controller.signal })).toBeNull()
  })
})

describe('hardTruncate', () => {
  it('clears tool outputs to get the transcript under the target', () => {
    const items = [msg('user', 'q'), msg('assistant', 'a'), tool('x'.repeat(20000))]
    const out = hardTruncate(items, 2000)
    const t = out.find(i => i.kind === 'tool')
    expect(t?.kind === 'tool' && t.tool.output).toBe(CLEARED_OUTPUT)
    expect(t?.kind === 'tool' ? t.tool.error : 'set').toBeUndefined()
    expect(estimateUsage(out)).toBeLessThan(2000)
  })

  it('drops the oldest turns when clearing tool outputs is not enough', () => {
    const items = [
      msg('user', 'old ' + 'x'.repeat(20000)),
      msg('assistant', 'old answer'),
      msg('user', 'recent question'),
      msg('assistant', 'recent answer')
    ]
    const out = hardTruncate(items, 2000)
    expect(out.some(i => i.kind === 'message' && i.message.text.startsWith('old '))).toBe(false)
    expect(out.some(i => i.kind === 'message' && i.message.text === 'recent question')).toBe(true)
    expect(estimateUsage(out)).toBeLessThan(2000)
  })

  it('keeps the last turn even when it alone exceeds the target', () => {
    const items = [msg('user', 'huge ' + 'x'.repeat(50000))]
    const out = hardTruncate(items, 100)
    expect(out).toHaveLength(1)
  })

  it('leaves a transcript that already fits untouched', () => {
    const items = [msg('user', 'small'), msg('assistant', 'ok')]
    expect(hardTruncate(items, 100000)).toEqual(items)
  })

  it('does not mutate the items it was given', () => {
    const items = [msg('user', 'q'), msg('assistant', 'a'), tool('x'.repeat(20000))]
    hardTruncate(items, 2000)
    const original = items.find(i => i.kind === 'tool')
    expect(original?.kind === 'tool' && original.tool.output).toBe('x'.repeat(20000))
  })
})

describe('usableContextTokens', () => {
  it('reserves both the compaction buffer and the output budget', () => {
    expect(usableContextTokens(200000, 20000, 32000)).toBe(148000)
  })

  it('treats a missing output reserve as zero', () => {
    expect(usableContextTokens(200000, 20000)).toBe(180000)
  })
})

describe('fitHeadToBudget', () => {
  it('leaves a head that already fits alone', () => {
    const head = [msg('user', 'q'), msg('assistant', 'a')]
    expect(fitHeadToBudget(head, 100000, 2000)).toEqual(head)
  })

  it('drops the oldest turns until the summary prompt fits', () => {
    const head = [
      msg('user', 'oldest ' + 'x'.repeat(20000)),
      msg('assistant', 'a1'),
      msg('user', 'middle ' + 'y'.repeat(20000)),
      msg('assistant', 'a2'),
      msg('user', 'newest'),
      msg('assistant', 'a3')
    ]
    const out = fitHeadToBudget(head, 2000, 2000)
    expect(out.some(i => i.kind === 'message' && i.message.text.startsWith('oldest'))).toBe(false)
    expect(out.some(i => i.kind === 'message' && i.message.text === 'newest')).toBe(true)
    expect(estimateTokens(serializeItems(out, 2000))).toBeLessThanOrEqual(2000)
  })

  it('still shrinks a head made of one oversized turn', () => {
    const head = [msg('user', 'only turn'), msg('assistant', 'z'.repeat(80000))]
    const out = fitHeadToBudget(head, 500, 2000)
    expect(estimateTokens(serializeItems(out, 2000))).toBeLessThanOrEqual(500)
  })

  it('gives up on an empty head rather than looping', () => {
    expect(fitHeadToBudget([], 10, 2000)).toEqual([])
  })
})

describe('resolveCompactionSettings', () => {
  const full: CompactionSettings = { auto: true, tailTurns: 2 }

  it('scales buffer/keepTokens/toolOutputMaxChars by ratio of context window', () => {
    const r = resolveCompactionSettings(full, 200000, 0)
    expect(r.buffer).toBe(Math.round(200000 * COMPACTION_RATIOS.buffer)) // 30000
    expect(r.keepTokens).toBe(Math.round(200000 * COMPACTION_RATIOS.keepTokens)) // 12000
    expect(r.toolOutputMaxChars).toBe(Math.round(200000 * COMPACTION_RATIOS.toolOutputMaxChars)) // 3000
    expect(r.tailTurns).toBe(2)
    expect(r.auto).toBe(true)
  })

  it('applies floors for small context windows', () => {
    const r = resolveCompactionSettings(full, 128000, 0)
    expect(r.buffer).toBeGreaterThanOrEqual(10000)
    expect(r.keepTokens).toBeGreaterThanOrEqual(4000)
    expect(r.toolOutputMaxChars).toBeGreaterThanOrEqual(1500)
  })

  it('override values win over the ratio', () => {
    const r = resolveCompactionSettings(
      { auto: true, tailTurns: 2, buffer: 5000, keepTokens: 5000, toolOutputMaxChars: 500 },
      1000000, 0
    )
    expect(r.buffer).toBe(5000)
    expect(r.keepTokens).toBe(5000)
    expect(r.toolOutputMaxChars).toBe(500)
  })

  it('clamps keepTokens to at most half the usable context', () => {
    const r = resolveCompactionSettings(full, 10000, 9000)
    const usable = Math.max(0, 10000 - 9000)
    expect(r.keepTokens).toBeLessThanOrEqual(Math.floor(usable / 2))
  })

  it('passes through tailTurns and auto untouched', () => {
    const r = resolveCompactionSettings({ auto: false, tailTurns: 4 }, 200000, 0)
    expect(r.auto).toBe(false)
    expect(r.tailTurns).toBe(4)
  })
})

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

  it('splits the long last turn even when a small earlier turn exists', () => {
    const steps = Array.from({ length: 10 }, (_, i) => step(`s${i}`, 'x'.repeat(4000))).flat()
    const items = [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'build it'), ...steps]
    const plan = planCompaction(items, 300, 2)!
    expect(texts(plan.head)).toEqual(['hi', 'hello', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])
    expect(plan.keep[0]).toBe(items[2])
    expect(texts(plan.keep)).toEqual(['build it', 's9'])
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
