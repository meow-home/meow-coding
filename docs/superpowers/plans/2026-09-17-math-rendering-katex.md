# KaTeX Math Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable native LaTeX / KaTeX mathematical expression rendering in all markdown views (`MarkdownText`) across the chat feed, subagent overlay, file preview, and dialogs.

**Architecture:** Integrate `marked-katex-extension` into `marked` in `MarkdownText.tsx`, configure `DOMPurify.sanitize` with MathML / KaTeX SVG tag and attribute whitelists, and bundle KaTeX CSS in renderer styles.

**Tech Stack:** `katex`, `marked-katex-extension`, `marked`, `dompurify`, `vitest`

## Global Constraints

- Must not break existing markdown parsing or link/path processing (`isPathLike`, file links).
- Must sanitize HTML safely through `DOMPurify` without stripping KaTeX MathML elements or attributes.
- `throwOnError: false` must be enabled in KaTeX so bad LaTeX syntax renders gracefully without throwing exceptions.
- Do not add `Co-Authored-By` trailers in git commit messages.

---

### Task 1: Add KaTeX Dependencies and CSS Styles

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/src/styles.css:1-10`

**Interfaces:**
- Consumes: npm packages `katex`, `marked-katex-extension`, `@types/katex`
- Produces: KaTeX styles imported into renderer process

- [ ] **Step 1: Install KaTeX packages**

Run: `npm install katex marked-katex-extension && npm install -D @types/katex`

- [ ] **Step 2: Import KaTeX CSS in renderer styles**

Modify `src/renderer/src/styles.css` at the top:
```css
@import 'katex/dist/katex.min.css';
```

- [ ] **Step 3: Verify build and typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/styles.css
git commit -m "feat(markdown): add katex dependencies and css styles"
```

---

### Task 2: Integrate KaTeX into `MarkdownText` and Configure DOMPurify

**Files:**
- Modify: `src/renderer/src/components/chat/MarkdownText.tsx`
- Create: `tests/unit/markdown-katex.test.ts`

**Interfaces:**
- Consumes: `marked`, `marked-katex-extension`, `DOMPurify`
- Produces: Rendered KaTeX HTML with safe MathML elements in `MarkdownText`

- [ ] **Step 1: Write failing unit test**

Create `tests/unit/markdown-katex.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'

marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

const KETEX_DOMPURIFY_CONFIG = {
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
    const sanitized = DOMPurify.sanitize(raw, KETEX_DOMPURIFY_CONFIG)
    expect(sanitized).toContain('katex')
    expect(sanitized).toContain('E = mc^2')
  })

  it('renders block display math $$\\frac{a}{b}$$', () => {
    const raw = marked.parse('$$\\frac{a}{b}$$', { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, KETEX_DOMPURIFY_CONFIG)
    expect(sanitized).toContain('katex-display')
    expect(sanitized).toContain('mfrac')
  })

  it('does not format standalone currency like $100 as math', () => {
    const raw = marked.parse('The price is $100 for this item.', { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, KETEX_DOMPURIFY_CONFIG)
    expect(sanitized).not.toContain('katex')
    expect(sanitized).toContain('$100')
  })

  it('handles invalid math gracefully without throwing', () => {
    expect(() => {
      const raw = marked.parse('$\\invalidMacro{123$', { async: false }) as string
      DOMPurify.sanitize(raw, KETEX_DOMPURIFY_CONFIG)
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify initial status**

Run: `npx vitest run tests/unit/markdown-katex.test.ts`

- [ ] **Step 3: Update `MarkdownText.tsx` to support KaTeX and DOMPurify MathML tags**

Modify `src/renderer/src/components/chat/MarkdownText.tsx`:
```typescript
import { useMemo } from 'react'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'
import { normalizeMarkdownTables } from './markdownTable'
import { isPathLike } from './markdownPaths'

interface Props {
  text: string
  onOpenFile?: (path: string) => void
}

marked.setOptions({ gfm: true, breaks: true })
marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

const DOMPURIFY_CONFIG = {
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

export default function MarkdownText({ text, onOpenFile }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(normalizeMarkdownTables(text), { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, DOMPURIFY_CONFIG)
    // Post-process instead of a custom marked renderer: keeps the default
    // renderer for link text/escaping and avoids global marked.use mutations.
    const doc = new DOMParser().parseFromString(sanitized, 'text/html')
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#') || /^(https?|mailto):/i.test(href)) return
      if (isPathLike(href)) {
        a.setAttribute('href', '#')
        a.setAttribute('data-file', href)
        a.classList.add('chat-file-link')
      }
    })
    doc.querySelectorAll('code').forEach(code => {
      // Code blocks (fenced/indented) are never file links — only inline code
      // can reference a path. Without this a long block whose last line ends
      // in .ext gets underlined like a link.
      if (code.closest('pre')) return
      const t = code.textContent?.trim() ?? ''
      if (isPathLike(t)) {
        code.setAttribute('data-file', t)
        code.classList.add('chat-file-link')
      }
    })
    return doc.body.innerHTML
  }, [text])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onOpenFile) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')
    if (!el) return
    const p = el.getAttribute('data-file')
    if (p) {
      e.preventDefault()
      onOpenFile(p)
    }
  }

  return (
    <div className="chat-text chat-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/markdown-katex.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: All tests pass cleanly.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/MarkdownText.tsx tests/unit/markdown-katex.test.ts
git commit -m "feat(markdown): enable KaTeX math rendering and DOMPurify MathML support"
```
