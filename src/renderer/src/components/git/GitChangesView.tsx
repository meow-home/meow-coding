import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import type { GitFileChange, GitStatusDetail } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
  status: GitStatusDetail | null
}

interface OpenDiff {
  key: string
  staged: boolean
}

const STATUS: Record<GitFileChange['status'], { char: string; label: string; cls: string }> = {
  added: { char: 'A', label: 'Added', cls: 'add' },
  deleted: { char: 'D', label: 'Deleted', cls: 'del' },
  renamed: { char: 'R', label: 'Renamed', cls: 'mod' },
  untracked: { char: '?', label: 'Untracked', cls: 'unt' },
  typechange: { char: 'T', label: 'Type changed', cls: 'mod' },
  modified: { char: 'M', label: 'Modified', cls: 'mod' }
}

/**
 * The Changes tab: the working tree as two flat lists (staged, then unstaged).
 * A file expands in place to its diff; the same path shows up in both lists when
 * it has staged and unstaged edits, and each row shows the diff of its own side.
 */
export default function GitChangesView({ projectPath, status }: Props) {
  const [open, setOpen] = useState<OpenDiff | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadToken = useRef(0)

  // A refresh (or a new working tree) invalidates whatever row was expanded.
  useEffect(() => {
    loadToken.current++
    setOpen(null)
    setDiff(null)
    setError(null)
    setLoading(false)
  }, [status])

  const toggle = useCallback(async (file: GitFileChange, staged: boolean) => {
    const key = `${staged ? 'staged' : 'work'}:${file.path}`
    if (open?.key === key) {
      loadToken.current++
      setOpen(null)
      setDiff(null)
      setError(null)
      setLoading(false)
      return
    }
    const token = ++loadToken.current
    setOpen({ key, staged })
    setDiff(null)
    setError(null)
    setLoading(true)
    try {
      const raw = await window.api.gitGetDiff(projectPath, file.path, staged)
      if (token === loadToken.current) setDiff(raw)
    } catch (err) {
      if (token === loadToken.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (token === loadToken.current) setLoading(false)
    }
  }, [open, projectPath])

  const files = status?.files ?? []
  const staged = files.filter(f => f.staged)
  const unstaged = files.filter(f => f.unstaged)

  if (files.length === 0) {
    return (
      <div className="git-empty">
        <CheckCircle2 size={22} aria-hidden="true" />
        <div className="git-empty-title">Working tree clean</div>
        <div className="git-empty-sub">No uncommitted changes.</div>
      </div>
    )
  }

  const renderGroup = (label: string, group: GitFileChange[], stagedGroup: boolean) => (
    <>
      <div className="git-group-label">
        <span>{label}</span>
        <span className="git-group-count">{group.length}</span>
      </div>
      {group.map(file => {
        const badge = STATUS[file.status]
        const key = `${stagedGroup ? 'staged' : 'work'}:${file.path}`
        const isOpen = open?.key === key
        const name = file.path.split(/[\\/]/).pop() || file.path
        const dir = file.path.slice(0, file.path.length - name.length)
        return (
          <div key={key}>
            <button
              className={`git-file-row${isOpen ? ' open' : ''}`}
              onClick={() => void toggle(file, stagedGroup)}
              aria-expanded={isOpen}
              title={file.path}
            >
              <ChevronRight size={12} className="git-row-chevron" aria-hidden="true" />
              <span className={`git-file-status ${badge.cls}`} title={badge.label}>{badge.char}</span>
              <span className="git-file-name">
                <span className="git-file-base">{name}</span>
                {dir && <span className="git-file-dir"><bdi>{dir}</bdi></span>}
              </span>
            </button>
            {isOpen && (
              <div className="git-inline-diff">
                {error ? (
                  <div className="git-inline-error">{error}</div>
                ) : loading || diff === null ? (
                  <div className="git-inline-loading">Loading diff…</div>
                ) : (
                  <GitDiffView raw={diff} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )

  return (
    <div className="git-scroll">
      {staged.length > 0 && renderGroup('Staged', staged, true)}
      {unstaged.length > 0 && renderGroup('Changes', unstaged, false)}
    </div>
  )
}
