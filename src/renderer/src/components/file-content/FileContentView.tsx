import { useState, useEffect, useCallback, useMemo } from 'react'
import { Save, Check } from 'lucide-react'
import CodeMirror, { Extension } from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
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
export default function FileContentView({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [editedContent, setEditedContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRawMd, setShowRawMd] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isImage = imageMimeType(ext) !== null
  const isMarkdown = !isImage && (ext === 'md' || ext === 'markdown')

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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [save])

  const copy = useCallback(async () => {
    const textToCopy = editedContent ?? content
    if (textToCopy) await navigator.clipboard.writeText(textToCopy)
  }, [editedContent, content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <>
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setShowRawMd(v => !v)}>
              {showRawMd ? 'Markdown Preview' : 'Edit Source'}
            </button>
          )}
          {!isImage && (
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
          <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          {!isImage && (
            <button className="btn small" onClick={() => void copy()} disabled={editedContent === null}>Copy</button>
          )}
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
