# Sub-agents Tab BaseSelect Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor provider and model select dropdowns in `AgentsTab.tsx` to use the `BaseSelect` common component.

**Architecture:** Create an internal helper component `SingleSelect` inside `AgentsTab.tsx` built on top of `BaseSelect` and use it for both Provider and Model selection per subagent role.

**Tech Stack:** React 19, TypeScript, Lucide React (`ChevronDown`, `Check`), `BaseSelect`.

---

### Task 1: Refactor AgentsTab.tsx to use BaseSelect

**Files:**
- Modify: `src/renderer/src/components/settings/AgentsTab.tsx`

- [ ] **Step 1: Update AgentsTab.tsx implementation**

Replace native `<select>` controls in `AgentsTab.tsx` with a `SingleSelect` helper component wrapping `BaseSelect`.

```tsx
import { useState } from 'react'
import { Check } from 'lucide-react'
import type { AgentSettings, MeowSettings, ModelRef, SubagentType } from '@shared/types'
import BaseSelect from '../common/BaseSelect'

const SUBMODEL_ROLES = ['research', 'general', 'reviewer'] as const

interface SingleSelectOption {
  value: string
  label: string
}

interface SingleSelectProps {
  value: string
  placeholder: string
  disabled?: boolean
  options: SingleSelectOption[]
  onChange: (value: string) => void
}

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
      <div className="select-options-list">
        {options.map(opt => {
          const isSelected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`dropdown-item select-item ${isSelected ? 'active' : ''}`}
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

interface Props {
  agents: AgentSettings[]
  providers: MeowSettings['providers']
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
  onChangeAgents: (agents: AgentSettings[]) => void
  onChangeSubagentModels: (models?: Partial<Record<SubagentType, ModelRef>>) => void
}

export default function AgentsTab({ providers, subagentModels, onChangeSubagentModels }: Props) {
  const setRole = (role: SubagentType, ref: ModelRef | undefined) => {
    const next = { ...(subagentModels ?? {}) }
    if (ref) next[role] = ref
    else delete next[role]
    onChangeSubagentModels(Object.keys(next).length > 0 ? next : undefined)
  }

  return (
    <div className="settings-tab agents-tab">
      <div>
        <p className="settings-hint">
          Models used when the main session dispatches sub-agents. Leave a role empty to inherit the main session model.
        </p>
        <div className="subagents-grid">
          {SUBMODEL_ROLES.map(role => {
            const ref = subagentModels?.[role]
            const provider = providers.find(p => p.id === ref?.provider)

            const providerOptions: SingleSelectOption[] = [
              { value: '', label: '(inherit main session model)' },
              ...providers.map(p => ({ value: p.id, label: p.id }))
            ]

            const modelOptions: SingleSelectOption[] = (provider?.models ?? []).map(m => ({
              value: m,
              label: m
            }))

            return (
              <div className="settings-row agents-row" key={role}>
                <div className="agents-row-head">
                  <span className="agent-name">{role}</span>
                  {ref && (
                    <button className="btn small" onClick={() => setRole(role, undefined)}>
                      Use main session model
                    </button>
                  )}
                </div>
                <div className="submodel-fields">
                  <SingleSelect
                    value={ref?.provider ?? ''}
                    placeholder="(inherit main session model)"
                    options={providerOptions}
                    onChange={pid =>
                      setRole(
                        role,
                        pid
                          ? {
                              provider: pid,
                              model: providers.find(p => p.id === pid)?.models[0] ?? ''
                            }
                          : undefined
                      )
                    }
                  />
                  <SingleSelect
                    value={ref?.model ?? ''}
                    placeholder={ref?.provider ? 'Select model...' : 'Select provider first'}
                    disabled={!ref?.provider}
                    options={modelOptions}
                    onChange={m => setRole(role, { provider: ref!.provider, model: m })}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck & Test**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/AgentsTab.tsx
git commit -m "refactor(ui): update sub-agents tab dropdowns to use BaseSelect"
```
