import { useCallback, useEffect, useState } from 'react'
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
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)

  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const isImage = imageMimeType(ext) !== null
  const isMarkdown = !isImage && (ext === 'md' || ext === 'markdown')
  const code = !isImage && isHighlightable(ext)

  useEffect(() => {
    if (isImage) {
      let alive = true
      // Images are returned as data URLs by main; the renderer never reads the
      // file itself.
      window.api.getFileImage(filePath)
        .then(r => { if (alive) setImage(r.dataUrl) })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
      return () => { alive = false }
    }
    let alive = true
    // Warm the highlighter + grammar while the content is read over IPC, so
    // the first highlight is near-instant and plain text never flashes.
    const prep = code ? preloadLanguage(ext) : Promise.resolve()
    window.api.getFileContent(filePath)
      .then(async r => {
        let html: string | null = null
        if (code) {
          try {
            await prep
            html = await highlightCode(r.content, ext)
          } catch {
            html = null // highlight failure → fall back to plain text
          }
        }
        if (!alive) return
        setContent(r.content)
        setRaw(false)
        setHighlighted(html)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [filePath, ext, code, isImage])

  const copy = useCallback(async () => {
    if (content) await navigator.clipboard.writeText(content)
  }, [content])

  const openLinkedFile = useCallback((p: string) => {
    void window.api.openFile({ path: p, root })
  }, [root])

  return (
    <>
      <div className="viewer-toolbar">
        <span className="viewer-path" title={filePath}>{filePath}</span>
        <div className="viewer-actions">
          {isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Markdown' : 'Raw'}
            </button>
          )}
          {code && !isMarkdown && (
            <button className="btn small" onClick={() => setRaw(v => !v)}>
              {raw ? 'Highlighted' : 'Raw'}
            </button>
          )}
          <button className="btn small" onClick={() => void window.api.openFileInEditor(filePath)}>Open in VS Code</button>
          {!isImage && (
            <button className="btn small" onClick={() => void copy()} disabled={!content}>Copy</button>
          )}
        </div>
      </div>
      {/* Full-bleed for highlighted code (VS Code look), fitted for images, padded for everything else. */}
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
          <div className="viewer-md"><MarkdownText text={content} onOpenFile={openLinkedFile} /></div>
        ) : code && !raw && highlighted ? (
          <div className="viewer-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="viewer-pre">{content}</pre>
        )}
      </div>
    </>
  )
}
