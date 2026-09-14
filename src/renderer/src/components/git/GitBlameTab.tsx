import { useState, useCallback, useRef } from 'react'
import { FileCode, FileText, Search } from 'lucide-react'
import type { GitBlameLine } from '@shared/types'
import GitFileTree from './GitFileTree'

interface Props {
  projectPath: string
}

const fmtBlameDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric'
})

const DEFAULT_SIDEBAR_WIDTH = 220
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 500

export default function GitBlameTab({ projectPath }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [blame, setBlame] = useState<GitBlameLine[]>([])
  const [content, setContent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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

  const loadFile = useCallback(async (absPath: string) => {
    setFilePath(absPath)
    setError(null)
    setLoading(true)
    try {
      const [blameLines, fileContent] = await Promise.all([
        window.api.gitGetBlame(projectPath, absPath),
        window.api.getFileContent(absPath)
      ])
      setBlame(blameLines)
      setContent(fileContent.content.split('\n'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBlame([])
      setContent([])
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  // Lines the working tree has beyond the last blame entry (untracked edits).
  const blameByLine = new Map(blame.map(b => [b.finalLine, b]))
  const relativeFileName = filePath ? filePath.replace(projectPath, '').replace(/^[\\/]/, '') : ''

  return (
    <div className="git-blame">
      <div className="git-blame-tree-panel" style={{ width: sidebarWidth, flex: '0 0 auto' }}>
        <div className="git-blame-tree-header">
          <FileCode size={13} className="git-blame-tree-header-icon" aria-hidden="true" />
          <span>Files Tree</span>
        </div>
        <div className="git-blame-tree">
          <GitFileTree
            root={projectPath}
            selectedPath={filePath}
            onSelect={(absPath, isDirectory) => {
              if (!isDirectory) void loadFile(absPath)
            }}
          />
        </div>
        <div className="git-resizer" onMouseDown={startDrag} title="Drag to resize sidebar" />
      </div>

      <div className="git-blame-content-panel">
        {filePath && (
          <div className="git-diff-header">
            <FileText size={14} className="git-diff-header-icon" aria-hidden="true" />
            <span className="git-diff-header-path" title={filePath}>
              {relativeFileName || filePath}
            </span>
          </div>
        )}

        <div className="git-blame-content-body">
          {error && <div className="git-error-banner">{error}</div>}
          {loading && (
            <div className="git-diff-placeholder">
              <div className="git-placeholder-title">Loading blame annotations...</div>
            </div>
          )}
          {!loading && !error && !filePath && (
            <div className="git-diff-placeholder">
              <FileCode size={32} className="git-placeholder-icon" aria-hidden="true" />
              <div className="git-placeholder-title">Select a file for Git Blame</div>
              <div className="git-placeholder-sub">
                Click any file in the workspace file tree on the left to view git blame annotations and line author history.
              </div>
            </div>
          )}
          {!loading && !error && filePath && (
            <div className="git-blame-table-wrap">
              <table className="git-blame-code">
                <tbody>
                  {content.map((line, i) => {
                    const b = blameByLine.get(i + 1)
                    return (
                      <tr key={i} className="git-blame-line-row">
                        <td
                          className="git-blame-cell"
                          title={b ? `${b.summary} — ${b.author}, ${fmtBlameDate.format(new Date(b.authorTime * 1000))}` : undefined}
                        >
                          {b ? (
                            <div className="git-blame-meta-cell">
                              <span className="git-blame-sha">{b.shortSha}</span>
                              <span className="git-blame-author" title={b.author}>{b.author}</span>
                              <span className="git-blame-date">{fmtBlameDate.format(new Date(b.authorTime * 1000))}</span>
                            </div>
                          ) : (
                            <div className="git-blame-meta-cell uncommitted">
                              <span className="git-blame-uncommitted">uncommitted</span>
                            </div>
                          )}
                        </td>
                        <td className="git-blame-lineno">{i + 1}</td>
                        <td className="git-blame-line">{line}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
