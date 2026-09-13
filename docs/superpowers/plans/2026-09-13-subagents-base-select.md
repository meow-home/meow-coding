# Sub-agents Tab BaseSelect Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align sub-agent provider and model select dropdowns in `AgentsTab.tsx` and `styles.css` with standard `BaseSelect` layout and `.menu-item` styling.

**Architecture:** Use standard `.menu-item`, `.menu-item-label`, and `.menu-item-check` classes inside `SingleSelect` in `AgentsTab.tsx`. Add `.submodel-fields .base-dropdown-container` flex rules in `styles.css` so that dropdowns stretch 50/50 evenly across rows.

**Tech Stack:** React 19, TypeScript, CSS Variables, `BaseSelect`.

---

### Task 1: Update SingleSelect in AgentsTab.tsx and submodel-fields styling in styles.css

**Files:**
- Modify: `src/renderer/src/components/settings/AgentsTab.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update SingleSelect in AgentsTab.tsx**

Update `SingleSelect` in `src/renderer/src/components/settings/AgentsTab.tsx` to use standard `.menu-item`, `.menu-item-label`, and `.menu-item-check` class names:

```tsx
function SingleSelect({ value, placeholder, disabled = false, options, onChange }: SingleSelectProps) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(o => o.value === value)
  const triggerLabel = selectedOption ? selectedOption.label : placeholder

  if (disabled) {
    return (
      <button className="dropdown-trigger select-trigger" disabled type="button">
        <span className="select-value-label">{placeholder}</span>
      </button>
    )
  }

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      align="left"
      trigger={<span className="select-value-label">{triggerLabel}</span>}
    >
      <div>
        {options.map(opt => {
          const isSelected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`menu-item ${isSelected ? 'active' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              <span className="menu-item-label">{opt.label}</span>
              <span className="menu-item-check">
                {isSelected && <Check size={14} aria-hidden="true" />}
              </span>
            </button>
          )
        })}
      </div>
    </BaseSelect>
  )
}
```

- [ ] **Step 2: Add flex layout rules for submodel-fields in styles.css**

In `src/renderer/src/styles.css`, update `.submodel-fields` section around line 1276:

```css
.submodel-fields { display: flex; flex-wrap: wrap; gap: 0.666667rem; }
.submodel-fields .input { flex: 1; min-width: 0; }
.submodel-fields .base-dropdown-container { flex: 1; min-width: 0; display: flex; }
.submodel-fields .dropdown-trigger { width: 100%; justify-content: space-between; }
```

- [ ] **Step 3: Run Typecheck and Tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/AgentsTab.tsx src/renderer/src/styles.css
git commit -m "refactor(ui): align sub-agents BaseSelect layout and menu item styles"
```
