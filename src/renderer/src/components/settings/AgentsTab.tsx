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
