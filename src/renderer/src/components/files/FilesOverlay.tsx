import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { beginOcclusion, endOcclusion } from '../common/useBrowserOcclusion'
import PanelHeader from '../common/PanelHeader'
import {
  ArrowUpRight, CircleX, Code, Copy, FileText, Folder,
  ListCollapse, MoreHorizontal, PanelRightClose, PanelRightOpen, RefreshCw, Search
} from 'lucide-react'
import BaseDropdown from '../common/BaseDropdown'
import ConfirmDialog from '../ConfirmDialog'
import FilesTree from './FilesTree'
import FileContentView from '../file-content/FileContentView'
import { baseName } from './file-path'

export const FILES_MIN_WIDTH = 320
export const FILES_MAX_WIDTH = 900
export const FILES_DEFAULT_WIDTH = 420
export const FILES_SIDE_MIN_WIDTH = 160
// The editor side keeps at least this much room when the tree is dragged wider.
export const FILES_MAIN_MIN_WIDTH = 160
const SIDE_WIDTH_KEY = 'meow.files.sideWidth'
const TREE_HIDDEN_KEY = 'meow.files.treeHidden'

function loadSideWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(SIDE_WIDTH_KEY))
    return Number.isFinite(v) && v >= FILES_SIDE_MIN_WIDTH ? v : null
  } catch {
    return null
  }
}

function saveSideWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(SIDE_WIDTH_KEY)
    else localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(width)))
  } catch {}
}

function loadTreeHidden(): boolean {
  try {
    return localStorage.getItem(TREE_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function saveTreeHidden(hidden: boolean): void {
  try {
    localStorage.setItem(TREE_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {}
}

interface Props {
  projectPath: string
  full: boolean
  width?: number
  onWidthChange?: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
}

interface OpenFile {
  path: string
  name: string
}

export default function FilesOverlay({ projectPath, full, width, onWidthChange, onToggleFull, onClose, onDirtyChange }: Props) {
  const [query, setQuery] = useState('')
  const [tabs, setTabs] = useState<OpenFile[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set())
  const [pendingClose, setPendingClose] = useState<string[] | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  // null = the CSS default (42% docked, 20rem expanded) until the user drags the splitter.
  const [sideWidth, setSideWidth] = useState<number | null>(loadSideWidth)
  const [treeHidden, setTreeHidden] = useState(loadTreeHidden)
  // The per-file bar is rendered by the active file, but it belongs above both
  // columns: FileContentView portals its toolbar into this host.
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null)
  const pendingFilterFocus = useRef(false)

  useEffect(() => { saveTreeHidden(treeHidden) }, [treeHidden])

  // Focusing the filter while the tree is hidden does nothing useful: the input
  // only exists on screen once the tree is shown again.
  useEffect(() => {
    if (!pendingFilterFocus.current || treeHidden) return
    pendingFilterFocus.current = false
    filterRef.current?.focus()
  }, [treeHidden])

  const focusFilter = useCallback(() => {
    if (!treeHidden) {
      filterRef.current?.focus()
      return
    }
    pendingFilterFocus.current = true
    setTreeHidden(false)
  }, [treeHidden])

  const startSideDrag = useCallback((e: React.MouseEvent) => {
    const side = sideRef.current
    const body = bodyRef.current
    if (!side || !body) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = side.getBoundingClientRect().width
    let latest: number | null = null
    const onMove = (ev: MouseEvent) => {
      const max = Math.max(FILES_SIDE_MIN_WIDTH, body.getBoundingClientRect().width - FILES_MAIN_MIN_WIDTH)
      // The tree sits on the right, so dragging left (a smaller clientX) widens it.
      latest = Math.min(max, Math.max(FILES_SIDE_MIN_WIDTH, startWidth + startX - ev.clientX))
      setSideWidth(latest)
    }
    const onUp = () => {
      endOcclusion('files-splitter')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('col-resizing')
      if (latest !== null) saveSideWidth(latest)
    }
    beginOcclusion('files-splitter', 'overlay')
    document.body.classList.add('col-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const resetSideWidth = useCallback(() => {
    setSideWidth(null)
    saveSideWidth(null)
  }, [])

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (!onWidthChange || width === undefined) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !onWidthChange) return
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

  const anyDirty = dirtyPaths.size > 0
  useEffect(() => {
    onDirtyChange?.(anyDirty)
  }, [anyDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const removeTabs = useCallback((paths: string[]) => {
    const removed = new Set(paths)
    setTabs(prev => {
      const next = prev.filter(t => !removed.has(t.path))
      setActiveTab(current => (current && removed.has(current) ? (next[next.length - 1]?.path ?? null) : current))
      return next
    })
    setDirtyPaths(prev => new Set([...prev].filter(p => !removed.has(p))))
  }, [])

  const requestClose = useCallback((paths: string[]) => {
    if (paths.some(p => dirtyPaths.has(p))) setPendingClose(paths)
    else removeTabs(paths)
  }, [dirtyPaths, removeTabs])

  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths(prev => {
      if (prev.has(path) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape must not discard unsaved edits, and it belongs to an open confirm dialog.
      if (pendingClose || dirtyPaths.size > 0) return
      if (document.activeElement === filterRef.current && query) {
        setQuery('')
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [query, onClose, pendingClose, dirtyPaths])

  // The per-file bar's right side: tree toggle and the Files menu. It renders in
  // the active tab's bar, and in the empty bar when no file is open.
  const barActions = (
    <>
      <button
        className={`icon-btn${treeHidden ? '' : ' active'}`}
        title="Toggle file tree"
        aria-label="Toggle file tree"
        aria-pressed={!treeHidden}
        onClick={() => setTreeHidden(v => !v)}
      >
        {treeHidden
          ? <PanelRightOpen size={14} aria-hidden="true" />
          : <PanelRightClose size={14} aria-hidden="true" />}
      </button>
      <div className="pane-menu">
        <BaseDropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
          menuClassName="sidebar-menu-dropdown pane-menu-dropdown files-menu-dropdown"
          trigger={(
            <button
              className="icon-btn"
              title="Files menu"
              aria-label="Files menu"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          )}
        >
          <button className="menu-item" onClick={() => { setMenuOpen(false); focusFilter() }}>
            <Search size={16} aria-hidden="true" />
            Focus filter
          </button>
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
            onClick={() => { setMenuOpen(false); requestClose(tabs.map(t => t.path)) }}
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
        </BaseDropdown>
      </div>
    </>
  )

  return (
    <section
      className={`files-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : (width !== undefined ? { width } : undefined)}
      role="dialog"
      aria-label="Files"
    >
      {!full && onWidthChange && width !== undefined && <div className="files-resizer" onMouseDown={startDrag} />}
      <PanelHeader
        ariaLabel="Open files"
        activeId={activeTab}
        onSelect={setActiveTab}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Files"
        onClose={onClose}
        tabs={tabs.map(tab => ({
          id: tab.path,
          className: 'files-open-tab',
          title: tab.path,
          lead: <FileText size={14} aria-hidden="true" />,
          label: tab.name,
          trail: dirtyPaths.has(tab.path)
            ? <span className="panel-tab-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />
            : undefined,
          closeLabel: `Close ${tab.name}`,
          onClose: () => requestClose([tab.path])
        }))}
      />
      <div className="files-bar-host" ref={setToolbarHost} />
      {toolbarHost && !activeTab && createPortal(
        <div className="viewer-toolbar files-bar">
          <span className="viewer-path" />
          <div className="viewer-actions">{barActions}</div>
        </div>,
        toolbarHost
      )}
      <div className="files-body" ref={bodyRef}>
        <div className="files-main">
          <div className="files-content">
            {/* Every open file stays mounted: unmounting on a tab switch would drop unsaved edits. */}
            {tabs.map(tab => (
              <div key={tab.path} className="files-tab-pane" hidden={tab.path !== activeTab}>
                <FileContentView
                  path={tab.path}
                  root={projectPath}
                  active={tab.path === activeTab}
                  hideFileActions
                  toolbarActions={tab.path === activeTab ? barActions : undefined}
                  toolbarHost={toolbarHost}
                  onDirtyChange={dirty => handleDirtyChange(tab.path, dirty)}
                />
              </div>
            ))}
            {!activeTab && (
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
        {/* Hidden, not unmounted: the tree keeps its expanded folders across a toggle. */}
        <div
          className="files-side"
          ref={sideRef}
          hidden={treeHidden}
          style={sideWidth !== null ? { flexBasis: sideWidth, maxWidth: `calc(100% - ${FILES_MAIN_MIN_WIDTH}px)` } : undefined}
        >
          <div
            className="files-side-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file tree"
            title="Drag to resize, double-click to reset"
            onMouseDown={startSideDrag}
            onDoubleClick={resetSideWidth}
          />
          <div className="files-filter">
            <Search size={13} aria-hidden="true" />
            <input
              ref={filterRef}
              className="files-filter-input"
              placeholder="Filter, or ? to search in files"
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
      </div>
      {pendingClose && (
        <ConfirmDialog
          title="Discard unsaved changes"
          message={pendingClose.length === 1
            ? `${baseName(pendingClose[0])} has unsaved changes. Close it and discard them?`
            : 'Some open files have unsaved changes. Close them and discard the changes?'}
          confirmLabel="Discard"
          onConfirm={() => { removeTabs(pendingClose); setPendingClose(null) }}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </section>
  )
}
