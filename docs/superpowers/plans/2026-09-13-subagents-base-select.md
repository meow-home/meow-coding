# Sub-agents Tab BaseSelect Grid Layout & Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update sub-agent provider and model field layout in `AgentsTab.tsx` and `styles.css` to use a 2-column grid structure (`1fr 1fr`), enforce text truncation (`...`) on long trigger labels, and ensure dropdown menu items occupy 100% full width of the dropdown menu container.

**Architecture:** Configure `.submodel-fields` as a CSS Grid container with 2 equal columns (`1fr 1fr`). Apply `width: 100%; box-sizing: border-box;` to `.select-menu .menu-item`.

**Tech Stack:** React 19, TypeScript, CSS Grid, `BaseSelect`.

---

### Task 1: Update Grid Layout, Truncation, and Menu Item Full Width in styles.css & AgentsTab.tsx

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/settings/AgentsTab.tsx`

- [ ] **Step 1: Update styles.css with Grid & 100% Menu Item Width**

In `src/renderer/src/styles.css`, update `.submodel-fields` and `.select-menu .menu-item`:

```css
.submodel-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.666667rem; width: 100%; }
.submodel-fields .input { flex: 1; min-width: 0; }
.submodel-fields .base-dropdown-container { min-width: 0; display: flex; width: 100%; }
.submodel-fields .dropdown-trigger { width: 100%; justify-content: space-between; gap: 0.5rem; min-width: 0; overflow: hidden; }
.select-value-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; text-align: left; }
.select-menu .menu-item { width: 100%; box-sizing: border-box; }
```

- [ ] **Step 2: Update SingleSelect in AgentsTab.tsx to pass title to BaseSelect**

In `src/renderer/src/components/settings/AgentsTab.tsx`, update `SingleSelect` to pass `title={triggerLabel}` to `BaseSelect`:

```tsx
function SingleSelect({ value, placeholder, disabled = false, options, onChange }: SingleSelectProps) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(o => o.value === value)
  const triggerLabel = selectedOption ? selectedOption.label : placeholder

  if (disabled) {
    return (
      <button className="dropdown-trigger select-trigger" disabled type="button" title={placeholder}>
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
      title={triggerLabel}
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

- [ ] **Step 3: Run Typecheck and Tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/settings/AgentsTab.tsx
git commit -m "refactor(ui): update sub-agents fields to 2-column grid and full-width dropdown items"
```
