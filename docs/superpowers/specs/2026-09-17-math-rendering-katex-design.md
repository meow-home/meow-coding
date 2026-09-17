# KaTeX Math Rendering Design Specification

## 1. Goal & Context
Currently, `MarkdownText` renders markdown via `marked` and sanitizes HTML via `DOMPurify`, but mathematical expressions written in LaTeX / KaTeX syntax (such as `$E = mc^2$` or `$$\frac{a}{b}$$`) are displayed as plain unformatted text or raw markdown.

This design introduces native KaTeX rendering support across all UI surfaces using `MarkdownText` (chat feed messages, subagent overlay, file preview, update dialog).

## 2. Dependencies & Assets
- **Dependencies**:
  - `katex` (^0.16.x)
  - `marked-katex-extension` (^5.x.x)
  - `@types/katex` (dev dependency)
- **Styles**:
  - Import `katex/dist/katex.min.css` into `src/renderer/src/styles.css` (or entry point) so KaTeX math symbols, fonts, and inline/block layouts render correctly without requiring external CDN requests.

## 3. Component Architecture & Sanitization
### `MarkdownText.tsx`
- **Marked Extension Registration**:
  - Integrate `marked-katex-extension` into `marked` using `marked.use(markedKatex({ throwOnError: false, nonStandard: true }))`.
  - Supported math delimiters:
    - Inline math: `$...$` and `\(...\)`
    - Display/Block math: `$$...$$` and `\[...\]`

- **DOMPurify Configuration**:
  - KaTeX outputs HTML markup containing KaTeX CSS classes (`.katex`, `.katex-display`, `.katex-html`, etc.) and standard MathML element tags (`<math>`, `<semantics>`, `<mrow>`, `<annotation>`, `<mtext>`, `<mo>`, `<mn>`, `<mspace>`, `<mtable>`, `<mtr>`, `<mtd>`, etc.).
  - Update `DOMPurify.sanitize()` options:
    - Pass `ADD_TAGS` for MathML tags (`math`, `semantics`, `mrow`, `annotation`, `annotation-xml`, `mtext`, `mo`, `mn`, `ms`, `mspace`, `mtable`, `mtr`, `mtd`, etc.) and SVG tags/attributes used by KaTeX.
    - Pass `ADD_ATTR` for required attributes (`aria-hidden`, `tabindex`, `style`, `encoding`, `mathvariant`).

## 4. Error Handling & Edge Cases
- **Syntax Errors in Math**:
  - Setting `throwOnError: false` ensures malformed LaTeX equations do not throw uncaught React exceptions or break chat rendering. Instead, KaTeX renders raw expression text styled in red error text.
- **Currency Symbols ($)**:
  - Currency values such as `$10` or `$100` are handled by `marked-katex-extension` heuristics (which avoid matching single `$` adjacent to spaces or numbers unless closed cleanly).

## 5. Verification
- **Unit Tests**:
  - Create/update unit tests in `src/renderer/src/components/chat/__tests__/MarkdownText.test.tsx` (or Vitest suite).
  - Verify inline math rendering (`$x^2$`).
  - Verify block math rendering (`$$\int_0^\infty f(x) dx$$`).
  - Verify currency strings remain plain text.
  - Verify DOMPurify sanitization retains KaTeX elements safely without XSS risk.
- **Build & Typecheck**:
  - `npm run typecheck`
  - `npm test`
