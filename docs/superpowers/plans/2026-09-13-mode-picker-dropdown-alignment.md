# ModePicker Dropdown Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass `align="left"` to `<Dropdown>` inside `ModePicker.tsx` so the dropdown menu aligns with the left edge of the mode trigger button and expands towards the right.

**Architecture:** `ModePicker` wraps `Dropdown.tsx`. `Dropdown` supports an `align` prop (`'left' | 'right'`). Setting `align="left"` instructs `Dropdown` to position its portaled menu using `{ left: triggerRect.left }` instead of right-aligning it.

**Tech Stack:** React 19, TypeScript, Vitest.

## Global Constraints

- Follow existing codebase patterns.
- Do not introduce breaking changes to `Dropdown` or other pickers (`ModelPicker`, `VariantPicker`, `AddMenu`).

---

### Task 1: Update ModePicker dropdown alignment and verify

**Files:**
- Modify: `src/renderer/src/components/chat/ModePicker.tsx`

**Interfaces:**
- Consumes: `<Dropdown align="left" ...>` from `src/renderer/src/components/chat/Dropdown.tsx`
- Produces: Updated `ModePicker` component with left-aligned (right-expanding) dropdown menu.

- [ ] **Step 1: Update ModePicker.tsx to pass align="left" to Dropdown**

In `src/renderer/src/components/chat/ModePicker.tsx`, update the `<Dropdown>` JSX element to include `align="left"`:

```tsx
    <Dropdown
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — exit code 0.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS — all tests passing.

- [ ] **Step 4: Commit changes**

```bash
git add src/renderer/src/components/chat/ModePicker.tsx
git commit -m "fix(chat): align ModePicker dropdown to the left edge of the trigger"
```
