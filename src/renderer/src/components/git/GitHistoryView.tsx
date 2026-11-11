import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpCircle, ChevronLeft, ChevronRight, GitCommit as GitCommitIcon, Search } from 'lucide-react'
import type { GitCommit, GitDiffFile, GitDiffResult } from '@shared/types'
import GitDiffView from './GitDiffView'

interface Props {
  projectPath: string
  /** Bumped when the working tree or the sync state changes, so the log reloads. */
  reloadToken: number
  /** Tracking branch for the "not pushed" marker's tooltip. */
  upstream?: string | null
}

const PAGE = 50
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Relative time for the list, an absolute date for anything older than a week. */
function relativeTime(seconds: number): string {
  const age = Math.max(0, Date.now() / 1000 - seconds)
  if (age < MINUTE) return 'just now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`
  if (age < 2 * DAY) return 'yesterday'
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d ago`
  return shortDate.format(new Date(seconds * 1000))
}

const STATUS: Record<string, { char: string; cls: string }> = {
  added: { char: 'A', cls: 'add' },
  deleted: { char: 'D', cls: 'del' },
  renamed: { char: 'R', cls: 'mod' },
  typechange: { char: 'T', cls: 'mod' },
  modified: { char: 'M', cls: 'mod' }
}

/**
 * The History tab: a flat commit log. A commit expands in place to its message and
 * changed files; a file then swaps the list for that file's diff.
 */
export default function GitHistoryView({ projectPath, reloadToken, upstream }: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [count, setCount] = useState(PAGE)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const [openHash, setOpenHash] = useState<string | null>(null)
  const [detail, setDetail] = useState<GitDiffResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<GitDiffFile | null>(null)

  const listToken = useRef(0)
  const detailToken = useRef(0)

  useEffect(() => {
    const token = ++listToken.current
    setLoading(true)
    window.api.gitGetCommits(projectPath, undefined, count)
      .then(list => {
        if (token !== listToken.current) return
        setCommits(list)
        setHasMore(list.length >= count)
      })
      .catch(() => {
        if (token === listToken.current) setCommits([])
      })
      .finally(() => {
        if (token === listToken.current) setLoading(false)
      })
  }, [projectPath, count, reloadToken])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return commits
    return commits.filter(c =>
      c.subject.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.shortHash.toLowerCase().includes(q)
    )
  }, [commits, filter])

  const toggleCommit = useCallback(async (commit: GitCommit) => {
    if (openHash === commit.hash) {
      detailToken.current++
      setOpenHash(null)
      setDetail(null)
      setOpenFile(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    const token = ++detailToken.current
    setOpenHash(commit.hash)
    setDetail(null)
    setOpenFile(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await window.api.gitGetCommitDiff(projectPath, commit.hash)
      if (token === detailToken.current) setDetail(res)
    } catch (err) {
      if (token === detailToken.current) setDetailError(err instanceof Error ? err.message : String(err))
    } finally {
      if (token === detailToken.current) setDetailLoading(false)
    }
  }, [openHash, projectPath])

  const renderDetail = (commit: GitCommit) => {
    const body = commit.message.split('\n').slice(1).join('\n').trim()
    const additions = detail?.files.reduce((sum, f) => sum + f.additions, 0) ?? 0
    const deletions = detail?.files.reduce((sum, f) => sum + f.deletions, 0) ?? 0
    return (
      <div className="git-commit-detail">
        <div className="git-commit-detail-meta">
          <span className="git-commit-sha">{commit.shortHash}</span>
          <span className="git-dot">·</span>
          <span>{commit.author}</span>
          <span className="git-dot">·</span>
          <span>{fullDate.format(new Date(commit.date * 1000))}</span>
        </div>
        {body && <pre className="git-commit-message">{body}</pre>}
        {openFile ? (
          <>
            <button className="git-back-row" onClick={() => setOpenFile(null)}>
              <ChevronLeft size={13} aria-hidden="true" />
              <span>
                {detail?.files.length ?? 0} file{detail?.files.length === 1 ? '' : 's'}
              </span>
              <span className="git-back-path" title={openFile.path}><bdi>{openFile.path}</bdi></span>
            </button>
            <div className="git-inline-diff">
              <GitDiffView raw={openFile.raw} />
            </div>
          </>
        ) : detailLoading ? (
          <div className="git-inline-loading">Loading changes…</div>
        ) : detailError ? (
          <div className="git-inline-error">{detailError}</div>
        ) : detail ? (
          detail.files.length === 0 ? (
            <div className="git-inline-note">No file changes.</div>
          ) : (
            <div className="git-commit-files">
              <div className="git-commit-files-head">
                <span>{detail.files.length} file{detail.files.length === 1 ? '' : 's'}</span>
                <span className="git-nums">
                  {additions > 0 && <span className="add">+{additions}</span>}
                  {deletions > 0 && <span className="del">−{deletions}</span>}
                </span>
              </div>
              {detail.files.map(file => {
                const badge = STATUS[file.status] ?? STATUS.modified
                return (
                  <button key={file.path} className="git-commit-file" onClick={() => setOpenFile(file)} title={file.path}>
                    <span className={`git-file-status ${badge.cls}`}>{badge.char}</span>
                    <span className="git-commit-file-path">{file.path}</span>
                    <span className="git-nums">
                      {file.additions > 0 && <span className="add">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div className="git-filter">
        <Search size={13} aria-hidden="true" />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter commits"
          aria-label="Filter commits"
        />
      </div>
      <div className="git-scroll">
        {filtered.map(commit => {
          const isOpen = openHash === commit.hash
          return (
            <div key={commit.hash}>
              <button
                className={`git-commit-row${isOpen ? ' open' : ''}`}
                onClick={() => void toggleCommit(commit)}
                aria-expanded={isOpen}
              >
                <ChevronRight size={12} className="git-row-chevron" aria-hidden="true" />
                <span className="git-commit-main">
                  <span className="git-commit-subject" title={commit.subject}>{commit.subject}</span>
                  <span className="git-commit-meta">
                    <span className="git-commit-sha">{commit.shortHash}</span>
                    <span className="git-dot">·</span>
                    <span>{commit.author}</span>
                    <span className="git-commit-when">{relativeTime(commit.date)}</span>
                  </span>
                </span>
                {commit.unpushed && (
                  <span
                    className="git-commit-unpushed"
                    role="img"
                    aria-label={upstream ? `Not pushed to ${upstream}` : 'Not pushed yet'}
                    title={upstream ? `Not pushed to ${upstream}` : 'Not pushed yet'}
                  >
                    <ArrowUpCircle size={14} aria-hidden="true" />
                  </span>
                )}
              </button>
              {isOpen && renderDetail(commit)}
            </div>
          )
        })}
        {filtered.length === 0 && !loading && (
          <div className="git-empty">
            <GitCommitIcon size={22} aria-hidden="true" />
            <div className="git-empty-title">{commits.length === 0 ? 'No commits yet' : 'No matching commits'}</div>
            {commits.length === 0 && <div className="git-empty-sub">Commits appear here once the repository has one.</div>}
          </div>
        )}
        {loading && <div className="git-inline-loading">Loading commits…</div>}
      </div>
      {hasMore && !filter && (
        <button className="git-load-more" disabled={loading} onClick={() => setCount(n => n + PAGE)}>
          Load more
        </button>
      )}
    </>
  )
}
