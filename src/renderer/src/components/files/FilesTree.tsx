import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import type { DirEntry, GitStatusDetail, ProjectSearchHit } from '@shared/types'
import FileContextMenu, { type FileMenuState } from '../FileContextMenu'
import { filterTree, type TreeFilterNode } from './tree-filter'
import { joinProjectPath } from './file-path'
import FileIcon from './file-icon'
import {
  EMPTY_GIT_DECORATIONS, buildGitDecorations, decorationFor, directoryDecoration,
  projectRelativePath, type GitDecoration, type GitDecorations
} from './git-decorations'

interface Props {
  projectPath: string
  query: string
  activePath: string | null
  onOpenFile: (absPath: string) => void
  /** Double click: open permanent, or promote the preview tab. */
  onOpenFilePermanent: (absPath: string) => void
  reloadToken: number
  collapseToken: number
}

interface NodeData {
  loaded: boolean
  loading: boolean
  error: string | null
  expanded: boolean
  children: DirEntry[]
}

const emptyNode = (): NodeData => ({ loaded: false, loading: false, error: null, expanded: false, children: [] })

export default function FilesTree({ projectPath, query, activePath, onOpenFile, onOpenFilePermanent, reloadToken, collapseToken }: Props) {
  const [root, setRoot] = useState<NodeData>({ ...emptyNode(), expanded: true })
  const [nodes, setNodes] = useState<Record<string, NodeData>>({})
  const [hits, setHits] = useState<ProjectSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState<FileMenuState | null>(null)
  const [decorations, setDecorations] = useState<GitDecorations>(EMPTY_GIT_DECORATIONS)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gitRequestRef = useRef(0)
  const mountedRef = useRef(true)

  const load = useCallback(async (absPath: string) => {
    setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loading: true, error: null } }))
    try {
      const children = await window.api.filesListDir(projectPath, absPath)
      setNodes(prev => ({ ...prev, [absPath]: { ...(prev[absPath] ?? emptyNode()), loaded: true, loading: false, children } }))
    } catch (err) {
      setNodes(prev => ({
        ...prev,
        [absPath]: {
          ...(prev[absPath] ?? emptyNode()), loading: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }))
    }
  }, [projectPath])

  // StrictMode runs effects twice: set it on setup so the second pass still paints.
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refreshGit = useCallback(async () => {
    const token = ++gitRequestRef.current
    let detail: GitStatusDetail | null = null
    try {
      detail = await window.api.gitGetStatusDetail(projectPath)
    } catch {
      // Not a repository (or git failed): no decorations, no error.
      detail = null
    }
    // A late answer for a previous project, or after unmount, must not paint.
    if (!mountedRef.current || token !== gitRequestRef.current) return
    setDecorations(buildGitDecorations(detail))
  }, [projectPath])

  const refreshRoot = useCallback(async () => {
    try {
      const children = await window.api.filesListDir(projectPath, projectPath)
      setRoot(prev => ({ ...prev, loaded: true, loading: false, error: null, children }))
    } catch (err) {
      setRoot(prev => ({
        ...prev, loaded: true, loading: false,
        error: err instanceof Error ? err.message : String(err)
      }))
    }
  }, [projectPath])

  useEffect(() => {
    setNodes({})
    setHits([])
    setRoot({ ...emptyNode(), expanded: true })
    setDecorations(EMPTY_GIT_DECORATIONS)
    void refreshRoot()
    void refreshGit()
  }, [refreshRoot, refreshGit])

  useEffect(() => {
    if (reloadToken === 0) return
    void refreshRoot()
    void refreshGit()
    for (const [absPath, node] of Object.entries(nodes)) {
      if (node.loaded) void load(absPath)
    }
  }, [reloadToken])

  useEffect(() => {
    if (collapseToken === 0) return
    setNodes(prev => {
      const next: Record<string, NodeData> = {}
      for (const [key, value] of Object.entries(prev)) next[key] = { ...value, expanded: false }
      return next
    })
  }, [collapseToken])

  // Auto-refresh expanded directories after file changes (debounced), matching
  // the parked right-panel tree.
  useEffect(() => {
    const off = window.api.onContextChanged(({ projectPath: changed }) => {
      if (changed !== projectPath) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        // One status fetch per debounced burst, not one per changed path.
        void refreshGit()
        void refreshRoot()
        for (const [absPath, node] of Object.entries(nodes)) {
          if (node.expanded && node.loaded) void load(absPath)
        }
      }, 500)
    })
    return () => {
      off()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [projectPath, nodes, refreshRoot, load, refreshGit])

  const contentQuery = query.trim().startsWith('?') ? query.trim().slice(1).trim() : ''
  const nameQuery = contentQuery ? '' : query

  useEffect(() => {
    if (!contentQuery) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    let alive = true
    const timer = setTimeout(() => {
      window.api.filesSearch(projectPath, contentQuery)
        .then(result => { if (alive) setHits(result) })
        .catch(() => { if (alive) setHits([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [contentQuery, projectPath])

  const filtered = useMemo(() => {
    if (!nameQuery.trim()) return []
    const loadedChildren: Record<string, DirEntry[]> = {}
    for (const [absPath, node] of Object.entries(nodes)) {
      if (node.loaded) loadedChildren[absPath] = node.children
    }
    return filterTree(root.children, loadedChildren, nameQuery)
  }, [root.children, nodes, nameQuery])

  const toggle = useCallback((entry: DirEntry) => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path)
      return
    }
    const node = nodes[entry.path]
    // Lazy-load on first expand; read from render-state closure to stay pure.
    if (!node || (!node.expanded && !node.loaded && !node.loading)) void load(entry.path)
    setNodes(prev => {
      const current = prev[entry.path] ?? emptyNode()
      return { ...prev, [entry.path]: { ...current, expanded: !current.expanded } }
    })
  }, [nodes, load, onOpenFile])

  // Git paths are project-relative with forward slashes; tree entries are absolute.
  const decorationOf = (entry: DirEntry): GitDecoration | null => {
    const rel = projectRelativePath(projectPath, entry.path)
    return entry.isDirectory ? directoryDecoration(decorations, rel) : decorationFor(decorations, rel)
  }

  const row = (entry: DirEntry, depth: number, expandable: boolean) => {
    const decoration = decorationOf(entry)
    return (
      <div
        key={entry.path}
        className={`tree-row files-tree-row${entry.path === activePath ? ' active' : ''}`}
        style={{ paddingLeft: `${0.666667 + depth * 0.75}rem` }}
        title={entry.path}
        onClick={() => toggle(entry)}
        onDoubleClick={() => { if (!entry.isDirectory) onOpenFilePermanent(entry.path) }}
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, absPath: entry.path })
        }}
      >
        <span className="tree-chevron">
          {expandable && (
            <ChevronRight
              size={10}
              aria-hidden="true"
              style={{
                transform: nodes[entry.path]?.expanded ? 'rotate(90deg)' : undefined,
                transition: 'transform 120ms ease'
              }}
            />
          )}
        </span>
        {entry.isDirectory
          ? <Folder size={13} fill="currentColor" aria-hidden="true" className="tree-icon folder" />
          : <FileIcon name={entry.name} className="tree-icon" />}
        <span className={`tree-name${decoration ? ` files-git-${decoration.kind}` : ''}`}>{entry.name}</span>
        {decoration && (entry.isDirectory
          ? <span className={`files-git-dot files-git-${decoration.kind}`} aria-hidden="true" />
          : <span className={`files-git-letter files-git-${decoration.kind}`} aria-hidden="true">{decoration.letter}</span>)}
      </div>
    )
  }

  const rows = (entries: DirEntry[], depth: number): React.ReactNode[] =>
    entries.map(entry => {
      const node = nodes[entry.path]
      if (!entry.isDirectory || !node?.expanded) return row(entry, depth, entry.isDirectory)
      return (
        <div key={entry.path}>
          {row(entry, depth, true)}
          {node.error ? (
            <div className="tree-row tree-dim tree-error" style={{ paddingLeft: `${1.416667 + depth * 0.75}rem` }}>
              {node.error}
            </div>
          ) : node.children.length === 0 ? (
            <div className="tree-row tree-dim" style={{ paddingLeft: `${1.416667 + depth * 0.75}rem` }}>
              {node.loading ? 'Loading…' : 'Empty'}
            </div>
          ) : (
            rows(node.children, depth + 1)
          )}
        </div>
      )
    })

  const filteredRows = (list: TreeFilterNode[]): React.ReactNode[] =>
    list.map(node => (
      <div key={node.entry.path}>
        {row(node.entry, 0, node.children.length > 0)}
        {node.children.map(child => row(child.entry, 1, false))}
      </div>
    ))

  return (
    <div className="tree files-tree">
      {contentQuery ? (
        searching ? (
          <div className="tree-row tree-dim">Searching…</div>
        ) : hits.length === 0 ? (
          <div className="tree-row tree-dim">No matches</div>
        ) : (
          hits.map(hit => (
            <div
              key={`${hit.path}:${hit.line}`}
              className={`tree-row files-tree-row${joinProjectPath(projectPath, hit.path) === activePath ? ' active' : ''}`}
              title={`${hit.path}:${hit.line}`}
              onClick={() => onOpenFile(joinProjectPath(projectPath, hit.path))}
            >
              <span className="tree-chevron" />
              <FileIcon name={hit.path.split('/').pop() ?? hit.path} className="tree-icon" />
              <span className="tree-name">{hit.path.split('/').pop()}</span>
              <span className="files-hit-line">{hit.line}</span>
              <span className="files-hit-text">{hit.text}</span>
            </div>
          ))
        )
      ) : nameQuery.trim() ? (
        filtered.length === 0 ? (
          <div className="tree-row tree-dim">No matches</div>
        ) : (
          filteredRows(filtered)
        )
      ) : root.error ? (
        <div className="tree-row tree-dim tree-error">{root.error}</div>
      ) : !root.loaded ? (
        <div className="tree-row tree-dim">Loading…</div>
      ) : (
        rows(root.children, 0)
      )}
      <FileContextMenu menu={menu} onClose={() => setMenu(null)} showCopyPath />
    </div>
  )
}
