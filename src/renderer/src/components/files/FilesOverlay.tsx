import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, CircleX, Code, Copy, EllipsisVertical, Files, Folder,
  ListCollapse, Maximize2, Minimize2, RefreshCw, Search, X
} from 'lucide-react'
import FilesTree from './FilesTree'
import FileContentView from '../file-content/FileContentView'
import { baseName } from './file-path'

export const FILES_MIN_WIDTH = 320
export const FILES_MAX_WIDTH = 900
export const FILES_DEFAULT_WIDTH = 420

interface Props {
  projectPath: string
  full: boolean
  width: number
  onWidthChange: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
}

interface OpenFile {
  path: string
  name: string
}

export default function FilesOverlay({ projectPath, full, width, onWidthChange, onToggleFull, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(FILES_MAX_WIDTH, Math.max(FILES_MIN_WIDTH, dragRef.current.startWidth + delta))
      onWidthChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  const openFile = useCallback((absPath: string) => {
    setTabs(prev => (prev.some(t => t.path === absPath) ? prev : [...prev, { path: absPath, name: baseName(absPath) }]))
    setActiveTab(absPath)
  }, [])

  const closeTab = useCallback((absPath: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.path !== absPath)
      setActiveTab(current => (current === absPath ? (next[next.length - 1]?.path ?? null) : current))
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.activeElement === filterRef.current && query) {
        setQuery('')
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [query, onClose])

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <section
      className={`files-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : { width }}
      role="dialog"
      aria-label="Files"
    >
      {!full && <div className="files-resizer" onMouseDown={startDrag} />}
      <div className="files-head title-bar">
        <div className="files-head-title">
          <Files size={14} aria-hidden="true" />
          <span>Files</span>
        </div>
        <div className="files-head-actions">
          <button
            className="icon-btn"
            title="Focus filter"
            aria-label="Focus filter"
            onClick={() => filterRef.current?.focus()}
          >
            <Search size={14} aria-hidden="true" />
          </button>
          <div className="pane-menu" ref={menuRef}>
            <button
              className="icon-btn"
              title="Files menu"
              aria-label="Files menu"
              onClick={() => setMenuOpen(v => !v)}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="sidebar-menu-dropdown pane-menu-dropdown files-menu-dropdown">
                <button className="menu-item" onClick={() => { setMenuOpen(false); setReloadToken(v => v + 1) }}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Refresh
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setCollapseToken(v => v + 1) }}>
                  <ListCollapse size={16} aria-hidden="true" />
                  Collapse all
                </button>
                <button
                  className="menu-item"
                  disabled={tabs.length === 0}
                  onClick={() => { setMenuOpen(false); setTabs([]); setActiveTab(null) }}
                >
                  <CircleX size={16} aria-hidden="true" />
                  Close all tabs
                </button>
                <div className="menu-sep" aria-hidden="true" />
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void navigator.clipboard.writeText(activeTab) }}
                >
                  <Copy size={16} aria-hidden="true" />
                  Copy path
                </button>
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void window.api.showFileInFolder(activeTab) }}
                >
                  <ArrowUpRight size={16} aria-hidden="true" />
                  Reveal in Folder
                </button>
                <button
                  className="menu-item"
                  disabled={!activeTab}
                  onClick={() => { setMenuOpen(false); if (activeTab) void window.api.openFileInEditor(activeTab) }}
                >
                  <Code size={16} aria-hidden="true" />
                  Open in VS Code
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title={full ? 'Restore size' : 'Expand'}
            aria-label={full ? 'Restore size' : 'Expand'}
            onClick={onToggleFull}
          >
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Files" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="files-body">
        <div className="files-side">
          <div className="files-filter">
            <Search size={13} aria-hidden="true" />
            <input
              ref={filterRef}
              className="files-filter-input"
              placeholder="Filter files... (? for contents)"
              value={query}
              spellCheck={false}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <FilesTree
            projectPath={projectPath}
            query={query}
            activePath={activeTab}
            onOpenFile={openFile}
            reloadToken={reloadToken}
            collapseToken={collapseToken}
          />
        </div>
        <div className="files-main">
          {tabs.length > 0 && (
            <div className="files-tabs" role="tablist" aria-label="Open files">
              {tabs.map(tab => (
                <div key={tab.path} className={`files-tab${tab.path === activeTab ? ' active' : ''}`}>
                  <button
                    className="files-tab-name"
                    role="tab"
                    aria-selected={tab.path === activeTab}
                    title={tab.path}
                    onClick={() => setActiveTab(tab.path)}
                  >
                    {tab.name}
                  </button>
                  <button className="files-tab-close" aria-label={`Close ${tab.name}`} onClick={() => closeTab(tab.path)}>
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="files-content">
            {activeTab ? (
              <FileContentView key={activeTab} path={activeTab} root={projectPath} />
            ) : (
              <div className="files-empty">
                <Folder size={30} aria-hidden="true" />
                <div className="files-empty-title">Open files appear here</div>
                <div className="files-empty-hint">
                  Pick a file in the tree, or click a file path in the conversation.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
