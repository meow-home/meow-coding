import { describe, expect, it } from 'vitest'
import { loopDetector, repeatDetector, toolLoopDetector } from '../../src/main/agent/repetition'

// A faithful mirror of the degenerate "thinking loop" from the bug report: the
// model keeps re-emitting "let me look at the question tool's run and the
// ctx.ask flow again" (with slight openers) without ever calling a tool.
const LOOP_BASE = 'look at the `question` tool\'s `run` and the `ctx.ask` flow again'
const LOOP_SENTENCES = [
  `Let me ${LOOP_BASE}. `,
  `Actually, let me ${LOOP_BASE}. `,
  `OK, I need to actually ${LOOP_BASE}. `,
  `I'm going to ${LOOP_BASE}. `
]

function feedChunks(detector: ReturnType<typeof loopDetector>, chunksLikeStream: (string | string[])[]) {
  for (const c of chunksLikeStream) {
    const text = typeof c === 'string' ? c : c.join(' ')
    if (detector.next(text)) return true
  }
  return false
}

function seedRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function variedReasoningChunks(chunks: number, seed = 1): string[] {
  const rnd = seedRng(seed)
  const pool = Array.from({ length: 300 }, (_, i) => `w${i}`)
  const out: string[] = []
  for (let i = 0; i < chunks; i++) {
    const n = 12 + Math.floor(rnd() * 10)
    const words = Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)])
    out.push(words.join(' ') + '. ')
  }
  return out
}

describe('loopDetector', () => {
  it('flags the exact thinking-loop pattern from the bug report', () => {
    // Two sentences per "unit", like the observed output, streamed chunk-wise.
    const units = Array.from({ length: 6 }, () => [LOOP_SENTENCES[0], LOOP_SENTENCES[1]])
    const d = loopDetector()
    expect(feedChunks(d, units)).toBe(true)
  })

  it('flags as soon as a verbatim 12-word phrase has repeated four times', () => {
    const d = loopDetector()
    // One sentence repeats the phrase once; 4 sentences → 4 occurrences.
    for (let i = 0; i < 3; i++) {
      expect(d.next(LOOP_SENTENCES[0])).toBe(false)
    }
    expect(d.next(LOOP_SENTENCES[0])).toBe(true)
  })

  it('does not flag a long but genuinely varied reasoning stream', () => {
    const d = loopDetector()
    for (const chunk of variedReasoningChunks(60)) {
      if (d.next(chunk)) {
        expect.fail('varied stream was flagged as a loop')
      }
    }
  })

  it('does not flag a short normal answer', () => {
    const d = loopDetector()
    expect(d.next('The function returns the resolved output, or an error if the tool failed.')).toBe(false)
  })
})

describe('toolLoopDetector', () => {
  it('flags the same tool+input repeated three times', () => {
    const d = toolLoopDetector()
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(true)
  })

  it('does not flag the same tool with different input', () => {
    const d = toolLoopDetector()
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'b.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'c.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'd.ts' } }])).toBe(false)
  })

  it('does not flag different tools', () => {
    const d = toolLoopDetector()
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'grep', input: { pattern: 'x' } }])).toBe(false)
    expect(d.next([{ tool: 'bash', input: { command: 'ls' } }])).toBe(false)
  })

  it('forgets old fingerprints once they slide out of the window', () => {
    const d = toolLoopDetector({ history: 2, minRepeats: 3 })
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
    // Two distinct calls push the repeated one out of the 2-slot window.
    expect(d.next([{ tool: 'read', input: { file_path: 'b.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'c.ts' } }])).toBe(false)
    expect(d.next([{ tool: 'read', input: { file_path: 'a.ts' } }])).toBe(false)
  })
})

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
