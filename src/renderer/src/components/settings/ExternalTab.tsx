import { useCallback, useEffect, useState } from 'react'
import type { ExternalApiStatus } from '@shared/external-api-types'

export default function ExternalTab() {
  const [status, setStatus] = useState<ExternalApiStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [skillPath, setSkillPath] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.getExternalApiStatus()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(err => { if (!cancelled) setError(String(err)) })
    const unsub = window.api.onExternalApiStatus(setStatus)
    return () => { cancelled = true; unsub() }
  }, [])

  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try { await fn() } catch (err) { setError(String(err)) } finally { setBusy(false) }
  }, [])

  if (!status) return <div className="settings-tab external-tab">Loading…</div>

  const line = !status.enabled
    ? 'Disabled'
    : status.listening
      ? `Listening on 127.0.0.1:${status.port}`
      : `Not listening${status.error ? ` — ${status.error}` : ''}`

  return (
    <div className="settings-tab external-tab">
      <p className="settings-hint">
        Lets a local coding agent such as Claude Code delegate plan tasks to Meow through a loopback API.
        Requests need the token stored in the config file below.
      </p>
      <div className="settings-row">
        <span>Allow external delegation</span>
        <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setStatus(await window.api.setExternalApiEnabled(!status.enabled))
        })}>
          {status.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <div className="settings-row"><span>Status</span><span>{line}</span></div>
      <div className="settings-row"><span>Config file</span><code>{status.configPath}</code></div>
      <div className="settings-row"><span>CLI</span><code>{status.cliPath ?? '—'}</code></div>
      <div className="settings-row">
        <span>Token</span>
        <span>
          <button className="btn" disabled={busy} onClick={() => void act(async () => {
            await window.api.copyExternalApiToken()
            setNotice('Token copied to clipboard.')
          })}>Copy token</button>
          {' '}
          <button className="btn" disabled={busy} onClick={() => void act(async () => {
            setStatus(await window.api.regenerateExternalApiToken())
            setNotice(`Token regenerated at ${new Date().toLocaleTimeString()}. The CLI picks it up automatically; the old token is rejected.`)
          })}>Regenerate token</button>
        </span>
      </div>
      {notice && <div className="settings-hint">{notice}</div>}
      <div className="settings-row">
        <span>Claude skill</span>
        <button className="btn" disabled={busy} onClick={() => void act(async () => {
          setSkillPath(await window.api.installClaudeSkill())
        })}>Install Claude skill</button>
      </div>
      {skillPath && <div className="settings-hint">Installed to <code>{skillPath}</code></div>}
      {error && <div className="settings-error">{error}</div>}
    </div>
  )
}
