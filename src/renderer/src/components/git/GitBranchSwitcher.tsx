import { useState, useMemo } from 'react'
import { Check, ChevronDown, GitBranch, Plus, Search } from 'lucide-react'
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
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')

  const filteredBranches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return branches
    return branches.filter(b => b.name.toLowerCase().includes(q))
  }, [branches, filter])

  const locals = useMemo(() => filteredBranches.filter(b => !b.isRemote), [filteredBranches])
  const remotes = useMemo(() => filteredBranches.filter(b => b.isRemote), [filteredBranches])

  const createBranch = async () => {
    const name = newName.trim()
    if (!name || !current) return
    const res = await window.api.gitCreateBranch(projectPath, name, current)
    if (!res.ok) {
      onError(res.error, res.command)
      return
    }
    setNewName('')
    setFilter('')
    setOpen(false)
    onCreated()
    onSwitch(name)
  }

  return (
    <div className="git-branch-wrap">
      <BaseDropdown
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setFilter('')
            setNewName('')
          }
        }}
        placement="bottom-start"
        menuClassName="git-branch-dropdown"
        trigger={(
          <button
            className="git-branch-current"
            disabled={busy}
            title="Switch branch"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <GitBranch size={14} className="git-branch-icon" aria-hidden="true" />
            <span className="git-branch-name">{current ?? '(detached)'}</span>
            <ChevronDown size={13} className="dropdown-caret" aria-hidden="true" />
          </button>
        )}
      >
        <div className="git-branch-search">
          <Search size={13} className="git-branch-search-icon" aria-hidden="true" />
          <input
            className="git-branch-search-input"
            placeholder="Filter branches..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className="git-branch-list-container">
          <div className="git-branch-section">Local Branches ({locals.length})</div>
          {locals.length === 0 && <div className="git-branch-empty">No matching local branches</div>}
          {locals.map(b => (
            <button
              key={b.name}
              className={`git-branch-item ${b.name === current ? 'active' : ''}`}
              disabled={busy}
              onClick={() => { setOpen(false); onSwitch(b.name) }}
            >
              <GitBranch size={13} className="git-branch-item-icon" aria-hidden="true" />
              <span className="menu-item-label">{b.name}</span>
              <span className="menu-item-check">
                {b.name === current && <Check size={14} aria-hidden="true" />}
              </span>
            </button>
          ))}

          <div className="git-branch-section">Remote Branches ({remotes.length})</div>
          {remotes.length === 0 && <div className="git-branch-empty">No matching remote branches</div>}
          {remotes.map(b => (
            <button
              key={b.name}
              className="git-branch-item"
              disabled={busy}
              onClick={() => { setOpen(false); onSwitch(b.name) }}
            >
              <GitBranch size={13} className="git-branch-item-icon remote" aria-hidden="true" />
              <span className="menu-item-label">{b.name}</span>
              <span className="menu-item-check" />
            </button>
          ))}
        </div>

        <div className="git-branch-create">
          <input
            className="input git-branch-create-input"
            placeholder={`New branch from ${current ?? 'HEAD'}`}
            value={newName}
            disabled={busy}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void createBranch()
            }}
          />
          <button
            className="btn small git-branch-create-btn"
            disabled={busy || !newName.trim()}
            onClick={() => void createBranch()}
          >
            <Plus size={13} aria-hidden="true" />
            <span>Create</span>
          </button>
        </div>
      </BaseDropdown>
    </div>
  )
}
