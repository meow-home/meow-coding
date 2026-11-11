import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CloudOff, GitBranch, RefreshCw } from 'lucide-react'
import type { GitStatusDetail } from '@shared/types'
import PanelHeader from '../common/PanelHeader'
import GitChangesView from './GitChangesView'
import GitHistoryView from './GitHistoryView'

interface Props {
  projectPath: string
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}

type Tab = 'changes' | 'history'

interface GitError {
  error: string
  command: string
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Everything a status refresh can change; an unchanged key means nothing to reload. */
function statusKeyOf(status: GitStatusDetail | null): string {
  if (!status) return 'none'
  const files = status.files
    .map(f => `${f.path}:${f.status}:${f.staged ? 's' : ''}${f.unstaged ? 'w' : ''}`)
    .join('|')
  return `${status.branch}|${status.upstream}|${status.ahead}|${status.behind}|${files}`
}

/** How often the open panel re-reads the repo, so a commit made by the agent lands by itself. */
const POLL_MS = 2500

/** One sentence for the branch chip's tooltip: pushed, unpushed, behind or unpublished. */
function syncTitle(status: GitStatusDetail): string {
  const name = status.branch ?? 'HEAD'
  if (!status.upstream) return `${name} is not published — no upstream branch`
  if (status.ahead > 0 && status.behind > 0) {
    return `${plural(status.ahead, 'commit')} not pushed, ${status.behind} behind ${status.upstream}`
  }
  if (status.ahead > 0) return `${plural(status.ahead, 'commit')} not pushed to ${status.upstream}`
  if (status.behind > 0) return `${plural(status.behind, 'commit')} behind ${status.upstream}`
  return `Up to date with ${status.upstream}`
}

/**
 * The Git panel: a read-only view of the working tree and the commit log, docked
 * with the other right-hand panels. It never stages, commits or switches branches.
 */
export default function GitPanel({ projectPath, full, onToggleFull, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [status, setStatus] = useState<GitStatusDetail | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [gitError, setGitError] = useState<GitError | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const dirtyCount = status?.files.length ?? 0
  // Last applied signature: a poll that changes nothing must not collapse an open
  // diff or commit, so state only moves when the repo actually moved.
  const appliedKey = useRef('')

  const applyStatus = useCallback((next: GitStatusDetail | null) => {
    const key = statusKeyOf(next)
    if (key === appliedKey.current) return
    appliedKey.current = key
    setStatus(next)
    setReloadToken(token => token + 1)
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    setGitError(null)
    try {
      const next = await window.api.gitGetStatusDetail(projectPath)
      appliedKey.current = statusKeyOf(next)
      setStatus(next)
      setLoaded(true)
      // A manual refresh always reloads the log, even when the key looks unchanged.
      setReloadToken(token => token + 1)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'status' })
      setLoaded(true)
    } finally {
      setBusy(false)
    }
  }, [projectPath])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await window.api.gitGetStatusDetail(projectPath)
        if (cancelled) return
        applyStatus(next)
        setLoaded(true)
      } catch {
        // A failed poll keeps the last good state; the Refresh button reports errors.
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [applyStatus, projectPath])

  const tabs = [
    {
      id: 'changes',
      label: (
        <span className="git-tab-label">
          <span>Changes</span>
          {dirtyCount > 0 && <span className="git-tab-count">{dirtyCount}</span>}
        </span>
      ),
      title: 'Working tree changes'
    },
    {
      id: 'history',
      label: <span className="git-tab-label"><span>History</span></span>,
      title: 'Commit history'
    }
  ]

  const actions = (
    <>
      {status?.branch && (
        <span className="git-branch-chip" title={syncTitle(status)}>
          <GitBranch size={13} aria-hidden="true" />
          <span className="git-branch-name">{status.branch}</span>
          {status.ahead > 0 && (
            <span className="git-sync-ahead" title={`${plural(status.ahead, 'commit')} not pushed`}>
              ↑{status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="git-sync-behind" title={`${plural(status.behind, 'commit')} behind`}>
              ↓{status.behind}
            </span>
          )}
          {!status.upstream && <CloudOff size={12} className="git-sync-local" aria-hidden="true" />}
        </span>
      )}
      <button
        className="icon-btn"
        title="Refresh"
        aria-label="Refresh Git status"
        disabled={busy}
        onClick={() => void refresh()}
      >
        <RefreshCw size={14} className={busy ? 'spin' : undefined} aria-hidden="true" />
      </button>
    </>
  )

  return (
    <div className={`git-panel ${full ? 'full' : 'docked'}`}>
      <PanelHeader
        ariaLabel="Git panel tabs"
        tabs={tabs}
        activeId={tab}
        onSelect={id => setTab(id as Tab)}
        actions={actions}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Git panel"
        onClose={onClose}
      />

      {gitError && (
        <div className="git-error-banner">
          <AlertTriangle size={14} aria-hidden="true" />
          <div className="git-error-body">
            <div className="git-error-command">git {gitError.command}</div>
            <pre className="git-error-text">{gitError.error}</pre>
          </div>
          <div className="git-error-actions">
            <button className="btn small" onClick={() => setGitError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="git-inline-loading">Loading Git status…</div>
      ) : status === null ? (
        <div className="git-empty">
          <GitBranch size={22} aria-hidden="true" />
          <div className="git-empty-title">Not a Git repository</div>
          <div className="git-empty-sub">Open a folder that is tracked by Git to see its changes.</div>
        </div>
      ) : tab === 'changes' ? (
        <GitChangesView projectPath={projectPath} status={status} />
      ) : (
        <GitHistoryView projectPath={projectPath} reloadToken={reloadToken} upstream={status.upstream} />
      )}
    </div>
  )
}
