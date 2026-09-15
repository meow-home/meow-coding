# Subagent Overlay Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the sub-agent detail popup (`BaseModal`) in `ChatPanel` into a docked overlay pane (`SubagentOverlay`) positioned side-by-side with chat, supporting width resizing, maximize toggle, and Escape/close handlers matching the design of `FilesOverlay`.

**Architecture:** Create a dedicated `SubagentOverlay.tsx` component and `.subagent-overlay` CSS rules. Replace the `<BaseModal className="subagent-live">` rendering logic in `ChatPanel.tsx` with `<SubagentOverlay>` docked on the right side of the chat view container.

**Tech Stack:** React 19, TypeScript, CSS, Lucide icons (`Bot`, `Maximize2`, `Minimize2`, `X`), Vitest.

## Global Constraints

- Source code, UI labels, and comments must be in English.
- No `Co-Authored-By` trailer in git commit messages.
- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: CSS Styling & Tests for Subagent Overlay

**Files:**
- Modify: `src/renderer/src/styles.css`
- Test: `tests/unit/subagent-overlay-styles.test.ts`

**Interfaces:**
- Consumes: CSS variables (`--bg-chat`, `--hairline`, `--radius-lg`, `--shadow-panel`)
- Produces: CSS classes `.subagent-overlay`, `.subagent-overlay.docked`, `.subagent-overlay.full`, `.subagent-resizer`

- [ ] **Step 1: Write the failing unit test for subagent overlay CSS**

Create `tests/unit/subagent-overlay-styles.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function stylesheetRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(s => s.trim()),
    body
  }))
}

function ruleBody(selector: string): string {
  const rule = stylesheetRules().find(r => r.selectors.includes(selector))
  expect(rule, `styles.css has no ${selector} rule`).toBeDefined()
  return rule!.body
}

describe('Subagent Overlay CSS', () => {
  it('defines .subagent-overlay rule with box-shadow: var(--shadow-panel)', () => {
    const body = ruleBody('.subagent-overlay')
    expect(body).toContain('box-shadow:')
    expect(body).toContain('var(--shadow-panel)')
  })

  it('defines .subagent-overlay.full rule', () => {
    const body = ruleBody('.subagent-overlay.full')
    expect(body).toContain('position: absolute')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/subagent-overlay-styles.test.ts`  
Expected: FAIL with "styles.css has no .subagent-overlay rule"

- [ ] **Step 3: Add CSS rules to `src/renderer/src/styles.css`**

Add near line 3430 or 4300:

```css
/* Subagent overlay — docked on the right side of the chat pane */
.subagent-overlay {
  flex: 0 0 auto; position: relative; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg-chat); border: 0.083333rem solid var(--hairline);
  border-radius: var(--radius-lg); animation: meow-rise 180ms ease-out both;
  box-shadow: var(--shadow-panel);
}
.subagent-overlay.docked { margin: 0.333333rem 0.333333rem 0.333333rem 0; }
.subagent-resizer {
  position: absolute; left: -0.25rem; top: 0; bottom: 0; width: 0.583333rem;
  cursor: col-resize; z-index: 5;
}
.subagent-resizer:hover { background: var(--accent-dim); }
.subagent-overlay.full {
  position: absolute; z-index: 40;
  top: 0.333333rem; left: 0.333333rem; right: 0.333333rem; bottom: 0.333333rem;
  box-shadow: var(--shadow-panel), 0 0 0 0.333333rem var(--bg-chat);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/subagent-overlay-styles.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles.css tests/unit/subagent-overlay-styles.test.ts
git commit -m "feat: add subagent overlay CSS rules and unit test"
```

---

### Task 2: Create SubagentOverlay Component

**Files:**
- Create: `src/renderer/src/components/chat/SubagentOverlay.tsx`

**Interfaces:**
- Consumes: Subagent feed item parameters (`taskId`, `subagentType`, `background`, `state`, `tools`, `text`, `result`), `full`, `width`, `onWidthChange`, `onToggleFull`, `onClose`
- Produces: `SubagentOverlay` React component

- [ ] **Step 1: Implement `SubagentOverlay.tsx`**

Create `src/renderer/src/components/chat/SubagentOverlay.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react'
import { Bot, Maximize2, Minimize2, X } from 'lucide-react'

export const SUBAGENT_MIN_WIDTH = 320
export const SUBAGENT_MAX_WIDTH = 900
export const SUBAGENT_DEFAULT_WIDTH = 420

export interface SubagentOverlayItem {
  taskId: string
  subagentType?: string
  background?: boolean
  state: 'running' | 'completed' | 'error'
  tools: string[]
  text?: string
  result?: string
}

interface Props {
  item: SubagentOverlayItem
  full: boolean
  width: number
  onWidthChange: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
}

export default function SubagentOverlay({ item, full, width, onWidthChange, onToggleFull, onClose }: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const textEndRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(SUBAGENT_MAX_WIDTH, Math.max(SUBAGENT_MIN_WIDTH, dragRef.current.startWidth + delta))
      onWidthChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (item.state === 'running') {
      textEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [item.text, item.state])

  return (
    <section
      className={`subagent-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : { width }}
      aria-label="Sub-agent Details"
    >
      {!full && <div className="subagent-resizer" onMouseDown={startDrag} title="Drag to resize" />}
      <div className="files-head">
        <div className="files-head-title">
          <Bot size={16} aria-hidden="true" />
          <span>sub-agent{item.subagentType ? ` (${item.subagentType})` : ''}</span>
          {item.background && <span className="subagent-bg">background</span>}
        </div>
        <div className="files-head-actions">
          <button
            className="pane-header-action"
            title={full ? 'Restore panel size' : 'Expand panel'}
            onClick={onToggleFull}
          >
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="pane-header-action"
            title="Close panel (Esc)"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="files-body" style={{ flexDirection: 'column', padding: '0.833333rem', overflowY: 'auto' }}>
        <div className="subagent-live-state">
          <span className={`subagent-state state-${item.state}`}>{item.state}</span>
          {item.tools.length > 0 && (
            <div className="subagent-tools">
              {item.tools.map((t, idx) => <code key={idx}>{t}</code>)}
            </div>
          )}
        </div>
        <div className="subagent-live-text">
          {item.text || (item.state === 'running' ? '…' : '')}
          <div ref={textEndRef} />
        </div>
        {item.result && <div className="subagent-live-result">{item.result}</div>}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Run typecheck to verify component compiles**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/chat/SubagentOverlay.tsx
git commit -m "feat: create SubagentOverlay component"
```

---

### Task 3: Integrate SubagentOverlay into ChatPanel

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx:202-210,856-875`

**Interfaces:**
- Consumes: `SubagentOverlay` from `./SubagentOverlay`
- Produces: Chat view container with docked `SubagentOverlay` side-by-side

- [ ] **Step 1: Update state and localStorage in `ChatPanel.tsx`**

Import `SubagentOverlay` and constants at top of `ChatPanel.tsx`:
```tsx
import SubagentOverlay, { SUBAGENT_DEFAULT_WIDTH } from './SubagentOverlay'
```

Add `subagentFull` and `subagentWidth` state inside `ChatPanel`:
```tsx
const [subagentFull, setSubagentFull] = useState(false)
const [subagentWidth, setSubagentWidth] = useState<number>(() => {
  const saved = localStorage.getItem('meow.subagent.width')
  if (!saved) return SUBAGENT_DEFAULT_WIDTH
  const n = parseInt(saved, 10)
  return Number.isNaN(n) ? SUBAGENT_DEFAULT_WIDTH : n
})

const handleSubagentWidthChange = useCallback((w: number) => {
  setSubagentWidth(w)
  localStorage.setItem('meow.subagent.width', String(w))
}, [])
```

- [ ] **Step 2: Replace `BaseModal` with `SubagentOverlay` inside `ChatPanel.tsx`**

In the layout structure of `ChatPanel.tsx`, place the `<SubagentOverlay>` alongside the main chat container or at the pane end:

Replace the `<BaseModal className="subagent-live">` block with:

```tsx
{liveTaskId && (() => {
  const live = items.find(i => i.kind === 'subagent' && i.taskId === liveTaskId) as FeedItem & { kind: 'subagent' } | undefined
  if (!live) return null
  return (
    <SubagentOverlay
      item={live}
      full={subagentFull}
      width={subagentWidth}
      onWidthChange={handleSubagentWidthChange}
      onToggleFull={() => setSubagentFull(v => !v)}
      onClose={() => setLiveTaskId(null)}
    />
  )
})()}
```

Ensure the layout container wrapping the messages/input area and `SubagentOverlay` uses `flex-direction: row; display: flex; flex: 1; min-height: 0; position: relative;`.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx
git commit -m "feat: integrate SubagentOverlay side-by-side into ChatPanel"
```

---

### Task 4: Final Verification

**Files:**
- All modified and created files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 2: Run all unit & integration tests**

Run: `npm test`  
Expected: PASS

- [ ] **Step 3: Verify git status**

Run: `git status`  
Expected: clean working directory
