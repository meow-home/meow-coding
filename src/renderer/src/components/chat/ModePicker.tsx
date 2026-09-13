import { useState } from 'react'
import { Check } from 'lucide-react'
import type { AgentMode } from '@shared/types'
import Dropdown from './Dropdown'

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
      <div className="mode-list">
        {MODES.map(m => (
          <button
            key={m.value}
            className={`mode-item ${m.className} ${m.value === value ? 'active' : ''}`}
            onClick={() => { onChange(m.value); setOpen(false) }}
          >
            <span className="menu-item-label">{m.label}</span>
            <span className="menu-item-check">
              {m.value === value && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
    </Dropdown>
  )
}
