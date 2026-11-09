import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Square } from 'lucide-react'
import type { BrowserTabInfo } from '@shared/browser-types'
import { normalizeUrlInput } from './normalizeUrlInput'

interface Props {
  tab: BrowserTabInfo | null
  /** The agent owns the tab: navigation controls are disabled. */
  locked: boolean
  onBack: () => void
  onForward: () => void
  onReloadOrStop: () => void
  onNavigate: (url: string) => void
  onError: (message: string) => void
}

export default function BrowserToolbar({
  tab, locked, onBack, onForward, onReloadOrStop, onNavigate, onError
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const url = tab?.url ?? ''

  useEffect(() => {
    if (!editing) setDraft(url)
  }, [url, editing])

  // Ctrl/Cmd+L from a focused page: main already moved OS focus to the renderer.
  useEffect(() => window.api.onBrowserShortcut(({ action }) => {
    if (action !== 'focus-url') return
    const input = inputRef.current
    if (!input || input.disabled) return
    input.focus()
    input.select()
  }), [])

  const submit = (): void => {
    const normalized = normalizeUrlInput(draft)
    setEditing(false)
    if (!normalized) {
      setDraft(url)
      onError('Enter an http(s) URL.')
      return
    }
    onNavigate(normalized)
  }

  return (
    <div className="browser-toolbar">
      <button
        className="icon-btn"
        title="Back"
        aria-label="Back"
        disabled={!tab || locked || !tab.canGoBack}
        onClick={onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
      </button>
      <button
        className="icon-btn"
        title="Forward"
        aria-label="Forward"
        disabled={!tab || locked || !tab.canGoForward}
        onClick={onForward}
      >
        <ArrowRight size={14} aria-hidden="true" />
      </button>
      <button
        className="icon-btn"
        title={tab?.loading ? 'Stop' : 'Reload'}
        aria-label={tab?.loading ? 'Stop' : 'Reload'}
        disabled={!tab || locked}
        onClick={onReloadOrStop}
      >
        {tab?.loading ? <Square size={13} aria-hidden="true" /> : <RotateCw size={14} aria-hidden="true" />}
      </button>
      <input
        ref={inputRef}
        className="browser-url-input"
        type="text"
        spellCheck={false}
        aria-label="Address"
        placeholder="Enter a URL"
        title="Address"
        disabled={!tab || locked}
        value={editing ? draft : url}
        onFocus={() => {
          setEditing(true)
          setDraft(url)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') {
            setEditing(false)
            setDraft(url)
            inputRef.current?.blur()
          }
        }}
        onBlur={() => {
          setEditing(false)
          setDraft(url)
        }}
      />
    </div>
  )
}
