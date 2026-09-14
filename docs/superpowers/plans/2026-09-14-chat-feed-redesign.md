# Chat Feed UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Chat Feed UI into a seamless continuous flow (Ultra-Clean Frameless Flow) with compact micro-bar tool cards while strictly maintaining existing typography and font size settings.

**Architecture:** Update CSS styles in `src/renderer/src/styles.css` to transform user message bubbles, assistant message containers, reasoning blocks, and feed layout, while updating `src/renderer/src/components/chat/ToolCallCard.tsx` to render a compact micro-bar design.

**Tech Stack:** React 19, TypeScript, Lucide React icons, CSS variables.

## Global Constraints
- Preserve all existing font family rules (`var(--font-ui)`, `var(--font-mono)`, `var(--font-display)`) verbatim.
- Preserve all existing font size rules (`var(--fs-xs)`, `var(--fs-sm)`, `var(--fs-md)`, `var(--fs-base)`, `var(--fs-lg)`) verbatim.
- Ensure light and dark mode compatibility using existing CSS design tokens (`var(--bg-chat)`, `var(--bg-panel)`, `var(--bg-hover)`, `var(--hairline)`, `var(--accent)`).

---

### Task 1: Redesign ToolCallCard Component to Micro-Bar Layout

**Files:**
- Modify: `src/renderer/src/components/chat/ToolCallCard.tsx`
- Test: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `call: ToolCallData` prop
- Produces: React element rendering compact micro-bar tool call with badge, file/command summary, and status indicator

- [ ] **Step 1: Update ToolCallCard component structure**

Update `src/renderer/src/components/chat/ToolCallCard.tsx` to render a micro-bar header with action badge, summary text, status icon, and collapsible body.

```tsx
import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import DiffView from './DiffView'

interface Props {
  call: ToolCallData
}

function describeInput(call: ToolCallData): string {
  const input = call.input ?? {}
  const first = (keys: string[]) => {
    for (const k of keys) {
      const v = input[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  switch (call.tool) {
    case 'edit': case 'apply-patch': case 'write': case 'read':
      return first(['file_path', 'path'])
    case 'bash': case 'terminal': case 'cmd': case 'sh':
      return first(['command', 'cmd'])
    case 'websearch': case 'webfetch':
      return first(['query', 'url'])
    case 'glob': case 'grep': case 'ls': case 'dir':
      return first(['pattern', 'path'])
    default: {
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
  }
}

export default memo(function ToolCallCard({ call }: Props) {
  const pending = call.permission === 'pending'
  const input = call.input ?? {}
  const editDiff = call.tool === 'edit'
    && typeof input.old_string === 'string'
    && typeof input.new_string === 'string'
  const patch = call.tool === 'apply-patch' && typeof input.patch === 'string'
    ? input.patch
    : null

  const statusClass = pending
    ? 'status-running'
    : call.permission === 'denied'
      ? 'status-err'
      : 'status-ok'

  return (
    <details className={`tool-call ${statusClass}`} open={pending}>
      <summary className="tool-call-header">
        <ChevronRight className="tool-call-chevron" />
        <span className={`tool-call-badge tool-call-badge-${call.tool}`}>{call.tool}</span>
        <span className="tool-call-summary" title={describeInput(call)}>{describeInput(call)}</span>
        {pending && <span className="tool-call-running">running…</span>}
        {!pending && (
          <span className={`tool-call-status ${call.permission === 'denied' ? 'err' : 'ok'}`}>
            {call.permission === 'denied' ? '✗' : '✓'}
          </span>
        )}
      </summary>
      <div className="tool-call-body">
        {patch !== null ? (
          <pre className="tool-call-input tool-call-diff">{patch}</pre>
        ) : editDiff ? (
          <DiffView oldText={input.old_string as string} newText={input.new_string as string} />
        ) : (
          <pre className="tool-call-input">{JSON.stringify(input, null, 2)}</pre>
        )}
        {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
        {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
      </div>
    </details>
  )
})
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS with 0 errors

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/components/chat/ToolCallCard.tsx
git commit -m "feat(ui): update ToolCallCard structure for compact micro-bar design"
```

---

### Task 2: Update Chat Feed CSS Styles for Ultra-Clean Frameless Flow

**Files:**
- Modify: `src/renderer/src/styles.css`
- Test: `npm run typecheck && npm test`

**Interfaces:**
- Consumes: Existing CSS classes `.chat-feed`, `.chat-msg`, `.chat-text`, `.tool-call`, `.chat-reasoning`
- Produces: Clean frameless visual presentation of messages and compact micro-bars in chat feed

- [ ] **Step 1: Update CSS rules in `src/renderer/src/styles.css`**

Replace/update the `.chat-text`, `.chat-msg`, `.tool-call`, and `.chat-reasoning` sections in `src/renderer/src/styles.css`:

1. Update `.chat-msg.user` and `.chat-msg.assistant` styles:
   - User message: soft pill background with subtle accent tint, rounded borders, aligned right.
   - Assistant message: transparent background, frameless flow, alignment left.

2. Update `.tool-call` styles:
   - Compact height (~28px-32px when collapsed).
   - Left accent status hairline (`border-left: 0.25rem solid ...`).
   - Styled `.tool-call-badge` pill for tool name.
   - Truncated `.tool-call-summary` text.
   - Collapsible body container `.tool-call-body` with soft background padding.

3. Update `.chat-reasoning` styles:
   - Borderless left hairline accordion style.

- [ ] **Step 2: Run typecheck and unit tests to verify no regressions**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): apply Ultra-Clean Frameless Flow and micro-bar CSS for chat feed"
```

---

### Task 3: Verification & Documentation Sync

**Files:**
- Modify: `src/renderer/src/components/chat/AGENTS.md`
- Test: `npm run typecheck && npm test`

- [ ] **Step 1: Update `src/renderer/src/components/chat/AGENTS.md`**

Update `AGENTS.md` in `src/renderer/src/components/chat/` to reflect the updated `ToolCallCard` micro-bar layout and frameless chat feed styling.

- [ ] **Step 2: Run full verification suite**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit documentation update**

```bash
git add src/renderer/src/components/chat/AGENTS.md
git commit -m "docs: sync AGENTS.md for chat feed redesign"
```
