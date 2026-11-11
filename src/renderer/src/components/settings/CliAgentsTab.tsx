import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Play, RefreshCw } from 'lucide-react'
import type { CliCheckResult, CliTestResult } from '@shared/types'

type RowState = 'ok' | 'err' | 'pending'

interface Row {
  label: string
  state: RowState
  value: React.ReactNode
}

function mark(state: RowState): string {
  return state === 'ok' ? '✓' : state === 'err' ? '✕' : '•'
}

export function installCommandText(check: CliCheckResult): string {
  return `${check.install.command} ${check.install.args.join(' ')}`
}

export function checkRows(check: CliCheckResult | null, test: CliTestResult | null, testing: boolean): Row[] {
  if (!check) {
    return [{ label: 'Installed', state: 'pending', value: 'Checking…' }]
  }
  const rows: Row[] = [
    check.installed
      ? { label: 'Installed', state: 'ok', value: <code>{check.binaryPath}</code> }
      : { label: 'Installed', state: 'err', value: 'agy was not found on this machine.' }
  ]
  if (check.installed) {
    rows.push(check.ready
      ? { label: 'Version', state: 'ok', value: `${check.version} (needs ${check.minVersion} or newer)` }
      : { label: 'Version', state: 'err', value: check.error ?? `Needs ${check.minVersion} or newer.` })
  }
  if (check.ready) {
    if (testing) {
      rows.push({ label: 'Test run', state: 'pending', value: 'Running a one-line prompt…' })
    } else if (!test) {
      rows.push({ label: 'Test run', state: 'pending', value: 'Not run yet. It confirms that agy is signed in and can answer.' })
    } else if (test.ok) {
      rows.push({ label: 'Test run', state: 'ok', value: `Passed in ${(test.durationMs / 1000).toFixed(1)}s` })
    } else {
      rows.push({ label: 'Test run', state: 'err', value: 'Failed. See the output below.' })
    }
  }
  return rows
}

export interface CliStatusCardProps {
  check: CliCheckResult | null
  test: CliTestResult | null
  checking: boolean
  testing: boolean
  copied: boolean
  onCheck: () => void
  onTest: () => void
  onCopyInstall: () => void
  onOpenDocs: () => void
}

export function CliStatusCard({
  check, test, checking, testing, copied, onCheck, onTest, onCopyInstall, onOpenDocs
}: CliStatusCardProps) {
  const ready = Boolean(check?.ready)
  return (
    <div className="cli-runtime-card">
      <div className="cli-runtime-top">
        <div className="cli-runtime-logo">agy</div>
        <div className="cli-runtime-info">
          <div className="cli-runtime-name">Antigravity CLI</div>
          <div className="cli-runtime-sub">Uses the agy install and sign-in already on this machine</div>
        </div>
        {check && (
          <span className={`cli-pill ${ready ? 'ok' : 'err'}`}>
            <span className="cli-dot" /> {ready ? 'Ready' : 'Not ready'}
          </span>
        )}
      </div>

      <ul className="cli-check-list">
        {checkRows(check, test, testing).map(row => (
          <li key={row.label} className={`cli-check-row ${row.state}`}>
            <span className="cli-check-mark" aria-hidden="true">{mark(row.state)}</span>
            <span className="cli-check-label">{row.label}</span>
            <span className="cli-check-value">{row.value}</span>
          </li>
        ))}
      </ul>

      {test && !testing && (test.error || test.text) && (
        <pre className="cli-test-output">{test.ok ? test.text : (test.error ?? test.text)}</pre>
      )}
      {test && !test.ok && !testing && (
        <p className="settings-hint">
          If the output mentions signing in, run <code>agy</code> once in a terminal, sign in there, then run the test again.
        </p>
      )}

      <div className="cli-runtime-actions">
        <button type="button" className="btn sm" onClick={onCheck} disabled={checking || testing}>
          <RefreshCw size={12} style={{ marginRight: '0.25rem' }} /> {checking ? 'Checking…' : 'Check again'}
        </button>
        <button type="button" className="btn sm" onClick={onTest} disabled={!ready || checking || testing}>
          <Play size={12} style={{ marginRight: '0.25rem' }} /> {testing ? 'Testing…' : 'Run test'}
        </button>
        <button type="button" className="btn sm ghost" onClick={onOpenDocs}>
          CLI docs <ExternalLink size={12} style={{ marginLeft: '0.25rem' }} />
        </button>
      </div>

      {check && !check.installed && (
        <div className="cli-install-box">
          <span>Install it by running this in a terminal, then click Check again:</span>
          <div className="cli-install-cmd">
            <code>{installCommandText(check)}</code>
            <button type="button" className="btn sm" onClick={onCopyInstall}>
              {copied
                ? <>Copied <Check size={12} style={{ marginLeft: '0.25rem' }} /></>
                : <>Copy <Copy size={12} style={{ marginLeft: '0.25rem' }} /></>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const DOCS_URL = 'https://antigravity.google/docs'

export default function CliAgentsTab() {
  const [check, setCheck] = useState<CliCheckResult | null>(null)
  const [test, setTest] = useState<CliTestResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [copied, setCopied] = useState(false)

  const runCheck = useCallback(async () => {
    setChecking(true)
    try {
      setCheck(await window.api.checkCli())
      setTest(null)
    } finally {
      setChecking(false)
    }
  }, [])

  const runTest = useCallback(async () => {
    setTesting(true)
    try {
      setTest(await window.api.testCli())
    } catch (err) {
      setTest({ ok: false, text: '', error: err instanceof Error ? err.message : String(err), durationMs: 0 })
    } finally {
      setTesting(false)
    }
  }, [])

  useEffect(() => { void runCheck() }, [runCheck])

  return (
    <div className="cli-agents-tab">
      <p className="settings-hint">
        Meow can hand a task to the Antigravity CLI with the <code>delegate_cli</code> tool, the same way it
        delegates to another session: just ask for it in chat. There is nothing to configure here. This page
        only checks that this machine is ready.
      </p>
      <CliStatusCard
        check={check}
        test={test}
        checking={checking}
        testing={testing}
        copied={copied}
        onCheck={() => void runCheck()}
        onTest={() => void runTest()}
        onCopyInstall={() => {
          if (!check) return
          void navigator.clipboard.writeText(installCommandText(check))
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        onOpenDocs={() => void window.api.browserOpenExternal(check?.install.docUrl ?? DOCS_URL)}
      />
    </div>
  )
}
