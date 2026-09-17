// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'

marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

const KATEX_DOMPURIFY_CONFIG = {
  ADD_TAGS: [
    'math',
    'annotation',
    'semantics',
    'mtext',
    'mn',
    'mo',
    'mi',
    'mspace',
    'mover',
    'munder',
    'munderover',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'mroot',
    'msqrt',
    'mtable',
    'mtr',
    'mtd',
    'mlabeledtr',
    'mrow'
  ],
  ADD_ATTR: ['aria-hidden', 'tabindex', 'style', 'encoding', 'mathvariant']
}

describe('Markdown KaTeX Integration', () => {
  it('renders inline math $E = mc^2$', () => {
    const raw = marked.parse('$E = mc^2$', { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, KATEX_DOMPURIFY_CONFIG)
    expect(sanitized).toContain('katex')
    expect(sanitized).toContain('E = mc^2')
  })

  it('renders block display math $$\\frac{a}{b}$$', () => {
    const raw = marked.parse('$$\\frac{a}{b}$$', { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, KATEX_DOMPURIFY_CONFIG)
    expect(sanitized).toContain('katex-display')
    expect(sanitized).toContain('mfrac')
  })

  it('does not format standalone currency like $100 as math', () => {
    const raw = marked.parse('The price is $100 for this item.', { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, KATEX_DOMPURIFY_CONFIG)
    expect(sanitized).not.toContain('katex')
    expect(sanitized).toContain('$100')
  })

  it('handles invalid math gracefully without throwing', () => {
    expect(() => {
      const raw = marked.parse('$\\invalidMacro{123$', { async: false }) as string
      DOMPurify.sanitize(raw, KATEX_DOMPURIFY_CONFIG)
    }).not.toThrow()
  })
})
