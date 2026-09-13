import { useState } from 'react'
import { Check, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import type { PermissionRule } from '@shared/types'
import BaseSelect from '../common/BaseSelect'

interface Props {
  permission: Record<string, PermissionRule>
  onChange: (permission: Record<string, PermissionRule>) => void
}

const DEFAULT_TOOLS = [
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'apply-patch',
  'todowrite',
  'question',
  'webfetch',
  'websearch',
  'bash',
  'skill',
  'git',
  'task',
  'revert'
]

const TOOL_METADATA: Record<string, { description: string }> = {
  read: { description: 'Read file contents from workspace' },
  write: { description: 'Create new files or overwrite existing files' },
  edit: { description: 'Modify specific content inside files' },
  glob: { description: 'Find files matching pattern paths' },
  grep: { description: 'Search codebase using regular expressions' },
  'apply-patch': { description: 'Apply unified diff patches to files' },
  todowrite: { description: 'Create and update session task checklist' },
  question: { description: 'Ask interactive questions with form options' },
  webfetch: { description: 'Fetch and parse text content from web URLs' },
  websearch: { description: 'Search web for documentation and answers' },
  bash: { description: 'Execute shell commands in terminal' },
  skill: { description: 'Load reusable subagent skill instructions' },
  git: { description: 'Execute git version control commands' },
  task: { description: 'Spawn background subagent execution tasks' },
  revert: { description: 'Undo session file changes' }
}

const PERMISSION_CONFIG: Record<
  PermissionRule,
  { label: string; hint: string; badgeClass: string; icon: typeof ShieldCheck }
> = {
  allow: { label: 'Allow', hint: 'Always run automatically', badgeClass: 'badge-allow', icon: ShieldCheck },
  ask: { label: 'Ask', hint: 'Prompt for confirmation', badgeClass: 'badge-ask', icon: ShieldAlert },
  deny: { label: 'Deny', hint: 'Block execution completely', badgeClass: 'badge-deny', icon: ShieldX }
}

interface PermissionRuleSelectProps {
  value: PermissionRule
  onChange: (rule: PermissionRule) => void
}

function PermissionRuleSelect({ value, onChange }: PermissionRuleSelectProps) {
  const [open, setOpen] = useState(false)
  const currentConfig = PERMISSION_CONFIG[value] ?? PERMISSION_CONFIG.ask

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      align="right"
      className="permission-select-container"
      menuClassName="permission-select-menu"
      trigger={
        <span className={`permission-badge ${currentConfig.badgeClass}`}>
          <currentConfig.icon size={13} aria-hidden="true" />
          <span className="permission-badge-label">{currentConfig.label}</span>
        </span>
      }
    >
      <div role="listbox">
        {(['allow', 'ask', 'deny'] as PermissionRule[]).map(rule => {
          const isSelected = rule === value
          const config = PERMISSION_CONFIG[rule]
          const Icon = config.icon

          return (
            <button
              key={rule}
              type="button"
              className={`menu-item permission-menu-item ${config.badgeClass} ${isSelected ? 'active' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onChange(rule)
                setOpen(false)
              }}
            >
              <span className="permission-menu-icon">
                <Icon size={14} aria-hidden="true" />
              </span>
              <div className="permission-menu-content">
                <span className="permission-menu-title">{config.label}</span>
                <span className="permission-menu-hint">{config.hint}</span>
              </div>
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

export default function PermissionsTab({ permission, onChange }: Props) {
  const setRule = (tool: string, rule: PermissionRule) => {
    onChange({ ...permission, [tool]: rule })
  }

  const allTools = Array.from(new Set([...DEFAULT_TOOLS, ...Object.keys(permission)]))

  const counts = allTools.reduce(
    (acc, tool) => {
      const rule = permission[tool] ?? 'ask'
      acc[rule] = (acc[rule] || 0) + 1
      return acc
    },
    { allow: 0, ask: 0, deny: 0 } as Record<PermissionRule, number>
  )

  return (
    <div className="settings-tab permissions-tab">
      <div className="permissions-header">
        <p className="settings-hint">
          Configure safety rules for agent tools. Plan mode is strictly read-only; these policies apply during build execution mode.
        </p>

        <div className="permissions-summary">
          <div className="summary-pill badge-allow">
            <ShieldCheck size={13} />
            <span>{counts.allow} Allowed</span>
          </div>
          <div className="summary-pill badge-ask">
            <ShieldAlert size={13} />
            <span>{counts.ask} Prompt</span>
          </div>
          <div className="summary-pill badge-deny">
            <ShieldX size={13} />
            <span>{counts.deny} Denied</span>
          </div>
        </div>
      </div>

      <div className="permission-list">
        {allTools.map(tool => {
          const rule = permission[tool] ?? 'ask'
          const meta = TOOL_METADATA[tool]

          return (
            <div className="permission-row" key={tool}>
              <div className="permission-info">
                <span className="permission-tool">{tool}</span>
                {meta && <span className="permission-desc">{meta.description}</span>}
              </div>
              <div className="permission-control">
                <PermissionRuleSelect value={rule} onChange={newRule => setRule(tool, newRule)} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
