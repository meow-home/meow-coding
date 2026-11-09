import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Save, Check, FoldVertical, UnfoldVertical } from 'lucide-react'
import CodeMirror, { Extension } from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { foldAll, unfoldAll } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

import { imageMimeType } from '@shared/image'
import MarkdownText from '../chat/MarkdownText'
import { baseName } from '../files/file-path'

interface Props {
  path: string
  root: string
  /** False while the host keeps this file mounted behind another tab: Ctrl+S must not save it. */
  active?: boolean
  /** The host shows the unsaved state and file actions itself (the Files panel's tab and menu). */
  hideFileActions?: boolean
  /** Panel-specific buttons appended after the file actions (the Files panel's tree toggle and menu). */
  toolbarActions?: ReactNode
  onDirtyChange?: (dirty: boolean) => void
}

// The Files panel labels a file by its path inside the project; the popup window
// has no project root and keeps the absolute path.
function relativePath(root: string, absPath: string): string {
  const toPosix = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = toPosix(root)
  const target = toPosix(absPath)
  if (target === base) return baseName(target)
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : absPath
}

function getLanguageExtension(ext: string): Extension[] {
  switch (ext.toLowerCase()) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'json':
      return [json()]
    case 'html':
    case 'htm':
    case 'svg':
    case 'xml':
      return [html()]
    case 'css':
    case 'scss':
    case 'less':
      return [css()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'py':
      return [python()]
    default:
      return []
  }
}

// Toolbar + body of the file viewer, shared by the popup FileViewer window and
// the Files overlay tab. The host supplies the flex container.
export default function FileContentView({ path: filePath, root, active = true, hideFileActions = false, toolbarActions, onDirtyChange }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [editedContent, setEditedContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRawMd, setShowRawMd] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const editorRef = useRef<EditorView | null>(null)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isImage = imageMimeType(ext) !== null
  const isMarkdown = !isImage && (ext === 'md' || ext === 'markdown')
  const showsEditor = !isImage && !error && content !== null && !(isMarkdown && !showRawMd)

  const extensions = useMemo(() => getLanguageExtension(ext), [ext])

  useEffect(() => {
    if (isImage) {
      let alive = true
      window.api.getFileImage(filePath)
        .then(r => { if (alive) setImage(r.dataUrl) })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
      return () => { alive = false }
    }
    let alive = true
    window.api.getFileContent(filePath)
      .then(r => {
        if (!alive) return
        setContent(r.content)
        setEditedContent(r.content)
        setShowRawMd(false)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath, isImage])

  const isDirty = editedContent !== null && content !== null && editedContent !== content

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const save = useCallback(async () => {
    if (editedContent === null || !isDirty || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const res = await window.api.saveFileContent(filePath, editedContent)
      if (!res.ok) {
        setError(res.error || 'Failed to save file')
      } else {
        setContent(editedContent)
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }, [editedContent, isDirty, isSaving, filePath])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [save, active])

  const copy = useCallback(async () => {
    const textToCopy = editedContent ?? content
    if (textToCopy) await navigator.clipboard.writeText(textToCopy)
  }, [editedContent, content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <>
      <div className={hideFileActions ? 'viewer-toolbar files-bar' : 'viewer-toolbar'}>
        <span className="viewer-path" title={filePath}>
          {hideFileActions ? relativePath(root, filePath) : filePath}
        </span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setShowRawMd(v => !v)}>
              {showRawMd ? 'Markdown Preview' : 'Edit Source'}
            </button>
          )}
          {hideFileActions && showsEditor && (
            <>
              <button
                className="icon-btn"
                title="Fold all"
                aria-label="Fold all"
                onClick={() => { if (editorRef.current) foldAll(editorRef.current) }}
              >
                <FoldVertical size={14} aria-hidden="true" />
              </button>
              <button
                className="icon-btn"
                title="Unfold all"
                aria-label="Unfold all"
                onClick={() => { if (editorRef.current) unfoldAll(editorRef.current) }}
              >
                <UnfoldVertical size={14} aria-hidden="true" />
              </button>
            </>
          )}
          {!hideFileActions && !isImage && (
            <button
              className={`btn small ${isDirty ? 'primary' : ''}`}
              onClick={() => void save()}
              disabled={!isDirty || isSaving}
              title="Save changes (Ctrl+S)"
            >
              {justSaved ? (
                <>
                  <Check size={12} className="text-green" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  {isDirty && <span className="viewer-dirty-dot" />}
                  <Save size={12} />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </>
              )}
            </button>
          )}
          {!hideFileActions && (
            <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          )}
          {!hideFileActions && !isImage && (
            <button className="btn small" onClick={() => void copy()} disabled={editedContent === null}>Copy</button>
          )}
          {toolbarActions}
        </div>
      </div>
      
      <div className={`viewer-body${isImage ? ' viewer-body--image' : ''}`}>
        {isImage ? (
          error ? (
            <div className="viewer-image-error">
              <span>{error}</span>
              <button className="btn small" onClick={() => void window.api.openFileWithSystem(filePath)}>
                Open with OS app
              </button>
            </div>
          ) : image === null ? (
            <div className="viewer-loading">Loading…</div>
          ) : (
            <img className="viewer-image" src={image} alt={baseName(filePath)} />
          )
        ) : error ? (
          <div className="viewer-error">{error}</div>
        ) : content === null ? (
          <div className="viewer-loading">Loading…</div>
        ) : isMarkdown && !showRawMd ? (
          <div className="viewer-md"><MarkdownText text={editedContent ?? content} onOpenFile={openLinkedFile} /></div>
        ) : (
          <CodeMirror
            value={editedContent ?? ''}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            onCreateEditor={view => { editorRef.current = view }}
            onChange={(val) => setEditedContent(val)}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              tabSize: 2,
            }}
          />
        )}
      </div>
    </>
  )
}
