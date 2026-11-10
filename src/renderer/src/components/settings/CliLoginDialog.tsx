import { useState, useEffect, useRef, useCallback } from 'react'
import { ExternalLink, Send } from 'lucide-react'
import type { CliRuntimeId } from '@shared/types'
import BaseModal from '../common/BaseModal'

export interface CliLoginDialogProps {
  loginId: string
  runtime: CliRuntimeId
  agentId?: string
  label?: string
  onClose: () => void
}

export function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function extractFirstUrl(text: string): string | null {
  const match = /(https?:\/\/[^\s"'<>]+)/i.exec(text)
  return match ? match[1] : null
}

export default function CliLoginDialog({
  loginId,
  runtime,
  agentId,
  label,
  onClose
}: CliLoginDialogProps) {
  const [chunks, setChunks] = useState('')
  const [extractedUrl, setExtractedUrl] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const preRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const unsub = window.api.onCliLogin((e) => {
      if (e.loginId !== loginId) return
      setChunks(prev => {
        const next = prev + e.chunk
        if (!extractedUrl) {
          if (e.url) {
            setExtractedUrl(e.url)
          } else {
            const url = extractFirstUrl(e.chunk)
            if (url) setExtractedUrl(url)
          }
        }
        return next
      })
    })
    return unsub
  }, [loginId, extractedUrl])

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [chunks])

  useEffect(() => {
    const unsub = window.api.onCliAgentsChanged(async (e) => {
      try {
        const status = e.status ?? await window.api.getCliAgentsStatus()
        if (agentId) {
          const match = status.agents.find(a => a.id === agentId)
          if (match && match.status === 'ready') {
            onClose()
            return
          }
        }
      } catch {
        // ignore
      }
    })
    return unsub
  }, [agentId, onClose])

  const handleSend = useCallback(async () => {
    const text = inputValue
    if (!text.trim()) return
    setInputValue('')
    try {
      await window.api.cliLoginInput(loginId, text + '\n')
    } catch {
      // ignore
    }
  }, [inputValue, loginId])

  const handleCancel = useCallback(async () => {
    setIsCancelling(true)
    try {
      await window.api.cancelCliLogin(loginId)
    } catch {
      // ignore
    } finally {
      onClose()
    }
  }, [loginId, onClose])

  const handleOpenBrowser = useCallback(() => {
    if (extractedUrl) {
      void window.api.browserOpenExternal(extractedUrl)
    }
  }, [extractedUrl])

  const runtimeName = runtime === 'antigravity' ? 'Antigravity CLI' : 'OpenCode'
  const title = label ? `Sign in to ${label}` : `Sign in to ${runtimeName}`

  return (
    <BaseModal
      title={title}
      onClose={handleCancel}
      size="lg"
      className="cli-login-modal"
      actions={
        <button
          type="button"
          className="btn"
          disabled={isCancelling}
          onClick={handleCancel}
        >
          Cancel
        </button>
      }
    >
      <div className="cli-login-container">
        {runtime === 'antigravity' && (
          <div className="cli-notice warn">
            <span>Signing in here replaces the current Antigravity sign-in for this machine.</span>
          </div>
        )}
        {extractedUrl && (
          <div className="cli-login-url-banner">
            <span className="cli-login-url-text" title={extractedUrl}>
              {extractedUrl}
            </span>
            <button
              type="button"
              className="btn sm primary"
              onClick={handleOpenBrowser}
            >
              Open browser <ExternalLink size={13} style={{ marginLeft: '0.25rem' }} />
            </button>
          </div>
        )}
        <pre ref={preRef} className="cli-login-terminal">
          {stripAnsi(chunks) || 'Waiting for login session output…'}
        </pre>
        <form
          className="cli-login-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSend()
          }}
        >
          <input
            type="text"
            className="input cli-login-input"
            placeholder="Type input or paste authorization code…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="btn sm primary"
            disabled={!inputValue.trim()}
          >
            <Send size={13} style={{ marginRight: '0.25rem' }} /> Send
          </button>
        </form>
      </div>
    </BaseModal>
  )
}
