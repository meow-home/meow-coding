import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, GitBranch, RefreshCw, X, Folder, Layers, History, FileCode } from 'lucide-react'
import type { GitBranch as GitBranchType, GitStatusDetail } from '@shared/types'
import PopupTitleBar from '../PopupTitleBar'
import GitBranchSwitcher from './GitBranchSwitcher'
import GitChangesTab from './GitChangesTab'
import GitHistoryTab from './GitHistoryTab'
import GitBlameTab from './GitBlameTab'

interface Props {
  projectPath: string
}

type Tab = 'changes' | 'history' | 'blame'

interface GitError {
  error: string
  command: string
}

interface SwitchDialog {
  branch: string
  dirtyCount: number
  confirmDiscard: boolean
}

export default function GitViewer({ projectPath }: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [status, setStatus] = useState<GitStatusDetail | null>(null)
  const [gitError, setGitError] = useState<GitError | null>(null)
  const [busy, setBusy] = useState(false)
  const [switchDialog, setSwitchDialog] = useState<SwitchDialog | null>(null)
  const [loaded, setLoaded] = useState(false)

  const currentBranch = branches.find(b => b.isCurrent)?.name ?? status?.branch ?? null
  const projectName = projectPath.split(/[\\/]/).pop() || projectPath
  const dirtyCount = status?.files.length ?? 0

  const refresh = useCallback(async () => {
    try {
      const [bs, st] = await Promise.all([
        window.api.gitGetBranches(projectPath),
        window.api.gitGetStatusDetail(projectPath)
      ])
      setBranches(bs)
      setStatus(st)
      setLoaded(true)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'refresh' })
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Close via Escape; the native title bar provides minimize/maximize/close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const switchTo = useCallback(async (branch: string) => {
    if (busy) return
    setGitError(null)
    setBusy(true)
    try {
      const st = await window.api.gitGetStatusDetail(projectPath)
      const dirty = (st?.files ?? []).length > 0
      if (dirty) {
        setSwitchDialog({ branch, dirtyCount: st!.files.length, confirmDiscard: false })
        setBusy(false)
        return
      }
      const res = await window.api.gitCheckout(projectPath, branch)
      if (!res.ok) {
        setGitError({ error: res.error, command: res.command })
      } else {
        await refresh()
      }
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'checkout' })
    } finally {
      setBusy(false)
    }
  }, [projectPath, busy, refresh])

  const doSwitchWithCleanup = useCallback(async (branch: string, mode: 'stash' | 'bring' | 'discard') => {
    setBusy(true)
    setGitError(null)
    try {
      if (mode === 'stash') {
        const stashRes = await window.api.gitStash(projectPath)
        if (!stashRes.ok) {
          setGitError({ error: stashRes.error, command: stashRes.command })
          return
        }
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          await window.api.gitStashPop(projectPath)
          return
        }
        const pop = await window.api.gitStashPop(projectPath)
        if (!pop.ok) {
          // Stash is preserved; surface git's message so the user can resolve.
          setGitError({ error: `${pop.error}\n\nStash "meow-switch" was kept — resolve it and drop it manually.`, command: pop.command })
          return
        }
      } else if (mode === 'discard') {
        const disc = await window.api.gitDiscard(projectPath)
        if (!disc.ok) {
          setGitError({ error: disc.error, command: disc.command })
          return
        }
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          return
        }
      } else {
        const co = await window.api.gitCheckout(projectPath, branch)
        if (!co.ok) {
          setGitError({ error: co.error, command: co.command })
          return
        }
      }
      await refresh()
      setSwitchDialog(null)
    } catch (err) {
      setGitError({ error: err instanceof Error ? err.message : String(err), command: 'switch' })
    } finally {
      setBusy(false)
    }
  }, [projectPath, refresh])

  const copyError = () => {
    if (gitError) void navigator.clipboard.writeText(`git ${gitError.command}\n${gitError.error}`)
  }

  return (
    <div className="git-viewer">
      <PopupTitleBar title={`Git — ${projectName}`} />
      
      <div className="git-header">
        <div className="git-header-repo" title={projectPath}>
          <Folder size={14} className="git-repo-icon" aria-hidden="true" />
          <span className="git-repo-name">{projectName}</span>
        </div>

        <div className="git-header-actions">
          <GitBranchSwitcher
            projectPath={projectPath}
            branches={branches}
            current={currentBranch}
            busy={busy}
            onSwitch={branch => void switchTo(branch)}
            onCreated={() => void refresh()}
            onError={(error, command) => setGitError({ error, command })}
          />
          <button
            className="git-header-btn"
            title="Refresh Git status"
            aria-label="Refresh"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} aria-hidden="true" className={busy ? 'spin' : undefined} />
          </button>
          <button className="git-header-btn" title="Close (Esc)" aria-label="Close" onClick={() => window.close()}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!loaded && !gitError && <div className="git-diff-empty git-center">Loading Git status...</div>}

      {gitError && (
        <div className="git-error-banner">
          <AlertTriangle size={14} aria-hidden="true" />
          <div className="git-error-body">
            <div className="git-error-command">git {gitError.command}</div>
            <pre className="git-error-text">{gitError.error}</pre>
          </div>
          <div className="git-error-actions">
            <button className="btn small" onClick={copyError}>Copy</button>
            <button className="btn small" onClick={() => setGitError(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="git-tabs">
            <button
              className={`git-tab ${tab === 'changes' ? 'active' : ''}`}
              disabled={busy}
              onClick={() => setTab('changes')}
            >
              <Layers size={13} aria-hidden="true" />
              <span>Changes</span>
              {dirtyCount > 0 && <span className="git-tab-badge">{dirtyCount}</span>}
            </button>
            <button
              className={`git-tab ${tab === 'history' ? 'active' : ''}`}
              disabled={busy}
              onClick={() => setTab('history')}
            >
              <History size={13} aria-hidden="true" />
              <span>History</span>
            </button>
            <button
              className={`git-tab ${tab === 'blame' ? 'active' : ''}`}
              disabled={busy}
              onClick={() => setTab('blame')}
            >
              <FileCode size={13} aria-hidden="true" />
              <span>Blame</span>
            </button>
          </div>

          <div className="git-body">
            {tab === 'changes' && (
              <GitChangesTab projectPath={projectPath} status={status} />
            )}
            {tab === 'history' && <GitHistoryTab projectPath={projectPath} />}
            {tab === 'blame' && <GitBlameTab projectPath={projectPath} />}
          </div>
        </>
      )}

      {switchDialog && (
        <div className="dialog-backdrop">
          <div className="dialog git-switch-dialog">
            <h3>Switch branch to "{switchDialog.branch}"?</h3>
            <p className="settings-hint">
              Your working tree currently has {switchDialog.dirtyCount} modified file{switchDialog.dirtyCount === 1 ? '' : 's'}. Choose how to handle your local changes before switching:
            </p>
            <div className="git-switch-actions">
              <button className="btn primary" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'stash')}>
                Stash &amp; Switch
              </button>
              <button className="btn" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'bring')}>
                Bring Changes Along
              </button>
              {!switchDialog.confirmDiscard ? (
                <button className="btn danger" disabled={busy} onClick={() => setSwitchDialog({ ...switchDialog, confirmDiscard: true })}>
                  Discard Local Changes
                </button>
              ) : (
                <button className="btn danger" disabled={busy} onClick={() => void doSwitchWithCleanup(switchDialog.branch, 'discard')}>
                  Confirm Discard (Permanent)
                </button>
              )}
              <button className="btn link" disabled={busy} onClick={() => setSwitchDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
