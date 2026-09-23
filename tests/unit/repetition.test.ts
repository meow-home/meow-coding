import { describe, expect, it } from 'vitest'
import { isIdlePoll, repeatDetector, toolLoopDetector } from '../../src/main/agent/repetition'

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
