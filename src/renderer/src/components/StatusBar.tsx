import { useEffect, useState } from 'react'
import {
  Folder,
  FolderSymlink,
  Code,
  GitBranch,
  Bot,
  Globe,
  Tag,
  CheckCircle2,
  RefreshCw,
  Radio,
  ShieldAlert,
  ArrowUpCircle,
  DownloadCloud
} from 'lucide-react'
import type { AgentState, GitStatus, UpdaterStatusEvent } from '@shared/types'
import type { BrowserStatusInfo } from '@shared/browser-types'
import { browserPillLabel } from './browserPillLabel'

interface Props {
  workspaceName: string | null
  projectPath?: string | null
  git: GitStatus | null
  agents: AgentState[]
  browser?: BrowserStatusInfo | null
  browserBackend?: 'builtin' | 'chrome'
  update?: UpdaterStatusEvent | null
  onUpdateClick?: () => void
  onBrowserClick?: () => void
  onGitClick?: () => void
}

/** Tooltip for the git pill: branch, sync state and dirty count in one line. */
function gitSyncTitle(git: GitStatus): string {
  const parts = [git.branch || 'HEAD']
  if (!git.upstream) parts.push('not published (no upstream branch)')
  else if (git.ahead > 0 && git.behind > 0) parts.push(`${git.ahead} not pushed, ${git.behind} behind ${git.upstream}`)
  else if (git.ahead > 0) parts.push(`${git.ahead} commit(s) not pushed to ${git.upstream}`)
  else if (git.behind > 0) parts.push(`${git.behind} commit(s) behind ${git.upstream}`)
  else parts.push(`up to date with ${git.upstream}`)
  if (git.dirtyCount > 0) parts.push(`${git.dirtyCount} changed file(s)`)
  return parts.join(' · ')
}

export default function StatusBar({
  workspaceName,
  projectPath,
  git,
  agents,
  browser,
  browserBackend,
  update,
  onUpdateClick,
  onBrowserClick,
  onGitClick
}: Props) {
  const [version, setVersion] = useState('')
  const running = agents.filter(a => a.status === 'running' || a.status === 'spawning').length

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  const pill = browserPillLabel(browserBackend, browser)
  const updateReady = update?.type === 'downloaded' ? update.version : null
  const updateAvailable = update?.type === 'update-available' ? update.version : null
  const updatePercent = update?.type === 'download-progress' ? update.percent : null
  const updateVersion = update?.type === 'download-progress' ? update.version : updateAvailable
  const updateActive = updateReady !== null || updateAvailable !== null || updatePercent !== null
  const updateLabel = updateReady
    ? 'Restart to update'
    : updatePercent !== null
      ? `Updating ${updatePercent}%`
      : 'Update available'
  const updateTitle = updateReady
    ? `v${updateReady} is downloaded — click to restart and apply it`
    : updatePercent !== null
      ? `Downloading${updateVersion ? ` v${updateVersion}` : ' the update'} in the background (${updatePercent}%) — click for details`
      : `v${updateVersion} is available — downloading in the background. Click for details`
  const paired = pill.tone === 'paired'
  const pending = Boolean(browser?.pendingExtension)
  const waiting = pill.tone === 'waiting' && !pending

  return (
    <footer className="status-bar">
      {/* Left items: Workspace & Actions & Git */}
      <div className="sb-group sb-left">
        <div className="sb-status-indicator" title="Meow Engine Active" />

        {workspaceName && (
          <div className="sb-workspace-group">
            <div className="sb-item sb-workspace" title={`Current Workspace: ${workspaceName}${projectPath ? ` (${projectPath})` : ''}`}>
              <Folder size={13} className="sb-icon sb-icon-accent" />
              <span className="sb-label sb-mono">{workspaceName}</span>
            </div>

            {projectPath && (
              <>
                <button
                  className="sb-item sb-button sb-action-btn"
                  onClick={() => void window.api.openFolder(projectPath)}
                  title="Open project folder in File Explorer"
                >
                  <FolderSymlink size={13} className="sb-icon" />
                  <span className="sb-label sb-mono">Folder</span>
                </button>
                <button
                  className="sb-item sb-button sb-action-btn"
                  onClick={() => void window.api.openInEditor(projectPath)}
                  title="Open project in VS Code"
                >
                  <Code size={13} className="sb-icon" />
                  <span className="sb-label sb-mono">VS Code</span>
                </button>
              </>
            )}
          </div>
        )}

        {git && (
          <button
            className="sb-item sb-button sb-git"
            onClick={onGitClick}
            title={gitSyncTitle(git)}
          >
            <GitBranch size={13} className="sb-icon" />
            <span className="sb-label sb-mono">{git.branch || 'HEAD'}</span>
            {git.ahead > 0 && (
              <span className="sb-sync ahead" title={`${git.ahead} commit(s) not pushed`}>↑{git.ahead}</span>
            )}
            {git.behind > 0 && (
              <span className="sb-sync behind" title={`${git.behind} commit(s) behind the remote`}>↓{git.behind}</span>
            )}
            {git.dirtyCount > 0 && (
              <span className="sb-dirty-badge" title={`${git.dirtyCount} modified file(s)`}>
                ● {git.dirtyCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Right items: Sessions, Browser Bridge, App Version */}
      <div className="sb-group sb-right">
        <div className="sb-item sb-sessions" title={`${running} active session(s)`}>
          <Bot size={13} className="sb-icon" />
          <span className="sb-label sb-mono">
            {running === 0 ? '0 active' : `${running} running`}
          </span>
          {running > 0 && <span className="sb-pulse-dot" />}
        </div>

        <button
          className={`sb-item sb-button sb-browser ${pill.tone}`}
          onClick={onBrowserClick}
          title="Open browser settings, status and extension approval"
        >
          <Globe size={13} className="sb-icon" />
          <span className="sb-label sb-mono">{pill.text}</span>
          {paired ? (
            <CheckCircle2 size={12} className="sb-status-icon ok" />
          ) : pending ? (
            <ShieldAlert size={12} className="sb-status-icon waiting" />
          ) : waiting ? (
            <RefreshCw size={12} className="sb-status-icon spin waiting" />
          ) : (
            <Radio size={12} className="sb-status-icon off" />
          )}
        </button>

        {updateActive ? (
          <button
            className={`sb-item sb-button sb-update ${updateReady ? 'ready' : 'downloading'}`}
            onClick={onUpdateClick}
            title={updateTitle}
          >
            {updateReady ? (
              <ArrowUpCircle size={13} className="sb-icon sb-icon-accent" />
            ) : (
              <DownloadCloud size={13} className="sb-icon sb-icon-accent" />
            )}
            <span className="sb-label sb-mono">{updateLabel}</span>
            {updateReady && <span className="sb-pulse-dot" />}
          </button>
        ) : (
          version && (
            <div className="sb-item sb-version" title={`Meow Coding v${version}`}>
              <Tag size={12} className="sb-icon sb-dim" />
              <span className="sb-label sb-mono sb-dim">v{version}</span>
            </div>
          )
        )}
      </div>
    </footer>
  )
}
