import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import type {
  CliAgent,
  CliRunEvent,
  CliSessionMeta,
  CliSessionStatus,
  CliTranscriptItem
} from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'
import ConfirmDialog from '../ConfirmDialog'
import MarkdownText from '../chat/MarkdownText'
import { describeCliStatus, describeCliToolInput, formatCliTime } from './transcript-helper'

interface Props {
  session: CliSessionMeta
  agent: CliAgent | null
  onDeleted?: () => void
}

export default function CliSessionPane({ session, agent, onDeleted }: Props) {
  const [status, setStatus] = useState<CliSessionStatus>(session.status)
  const [title, setTitle] = useState(session.title)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameInput, setRenameInput] = useState(session.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [items, setItems] = useState<CliTranscriptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setStatus(session.status)
  }, [session.status])

  useEffect(() => {
    setTitle(session.title)
    setRenameInput(session.title)
  }, [session.title])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api
      .getCliTranscript(session.id)
      .then(res => {
        if (!cancelled) {
          setItems(res)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session.id])

  useEffect(() => {
    return window.api.onCliRun((e: CliRunEvent) => {
      if (e.sessionId !== session.id) return
      if (e.status) {
        setStatus(e.status)
      }
      if (e.item) {
        setItems(prev => [...prev, e.item!])
      }
    })
  }, [session.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  const handleStop = useCallback(async () => {
    try {
      await window.api.cancelCliTask(session.id)
    } catch (err) {
      console.error(err)
    }
  }, [session.id])

  const handleRenameSubmit = useCallback(async () => {
    const next = renameInput.trim()
    setIsRenaming(false)
    if (!next || next === title) return
    setTitle(next)
    try {
      await window.api.renameCliSession(session.id, next)
    } catch {
      setTitle(title)
      setRenameInput(title)
    }
  }, [renameInput, title, session.id])

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false)
    try {
      await window.api.deleteCliSession(session.id)
      onDeleted?.()
    } catch (err) {
      console.error(err)
    }
  }, [session.id, onDeleted])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text || status !== 'idle' || agent?.status !== 'ready' || isSending) return
    setInputText('')
    setIsSending(true)
    setStatus('running')
    try {
      await window.api.sendCliTask(session.id, text)
    } catch (err) {
      console.error(err)
      setStatus('failed')
    } finally {
      setIsSending(false)
    }
  }, [inputText, status, agent?.status, isSending, session.id])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const statusDesc = describeCliStatus(status)
  const runtimeChip = agent?.runtime === 'opencode' ? 'oc' : 'agy'
  const isSendDisabled = status !== 'idle' || agent?.status !== 'ready' || isSending || !inputText.trim()

  return (
    <div className="cli-session-pane">
      <header className="cli-session-header">
        <div className="cli-header-agent">
          <span className={`agent-chip ${runtimeChip}`}>{runtimeChip}</span>
          <span className="agent-label">{agent?.label ?? 'CLI Agent'}</span>
        </div>

        <div className="cli-header-title-box">
          {isRenaming ? (
            <input
              className="input cli-header-rename-input"
              autoFocus
              value={renameInput}
              onChange={e => setRenameInput(e.target.value)}
              onBlur={() => void handleRenameSubmit()}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleRenameSubmit()
                else if (e.key === 'Escape') {
                  setRenameInput(title)
                  setIsRenaming(false)
                }
              }}
            />
          ) : (
            <span className="cli-header-title" title={title}>{title}</span>
          )}
        </div>

        <span className={`cli-pill ${statusDesc.tone}`}>{statusDesc.label}</span>

        {agent?.model && (
          <span className="cli-model-chip" title={`Model: ${agent.model}`}>{agent.model}</span>
        )}

        <div className="cli-header-actions">
          <button
            type="button"
            className="btn sm"
            disabled={status !== 'running'}
            onClick={() => void handleStop()}
          >
            Stop
          </button>

          <BaseDropdown
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
            menuClassName="sidebar-menu-dropdown session-menu-dropdown"
            trigger={(
              <button
                type="button"
                className="icon-btn"
                title="Session menu"
                aria-label="Session menu"
              >
                <MoreVertical size={14} aria-hidden="true" />
              </button>
            )}
          >
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false)
                setIsRenaming(true)
              }}
            >
              <Pencil size={15} aria-hidden="true" />
              Rename
            </button>
            <div className="menu-sep" aria-hidden="true" />
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                setMenuOpen(false)
                setConfirmDelete(true)
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete
            </button>
          </BaseDropdown>
        </div>
      </header>

      <div className="chat-feed cli-feed">
        <div className="lane cli-lane">
          {items.length === 0 && !loading && (
            <div className="cli-empty-state">
              <h3>Give {agent?.label ?? 'this agent'} a task</h3>
              <p>Type a request below to run commands and make edits with {agent?.label ?? 'this CLI agent'}.</p>
            </div>
          )}

          {items.map((item, idx) => {
            if (item.kind === 'user') {
              return (
                <div key={idx} className="msg cli-msg user">
                  <div className="who">You · {formatCliTime(item.at)}</div>
                  <div className="bubble-user">{item.text}</div>
                </div>
              )
            }
            if (item.kind === 'assistant') {
              return (
                <div key={idx} className="msg cli-msg assistant">
                  <div className="who">{agent?.label ?? 'Assistant'} · {formatCliTime(item.at)}</div>
                  <div className="assistant">
                    <MarkdownText text={item.text} />
                  </div>
                </div>
              )
            }
            if (item.kind === 'tool') {
              const summary = describeCliToolInput(item.input)
              return (
                <details key={idx} className="cli-tool">
                  <summary className="cli-tool-head">
                    <span className={`g ${item.error ? 'fail' : 'ok'}`}>{item.error ? '✕' : '✓'}</span>
                    <span className="t">{item.tool}</span>
                    {summary && <code>{summary}</code>}
                    <span className="spacer" />
                    <span className="meta">{formatCliTime(item.at)}</span>
                  </summary>
                  <div className="cli-tool-body">
                    {item.input && Object.keys(item.input).length > 0 && (
                      <div className="cli-tool-section">
                        <span className="cli-tool-sec-label">Input</span>
                        <pre>{JSON.stringify(item.input, null, 2)}</pre>
                      </div>
                    )}
                    {item.output && (
                      <div className="cli-tool-section">
                        <span className="cli-tool-sec-label">Output</span>
                        <pre className="cli-tool-output">{item.output}</pre>
                      </div>
                    )}
                    {item.error && (
                      <div className="cli-tool-section">
                        <span className="cli-tool-sec-label">Error</span>
                        <pre className="cli-tool-error fail">{item.error}</pre>
                      </div>
                    )}
                  </div>
                </details>
              )
            }
            if (item.kind === 'notice') {
              return (
                <div key={idx} className={`cli-notice ${item.level}`}>
                  <span className="glyph">{item.level === 'warn' ? '⚠' : item.level === 'error' ? '✕' : 'ℹ'}</span>
                  <span className="text">{item.text}</span>
                  <span className="spacer" />
                  <span className="meta">{formatCliTime(item.at)}</span>
                </div>
              )
            }
            if (item.kind === 'result') {
              return (
                <div key={idx} className={`cli-result ${item.status === 'completed' ? 'ok' : 'err'}`}>
                  <div className="t">
                    <span>{item.status === 'completed' ? '✓ Task completed' : `✕ Task ${item.status}`}</span>
                    <span className="spacer" />
                    <span className="meta">{formatCliTime(item.at)}</span>
                  </div>
                  {item.text && (
                    <div className="cli-result-text">
                      <MarkdownText text={item.text} />
                    </div>
                  )}
                  <div className="stats">
                    {item.touchedFiles && item.touchedFiles.length > 0 && (
                      <span>{item.touchedFiles.length} file{item.touchedFiles.length === 1 ? '' : 's'} changed</span>
                    )}
                    {item.usage && (
                      <span>{(item.usage.input + item.usage.output).toLocaleString()} tokens</span>
                    )}
                    {item.deniedActions && item.deniedActions.length > 0 && (
                      <span className="denied-actions">
                        {item.deniedActions.length} blocked action{item.deniedActions.length === 1 ? '' : 's'}: {item.deniedActions.join(', ')}
                      </span>
                    )}
                  </div>
                  {item.text && (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => void navigator.clipboard.writeText(item.text)}
                      >
                        Copy result
                      </button>
                    </div>
                  )}
                </div>
              )
            }
            return null
          })}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer cli-composer">
        <div className="composer-inner cli-composer-inner">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            disabled={status !== 'idle' || agent?.status !== 'ready'}
            placeholder={
              agent?.status === 'needs-login'
                ? 'Agent requires login before taking tasks…'
                : `Give ${agent?.label ?? 'agent'} a task… (Enter to send, Shift+Enter for new line)`
            }
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {agent?.status === 'needs-login' && (
            <div className="cli-login-hint">
              <span>Agent needs sign-in. Open Settings → CLI Agents to log in.</span>
            </div>
          )}
          <div className="composer-foot">
            <span className="cli-composer-status">
              {status === 'running' ? 'Task in progress…' : status !== 'idle' ? `Session is ${status}` : ''}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="send"
              disabled={isSendDisabled}
              title="Send task"
              aria-label="Send task"
              onClick={() => void handleSend()}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete CLI session"
          message={`Are you sure you want to delete session "${title}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
