import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileCode, Filter, Search, Check, Layers, FilePlus, FileText } from 'lucide-react'
import type { GitFileChange, GitStatusDetail } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
  status: GitStatusDetail | null
}

const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600

function getStatusBadge(f: GitFileChange): { char: string; label: string; cls: string } {
  switch (f.status) {
    case 'added': return { char: '+', label: 'Added', cls: 'add' }
    case 'deleted': return { char: '-', label: 'Deleted', cls: 'del' }
    case 'renamed': return { char: 'R', label: 'Renamed', cls: 'mod' }
    case 'untracked': return { char: '?', label: 'Untracked', cls: 'untracked' }
    case 'typechange': return { char: 'T', label: 'Typechange', cls: 'mod' }
    default: return { char: 'M', label: 'Modified', cls: 'mod' }
  }
}

export default function GitChangesTab({ projectPath, status }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedFileObj, setSelectedFileObj] = useState<GitFileChange | null>(null)
  const [staged, setStaged] = useState(false)
  const [filter, setFilter] = useState('')
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = ev.clientX - dragRef.current.startX
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragRef.current.startWidth + delta))
      setSidebarWidth(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  const allFiles = status?.files ?? []
  
  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return allFiles
    return allFiles.filter(f => f.path.toLowerCase().includes(q))
  }, [allFiles, filter])

  const stagedFiles = useMemo(() => filteredFiles.filter(f => f.staged), [filteredFiles])
  const unstagedFiles = useMemo(() => filteredFiles.filter(f => !f.staged), [filteredFiles])

  useEffect(() => {
    setSelected(null)
    setSelectedFileObj(null)
    setDiff(null)
  }, [status?.branch])

  const selectFile = useCallback(async (f: GitFileChange, useStaged: boolean) => {
    setSelected(f.path)
    setSelectedFileObj(f)
    setStaged(useStaged)
    setDiffError(null)
    setDiff(null)
    try {
      const raw = await window.api.gitGetDiff(projectPath, f.path, useStaged)
      setDiff(raw)
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  const renderGroup = (title: string, files: GitFileChange[], useStagedDefault: boolean, isStagedGroup: boolean) => (
    <div className="git-changes-group">
      <div className="git-changes-group-header">
        <span className="git-changes-group-title">{title}</span>
        <span className={`git-changes-count ${files.length > 0 ? (isStagedGroup ? 'staged' : 'unstaged') : ''}`}>
          {files.length}
        </span>
      </div>
      {files.length === 0 ? (
        <div className="git-changes-empty">No {isStagedGroup ? 'staged' : 'unstaged'} changes</div>
      ) : (
        <div className="git-changes-rows">
          {files.map(f => {
            const badge = getStatusBadge(f)
            const isSelected = f.path === selected && staged === useStagedDefault
            const filename = f.path.split(/[\\/]/).pop() || f.path
            const dir = f.path.substring(0, f.path.length - filename.length)

            return (
              <div key={`${f.path}-${useStagedDefault ? 'staged' : 'work'}`}>
                <div
                  className={`git-change-row ${isSelected ? 'active' : ''}`}
                  onClick={() => void selectFile(f, useStagedDefault)}
                  title={f.path}
                >
                  <span className={`git-change-status-badge ${badge.cls}`} title={badge.label}>
                    {badge.char}
                  </span>
                  <span className="git-change-name">
                    <span className="filename">{filename}</span>
                    {dir && <span className="dir">{dir}</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className="git-changes">
      <div className="git-changes-sidebar" style={{ width: sidebarWidth, flex: '0 0 auto' }}>
        <div className="git-changes-search">
          <Search size={13} className="git-changes-search-icon" aria-hidden="true" />
          <input
            className="git-changes-search-input"
            placeholder="Filter changed files..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="git-changes-list">
          {renderGroup('Staged Changes', stagedFiles, true, true)}
          {renderGroup('Changes', unstagedFiles, false, false)}
        </div>
        <div className="git-resizer" onMouseDown={startDrag} title="Drag to resize sidebar" />
      </div>

      <div className="git-changes-diff-panel">
        {selectedFileObj ? (
          <div className="git-diff-header">
            <FileCode size={14} className="git-diff-header-icon" aria-hidden="true" />
            <span className="git-diff-header-path" title={selectedFileObj.path}>
              {selectedFileObj.path}
            </span>

            {selectedFileObj.staged && selectedFileObj.unstaged && (
              <div className="git-diff-mode-toggle">
                <button
                  className={`git-diff-mode-btn ${!staged ? 'active' : ''}`}
                  onClick={() => void selectFile(selectedFileObj, false)}
                >
                  Working Tree
                </button>
                <button
                  className={`git-diff-mode-btn ${staged ? 'active' : ''}`}
                  onClick={() => void selectFile(selectedFileObj, true)}
                >
                  Staged
                </button>
              </div>
            )}
          </div>
        ) : null}

        <div className="git-diff-body">
          {diffError ? (
            <div className="git-error-banner">{diffError}</div>
          ) : diff === null ? (
            <div className="git-diff-placeholder">
              <FileText size={32} className="git-placeholder-icon" aria-hidden="true" />
              <div className="git-placeholder-title">Select a file to inspect diff</div>
              <div className="git-placeholder-sub">
                Click any file from the staged or unstaged changes list on the left to view diff.
              </div>
            </div>
          ) : (
            <GitDiffView raw={diff} />
          )}
        </div>
      </div>
    </div>
  )
}
