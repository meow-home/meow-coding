import { useState } from 'react'
import { Check } from 'lucide-react'
import type { AgentMode } from '@shared/types'
import BaseSelect from '../common/BaseSelect'

interface ModePickerProps {
  value: AgentMode
  onChange: (m: AgentMode) => void
}

const MODES: { value: AgentMode; label: string; title: string; className: string }[] = [
  {
    value: 'build',
    label: 'Build',
    title: 'Build mode — full file edits & commands permitted',
    className: 'mode-build'
  },
  {
    value: 'plan',
    label: 'Plan',
    title: 'Plan mode — read-only, edits denied',
    className: 'mode-plan'
  }
]

export default function ModePicker({ value, onChange }: ModePickerProps) {
  const [open, setOpen] = useState(false)
  const active = MODES.find(m => m.value === value) ?? MODES[0]

  return (
    <BaseSelect
      open={open}
      onToggle={() => setOpen(v => !v)}
      onClose={() => setOpen(false)}
      title={`Mode: ${active.label} (${active.title})`}
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
            title={m.title}
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
