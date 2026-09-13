import { useState } from 'react'
import { Check, ChevronDown, GitBranch } from 'lucide-react'
import type { GitBranch as GitBranchType } from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'

interface Props {
  projectPath: string
  branches: GitBranchType[]
  current: string | null
  busy: boolean
  onSwitch: (branch: string) => void
  onCreated: () => void
  onError: (error: string, command: string) => void
}

export default function GitBranchSwitcher({ projectPath, branches, current, busy, onSwitch, onCreated, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const locals = branches.filter(b => !b.isRemote)
  const remotes = branches.filter(b => b.isRemote)

  const createBranch = async () => {
    const name = newName.trim()
    if (!name || !current) return
    const res = await window.api.gitCreateBranch(projectPath, name, current)
    if (!res.ok) {
      onError(res.error, res.command)
      return
    }
    setNewName('')
    setOpen(false)
    onCreated()
    onSwitch(name)
  }

  return (
    <div className="git-branch-wrap">
      <BaseDropdown
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        menuClassName="git-branch-dropdown"
        trigger={(
          <button
            className="git-branch-current"
            disabled={busy}
            onClick={() => setOpen(v => !v)}
            title="Switch branch"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <GitBranch size={14} aria-hidden="true" />
            <span>{current ?? '(detached)'}</span>
            <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
          </button>
        )}
      >
        <div className="git-branch-section">Local</div>
        {locals.map(b => (
          <button
            key={b.name}
            className={`git-branch-item ${b.name === current ? 'active' : ''}`}
            disabled={busy}
            onClick={() => { setOpen(false); onSwitch(b.name) }}
          >
            <span className="menu-item-label">{b.name}</span>
            <span className="menu-item-check">
              {b.name === current && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        ))}
        <div className="git-branch-section">Remote</div>
        {remotes.length === 0 && <div className="git-branch-empty">No remote branches</div>}
        {remotes.map(b => (
          <button
            key={b.name}
            className="git-branch-item"
            disabled={busy}
            onClick={() => { setOpen(false); onSwitch(b.name) }}
          >
            <span className="menu-item-label">{b.name}</span>
            <span className="menu-item-check" />
          </button>
        ))}
        <div className="git-branch-create">
          <input
            className="input"
            placeholder={`Create new branch from ${current ?? 'HEAD'}`}
            value={newName}
            disabled={busy}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void createBranch()
            }}
          />
          <button className="btn small" disabled={busy || !newName.trim()} onClick={() => void createBranch()}>
            Create
          </button>
        </div>
      </BaseDropdown>
    </div>
  )
}
