import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ArrowLeft, GitCommit as GitCommitIcon, Search, History, FileText, CheckSquare, Layers, Copy, Check } from 'lucide-react'
import type { GitCommit, GitDiffFile, GitDiffResult } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
}

const fmtDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
})

const DEFAULT_SIDEBAR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600

export default function GitHistoryTab({ projectPath }: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [count, setCount] = useState(200)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCommitObj, setSelectedCommitObj] = useState<GitCommit | null>(null)
  const [compare, setCompare] = useState<string[]>([])
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [fileHistory, setFileHistory] = useState<{ file: string; commits: GitCommit[] } | null>(null)
  const [diffFile, setDiffFile] = useState<GitDiffFile | null>(null)
  const [copiedSha, setCopiedSha] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const loadToken = useRef(0)
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

  const loadCommits = useCallback(async (n: number) => {
    setLoading(true)
    try {
      const list = await window.api.gitGetCommits(projectPath, undefined, n)
      setCommits(list)
    } catch {
      /* keep old list */
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void loadCommits(count)
  }, [loadCommits, count])

  const filteredCommits = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return commits
    return commits.filter(c => 
      c.subject.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.shortHash.toLowerCase().includes(q) ||
      c.hash.toLowerCase().includes(q)
    )
  }, [commits, filter])

  const selectCommit = useCallback(async (commit: GitCommit) => {
    const token = ++loadToken.current
    setSelected(commit.hash)
    setSelectedCommitObj(commit)
    setCompare([])
    setDiffFile(null)
    setDiff(null)
    setDiffError(null)
    try {
      const res = await window.api.gitGetCommitDiff(projectPath, commit.hash)
      if (token !== loadToken.current) return
      setDiff(res)
    } catch (err) {
      if (token !== loadToken.current) return
      setDiffError(err instanceof Error ? err.message : String(err))
    }
  }, [projectPath])

  const toggleCompare = useCallback((sha: string) => {
    setSelected(null)
    setSelectedCommitObj(null)
    setDiff(null)
    setCompare(prev => {
      if (prev.includes(sha)) return prev.filter(s => s !== sha)
      if (prev.length >= 2) return [prev[1], sha]
      return [...prev, sha]
    })
  }, [])

  useEffect(() => {
    if (compare.length !== 2) return
    const token = ++loadToken.current
    setDiff(null)
    setDiffError(null)
    setDiffFile(null)
    const [a, b] = compare
    window.api.gitCompareCommits(projectPath, a, b)
      .then(res => {
        if (token === loadToken.current) setDiff(res)
      })
      .catch((err: unknown) => {
        if (token === loadToken.current) setDiffError(err instanceof Error ? err.message : String(err))
      })
  }, [compare, projectPath])

  const selectDiffFile = useCallback((f: GitDiffFile) => {
    setDiffFile(f)
  }, [])

  const backToFiles = useCallback(() => {
    setDiffFile(null)
  }, [])

  const backToCommits = useCallback(() => {
    setFileHistory(null)
    setDiffFile(null)
  }, [])

  const copySha = (hash: string) => {
    void navigator.clipboard.writeText(hash)
    setCopiedSha(true)
    setTimeout(() => setCopiedSha(false), 2000)
  }

  const renderFileRows = (files: GitDiffFile[]) => (
    <div className="git-history-files-container">
      <div className="git-history-files-header">
        Changed Files ({files.length})
      </div>
      <div className="git-history-files-list">
        {files.map(f => (
          <button key={f.path} className="git-history-file-row" onClick={() => selectDiffFile(f)}>
            <span className={`git-change-status-badge ${f.status === 'deleted' ? 'del' : f.status === 'added' ? 'add' : 'mod'}`}>
              {f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : f.status === 'renamed' ? 'R' : 'M'}
            </span>
            <span className="git-history-file-path" title={f.path}>{f.path}</span>
            <span className="git-history-file-counts">
              {f.additions > 0 && <span className="add">+{f.additions}</span>}
              {f.deletions > 0 && <span className="del">−{f.deletions}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  const diffPane = (
    <div className="git-history-diff-panel">
      {diffFile ? (
        <div className="git-diff-header">
          <button className="btn small" onClick={backToFiles}>
            <ArrowLeft size={13} aria-hidden="true" />
            <span>Files list</span>
          </button>
          <span className="git-diff-header-path" title={diffFile.path}>{diffFile.path}</span>
        </div>
      ) : selectedCommitObj && !compare.length ? (
        <div className="git-commit-header-card">
          <div className="git-commit-header-top">
            <h4 className="git-commit-subject-full">{selectedCommitObj.subject}</h4>
            <button className="btn small" title="Copy full SHA" onClick={() => copySha(selectedCommitObj.hash)}>
              {copiedSha ? <Check size={12} className="text-green" /> : <Copy size={12} />}
              <span className="git-commit-sha-text">{selectedCommitObj.shortHash}</span>
            </button>
          </div>
          <div className="git-commit-header-meta">
            <span className="author">Author: <strong>{selectedCommitObj.author}</strong></span>
            <span className="dot">•</span>
            <span className="date">{fmtDate.format(new Date(selectedCommitObj.date * 1000))}</span>
          </div>
        </div>
      ) : compare.length === 2 ? (
        <div className="git-commit-header-card">
          <div className="git-commit-header-top">
            <h4 className="git-commit-subject-full">
              Comparing {compare[0].slice(0, 7)} ... {compare[1].slice(0, 7)}
            </h4>
          </div>
        </div>
      ) : null}

      <div className="git-history-diff-body">
        {diffError ? (
          <div className="git-error-banner">{diffError}</div>
        ) : diff === null ? (
          <div className="git-diff-placeholder">
            <GitCommitIcon size={32} className="git-placeholder-icon" aria-hidden="true" />
            <div className="git-placeholder-title">Select a commit to inspect diff</div>
            <div className="git-placeholder-sub">
              {compare.length === 1
                ? 'Check a second commit checkbox to compare them.'
                : 'Click any commit row from the history list on the left to view file changes and diffs.'}
            </div>
          </div>
        ) : (
          <>
            {diffFile ? (
              <GitDiffView raw={diffFile.raw} />
            ) : (
              <>{diff.files.length > 0 ? renderFileRows(diff.files) : <div className="git-diff-empty">No file changes in this commit.</div>}</>
            )}
          </>
        )}
      </div>
    </div>
  )

  const listPane = (
    <div className="git-history-sidebar" style={{ width: sidebarWidth, flex: '0 0 auto' }}>
      <div className="git-history-search">
        <Search size={13} className="git-history-search-icon" aria-hidden="true" />
        <input
          className="git-history-search-input"
          placeholder="Filter commit history..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {compare.length > 0 && (
        <div className="git-compare-banner">
          <CheckSquare size={13} aria-hidden="true" />
          <span className="git-compare-hint">
            {compare.length === 1
              ? `Select 2nd commit to compare with ${compare[0].slice(0, 7)}`
              : `Diffing ${compare[0].slice(0, 7)} ↔ ${compare[1].slice(0, 7)}`}
          </span>
          <button className="btn small link" onClick={() => setCompare([])}>Clear</button>
        </div>
      )}

      <div className="git-history-list">
        {filteredCommits.map(c => {
          const isSelected = c.hash === selected
          const isCompared = compare.includes(c.hash)
          const initials = c.author.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?'

          return (
            <div
              key={c.hash}
              className={`git-commit-row ${isSelected ? 'active' : ''} ${isCompared ? 'compared' : ''}`}
              onClick={() => void selectCommit(c)}
            >
              <input
                type="checkbox"
                className="git-commit-check"
                checked={isCompared}
                onClick={e => e.stopPropagation()}
                onChange={() => toggleCompare(c.hash)}
                title="Select to compare"
              />
              <div className="git-author-avatar">{initials}</div>
              <div className="git-commit-main">
                <div className="git-commit-subject" title={c.subject}>{c.subject}</div>
                <div className="git-commit-meta">
                  <span className="sha">{c.shortHash}</span>
                  <span className="dot">•</span>
                  <span className="author">{c.author}</span>
                  <span className="dot">•</span>
                  <span className="date">{fmtDate.format(new Date(c.date * 1000))}</span>
                </div>
              </div>
            </div>
          )
        })}
        {filteredCommits.length === 0 && !loading && (
          <div className="git-history-empty">No matching commits found</div>
        )}
        <button className="btn small git-load-more" disabled={loading} onClick={() => setCount(n => n + 200)}>
          {loading ? 'Loading...' : 'Load more commits'}
        </button>
      </div>

      <div className="git-resizer" onMouseDown={startDrag} title="Drag to resize sidebar" />
    </div>
  )

  if (fileHistory) {
    return (
      <div className="git-history">
        <div className="git-history-sidebar" style={{ width: sidebarWidth, flex: '0 0 auto' }}>
          <div className="git-history-filehistory-header">
            <button className="btn small" onClick={backToCommits}>
              <ArrowLeft size={13} aria-hidden="true" />
              <span>All Commits</span>
            </button>
            <span className="git-history-filehistory-path" title={fileHistory.file}>{fileHistory.file}</span>
          </div>
          <div className="git-history-list">
            {fileHistory.commits.map(c => (
              <div key={c.hash} className={`git-commit-row ${c.hash === selected ? 'active' : ''}`} onClick={() => void selectCommit(c)}>
                <div className="git-commit-main">
                  <div className="git-commit-subject">{c.subject}</div>
                  <div className="git-commit-meta">
                    <span className="sha">{c.shortHash}</span> · <span className="author">{c.author}</span> · <span className="date">{fmtDate.format(new Date(c.date * 1000))}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="git-resizer" onMouseDown={startDrag} title="Drag to resize sidebar" />
        </div>
        {diffPane}
      </div>
    )
  }

  return (
    <div className="git-history">
      {listPane}
      {diffPane}
    </div>
  )
}
