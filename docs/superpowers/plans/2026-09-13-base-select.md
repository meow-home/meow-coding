# BaseSelect Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a dedicated `BaseSelect` component for option selection controls (e.g., `ModePicker`, `VariantPicker`) to replace `BaseDropdown`/`Dropdown` usage in selectors while maintaining proper ARIA semantics and auto-positioning.

**Architecture:** `BaseSelect` acts as a selector-specific wrapper in `src/renderer/src/components/common/BaseSelect.tsx` using `BaseDropdown` under the hood for portal rendering and position calculation. `ModePicker` and `VariantPicker` are refactored to use `BaseSelect`.

**Tech Stack:** React 19, TypeScript, Vitest, Lucide React icons.

## Global Constraints

- Source code, UI labels, and comments are in English.
- No `Co-Authored-By` trailer in git commit messages.
- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Create `BaseSelect` Component and Unit Test

**Files:**
- Create: `src/renderer/src/components/common/BaseSelect.tsx`
- Create: `tests/unit/base-select.test.ts`
- Modify: `src/renderer/src/components/common/index.ts` (if barrel exports exist or export directly)

**Interfaces:**
```typescript
import type { ReactNode } from 'react'

export interface BaseSelectProps {
  trigger?: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  ariaLabel?: string
  menuClassName?: string
  align?: 'left' | 'right'
  children: ReactNode
}
```

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/base-select.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { renderToString } from 'react-dom/server'
import BaseSelect from '../../src/renderer/src/components/common/BaseSelect'

describe('BaseSelect', () => {
  test('renders trigger button with correct ARIA attributes when closed', () => {
    const html = renderToString(
      BaseSelect({
        open: false,
        onToggle: () => {},
        onClose: () => {},
        title: 'Select option',
        trigger: 'Build',
        children: 'Options'
      })
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Build')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/base-select.test.ts`
Expected: FAIL (Cannot find module `BaseSelect`)

- [ ] **Step 3: Implement `BaseSelect.tsx`**

Create `src/renderer/src/components/common/BaseSelect.tsx`:

```typescript
import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import BaseDropdown from './BaseDropdown'

export interface BaseSelectProps {
  trigger?: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  title?: string
  ariaLabel?: string
  menuClassName?: string
  align?: 'left' | 'right'
  children: ReactNode
}

export default function BaseSelect({
  trigger,
  open,
  onToggle,
  onClose,
  title,
  ariaLabel,
  menuClassName = '',
  align = 'right',
  children
}: BaseSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <BaseDropdown
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) {
          if (nextOpen) onToggle()
          else onClose()
        }
      }}
      placement={align === 'left' ? 'top-start' : 'top-end'}
      menuClassName={`dropdown-menu select-menu ${menuClassName}`.trim()}
      trigger={(
        <button
          ref={triggerRef}
          className="dropdown-trigger select-trigger"
          title={title}
          aria-label={ariaLabel ?? title}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {trigger}
          <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
        </button>
      )}
    >
      <div role="listbox">{children}</div>
    </BaseDropdown>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/base-select.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/common/BaseSelect.tsx tests/unit/base-select.test.ts
git commit -m "feat: add BaseSelect component for option selection controls"
```

---

### Task 2: Refactor `ModePicker` and `VariantPicker` to use `BaseSelect`

**Files:**
- Modify: `src/renderer/src/components/chat/ModePicker.tsx`
- Modify: `src/renderer/src/components/chat/VariantPicker.tsx`

- [ ] **Step 1: Refactor `ModePicker.tsx`**

Replace `import Dropdown from './Dropdown'` with `import BaseSelect from '../common/BaseSelect'` in `ModePicker.tsx`:

```typescript
import { useState } from 'react'
import { Check } from 'lucide-react'
import type { AgentMode } from '@shared/types'
import BaseSelect from '../common/BaseSelect'

interface ModePickerProps {
  value: AgentMode
  onChange: (m: AgentMode) => void
}

const MODES: { value: AgentMode; label: string; className: string }[] = [
  { value: 'build', label: 'Build', className: 'mode-build' },
  { value: 'plan', label: 'Plan', className: 'mode-plan' }
]

export default function ModePicker({ value, onChange }: ModePickerProps) {
  const [open, setOpen] = useState(false)
  const active = MODES.find(m => m.value === value) ?? MODES[0]

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      title="Mode"
      ariaLabel="Mode"
      menuClassName="mode-menu"
      align="left"
      trigger={
        <span className={`mode-label mode-${active.value}`}>{active.label}</span>
      }
    >
      <div className="mode-list">
        {MODES.map(m => (
          <button
            key={m.value}
            className={`mode-item ${m.className} ${m.value === value ? 'active' : ''}`}
            role="option"
            aria-selected={m.value === value}
            onClick={() => { onChange(m.value); setOpen(false) }}
          >
            <span className="menu-item-label">{m.label}</span>
            <span className="menu-item-check">
              {m.value === value && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
    </BaseSelect>
  )
}
```

- [ ] **Step 2: Refactor `VariantPicker.tsx`**

Replace `import Dropdown from './Dropdown'` with `import BaseSelect from '../common/BaseSelect'` in `VariantPicker.tsx`:

```typescript
import { useState } from 'react'
import { Check } from 'lucide-react'
import BaseSelect from '../common/BaseSelect'

interface VariantPickerProps {
  variants: string[]
  value: string // '' = Default
  onChange: (v: string) => void
}

export default function VariantPicker({ variants, value, onChange }: VariantPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      title="Model effort"
      menuClassName="variant-menu"
      trigger={
        <span className="variant-label">{value || 'Default'}</span>
      }
    >
      <div className="variant-list">
        <button
          className={`variant-item ${value === '' ? 'active' : ''}`}
          role="option"
          aria-selected={value === ''}
          onClick={() => { onChange(''); setOpen(false) }}
        >
          <span className="menu-item-label">Default</span>
          <span className="menu-item-check">
            {value === '' && <Check size={16} aria-hidden="true" />}
          </span>
        </button>
        {variants.map(v => (
          <button
            key={v}
            className={`variant-item ${value === v ? 'active' : ''}`}
            role="option"
            aria-selected={value === v}
            onClick={() => { onChange(v); setOpen(false) }}
          >
            <span className="menu-item-label">{v}</span>
            <span className="menu-item-check">
              {value === v && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
    </BaseSelect>
  )
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/chat/ModePicker.tsx src/renderer/src/components/chat/VariantPicker.tsx
git commit -m "refactor: use BaseSelect for ModePicker and VariantPicker"
```

---

### Task 3: Update `AGENTS.md` Files and Verify Solution

**Files:**
- Modify: `src/renderer/src/components/common/AGENTS.md`
- Modify: `src/renderer/src/components/chat/AGENTS.md`

- [ ] **Step 1: Update `src/renderer/src/components/common/AGENTS.md`**

Add `BaseSelect.tsx` to the key files table.

- [ ] **Step 2: Update `src/renderer/src/components/chat/AGENTS.md`**

Update descriptions for `ModePicker` and `VariantPicker` to mention `BaseSelect`.

- [ ] **Step 3: Run full verification**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/common/AGENTS.md src/renderer/src/components/chat/AGENTS.md
git commit -m "docs: update AGENTS.md for BaseSelect refactoring"
```
