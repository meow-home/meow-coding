import { useState } from 'react'
import { Check, Search, Cpu, ShieldCheck, RotateCcw } from 'lucide-react'
import type { AgentSettings, MeowSettings, ModelRef, SubagentType } from '@shared/types'
import BaseSelect from '../common/BaseSelect'

const SUBAGENT_METADATA: Record<
  SubagentType,
  { name: string; icon: typeof Search; description: string; tag: string }
> = {
  research: {
    name: 'Research',
    icon: Search,
    description: 'Explores project requirements, reads documentation, and inspects codebase structure',
    tag: 'Search & Analysis'
  },
  general: {
    name: 'General',
    icon: Cpu,
    description: 'Executes coding tasks, refactoring, code generation, and multi-step actions',
    tag: 'Coding & Execution'
  },
  reviewer: {
    name: 'Reviewer',
    icon: ShieldCheck,
    description: 'Audits diffs, checks safety guidelines, and verifies task completion quality',
    tag: 'Audit & Safety'
  }
}

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
      <button className="dropdown-trigger select-trigger subagent-select-disabled" disabled type="button" title={placeholder}>
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
      className="subagent-select-container"
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
      <div className="subagents-header">
        <p className="settings-hint">
          Configure dedicated model overrides for parallel sub-agents. Unconfigured roles automatically inherit the active main session model.
        </p>
      </div>

      <div className="subagents-list">
        {(['research', 'general', 'reviewer'] as SubagentType[]).map(role => {
          const meta = SUBAGENT_METADATA[role]
          const ref = subagentModels?.[role]
          const isCustomized = Boolean(ref?.provider)
          const provider = providers.find(p => p.id === ref?.provider)

          const providerOptions: SingleSelectOption[] = [
            { value: '', label: '(Inherit main session model)' },
            ...providers.map(p => ({ value: p.id, label: p.id }))
          ]

          const modelOptions: SingleSelectOption[] = (provider?.models ?? []).map(m => ({
            value: m,
            label: m
          }))

          const RoleIcon = meta.icon

          return (
            <div className={`subagent-card ${isCustomized ? 'customized' : ''}`} key={role}>
              <div className="subagent-card-head">
                <div className="subagent-role-info">
                  <div className="subagent-icon-wrapper">
                    <RoleIcon size={16} aria-hidden="true" />
                  </div>
                  <div className="subagent-title-group">
                    <div className="subagent-title-row">
                      <span className="subagent-role-name">{meta.name}</span>
                      <span className="subagent-tag">{meta.tag}</span>
                    </div>
                    <span className="subagent-role-desc">{meta.description}</span>
                  </div>
                </div>

                <div className="subagent-status-actions">
                  <span className={`subagent-status-badge ${isCustomized ? 'badge-custom' : 'badge-inherit'}`}>
                    {isCustomized ? 'Custom Model' : 'Inherits Main'}
                  </span>
                  {isCustomized && (
                    <button
                      type="button"
                      className="btn icon-only ghost subagent-reset-btn"
                      title="Reset to main session model"
                      onClick={() => setRole(role, undefined)}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="subagent-card-body">
                <div className="subagent-field-group">
                  <label className="subagent-field-label">Provider</label>
                  <SingleSelect
                    value={ref?.provider ?? ''}
                    placeholder="(Inherit main session model)"
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
                </div>

                <div className="subagent-field-group">
                  <label className="subagent-field-label">Model</label>
                  <SingleSelect
                    value={ref?.model ?? ''}
                    placeholder={ref?.provider ? 'Select model...' : 'Select provider first'}
                    disabled={!ref?.provider}
                    options={modelOptions}
                    onChange={m => setRole(role, { provider: ref!.provider, model: m })}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
