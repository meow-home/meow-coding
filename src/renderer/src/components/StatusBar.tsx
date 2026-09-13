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
  Radio
} from 'lucide-react'
import type { AgentState, GitStatus } from '@shared/types'
import type { BrowserStatusInfo } from '@shared/browser-types'

interface Props {
  workspaceName: string | null
  projectPath?: string | null
  git: GitStatus | null
  agents: AgentState[]
  browser?: BrowserStatusInfo | null
  onBrowserClick?: () => void
  onGitClick?: () => void
}

export default function StatusBar({
  workspaceName,
  projectPath,
  git,
  agents,
  browser,
  onBrowserClick,
  onGitClick
}: Props) {
  const [version, setVersion] = useState('')
  const running = agents.filter(a => a.status === 'running' || a.status === 'spawning').length

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  const paired = Boolean(browser?.paired)
  const waiting = !paired && (browser?.status === 'listening' || browser?.status === 'idle')

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
            title="Open Git status & history viewer"
          >
            <GitBranch size={13} className="sb-icon" />
            <span className="sb-label sb-mono">{git.branch || 'HEAD'}</span>
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
          className={`sb-item sb-button sb-browser ${paired ? 'paired' : waiting ? 'waiting' : 'offline'}`}
          onClick={onBrowserClick}
          title="Open Browser Bridge status and pairing"
        >
          <Globe size={13} className="sb-icon" />
          <span className="sb-label sb-mono">
            {paired ? `browser: paired` : waiting ? `browser: waiting` : `browser: off`}
          </span>
          {paired ? (
            <CheckCircle2 size={12} className="sb-status-icon ok" />
          ) : waiting ? (
            <RefreshCw size={12} className="sb-status-icon spin waiting" />
          ) : (
            <Radio size={12} className="sb-status-icon off" />
          )}
        </button>

        {version && (
          <div className="sb-item sb-version" title={`Meow Coding v${version}`}>
            <Tag size={12} className="sb-icon sb-dim" />
            <span className="sb-label sb-mono sb-dim">v{version}</span>
          </div>
        )}
      </div>
    </footer>
  )
}
