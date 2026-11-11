import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, GitBranch, RefreshCw } from 'lucide-react'
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

  const refresh = useCallback(async () => {
    setBusy(true)
    setGitError(null)
    try {
      const next = await window.api.gitGetStatusDetail(projectPath)
      setStatus(next)
      setLoaded(true)
      setReloadToken(token => token + 1)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'status' })
      setLoaded(true)
    } finally {
      setBusy(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
        <span className="git-branch-chip" title={`Current branch: ${status.branch}`}>
          <GitBranch size={13} aria-hidden="true" />
          <span className="git-branch-name">{status.branch}</span>
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
        <GitHistoryView projectPath={projectPath} reloadToken={reloadToken} />
      )}
    </div>
  )
}
