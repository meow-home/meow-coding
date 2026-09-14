import { useState, useEffect, useCallback } from 'react'
import { Save, FileText, Check } from 'lucide-react'
import { imageMimeType } from '@shared/image'
import MarkdownText from '../chat/MarkdownText'
import { isHighlightable, preloadLanguage, highlightCode } from '../chat/highlight'
import { baseName } from '../files/file-path'

interface Props {
  path: string
  root: string
}

// Toolbar + body of the file viewer, shared by the popup FileViewer window and
// the Files overlay tab. The host supplies the flex container.
export default function FileContentView({ path: filePath, root }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [editedContent, setEditedContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isImage = imageMimeType(ext) !== null
  const isMarkdown = !isImage && (ext === 'md' || ext === 'markdown')
  const code = !isImage && isHighlightable(ext)

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
    const prep = code ? preloadLanguage(ext) : Promise.resolve()
    window.api.getFileContent(filePath)
      .then(async r => {
        let html: string | null = null
        if (code) {
          try {
            await prep
            html = await highlightCode(r.content, ext)
          } catch {
            html = null
          }
        }
        if (!alive) return
        setContent(r.content)
        setEditedContent(r.content)
        setRaw(false)
        setHighlighted(html)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath, ext, code, isImage])

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
        if (code) {
          try {
            const html = await highlightCode(editedContent, ext)
            setHighlighted(html)
          } catch {
            setHighlighted(null)
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }, [editedContent, isDirty, isSaving, filePath, code, ext])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  const copy = useCallback(async () => {
    const textToCopy = editedContent ?? content
    if (textToCopy) await navigator.clipboard.writeText(textToCopy)
  }, [editedContent, content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const val = target.value
      const next = val.substring(0, start) + '  ' + val.substring(end)
      setEditedContent(next)
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2
      }, 0)
    }
  }

  return (
    <>
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Markdown Preview' : 'Edit Source'}
            </button>
          )}
          {code && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Highlight Preview' : 'Edit Source'}
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
      
      <div className={`viewer-body${isImage ? ' viewer-body--image' : code && !raw && highlighted ? ' viewer-body--flush' : ''}`}>
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
        ) : isMarkdown && !raw ? (
          <div className="viewer-md"><MarkdownText text={editedContent ?? content} onOpenFile={openLinkedFile} /></div>
        ) : code && !raw && highlighted ? (
          <div className="viewer-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <textarea
            className="viewer-textarea"
            value={editedContent ?? ''}
            onChange={e => setEditedContent(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Edit file content..."
            spellCheck={false}
          />
        )}
      </div>
    </>
  )
}
