import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  checkRows,
  CliStatusCard,
  type CliStatusCardProps,
  installCommandText
} from '../../src/renderer/src/components/settings/CliAgentsTab'
import type { CliCheckResult } from '../../src/shared/types'

const install = { command: 'bash', args: ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'] }

const ready: CliCheckResult = {
  installed: true,
  binaryPath: '/usr/local/bin/agy',
  version: '1.6.0',
  minVersion: '1.5.0',
  ready: true,
  install
}

const missing: CliCheckResult = {
  installed: false,
  binaryPath: null,
  version: null,
  minVersion: '1.5.0',
  ready: false,
  error: 'agy was not found',
  install
}

const outdated: CliCheckResult = { ...ready, version: '1.4.0', ready: false, error: 'Version 1.4.0 is older than the required 1.5.0.' }

function render(props: Partial<CliStatusCardProps>): string {
  const noop = () => {}
  return renderToStaticMarkup(createElement(CliStatusCard, {
    check: null,
    test: null,
    checking: false,
    testing: false,
    copied: false,
    onCheck: noop,
    onTest: noop,
    onCopyInstall: noop,
    onOpenDocs: noop,
    ...props
  }))
}

describe('checkRows', () => {
  it('shows a single pending row before the first check returns', () => {
    expect(checkRows(null, null, false).map(r => [r.label, r.state])).toEqual([['Installed', 'pending']])
  })

  it('stops at the install row when agy is missing', () => {
    expect(checkRows(missing, null, false).map(r => [r.label, r.state])).toEqual([['Installed', 'err']])
  })

  it('flags an outdated version and hides the test row', () => {
    expect(checkRows(outdated, null, false).map(r => [r.label, r.state])).toEqual([
      ['Installed', 'ok'], ['Version', 'err']
    ])
  })

  it('tracks the test run through pending, passed and failed', () => {
    const state = (rows: ReturnType<typeof checkRows>) => rows[2].state
    expect(state(checkRows(ready, null, false))).toBe('pending')
    expect(state(checkRows(ready, null, true))).toBe('pending')
    expect(state(checkRows(ready, { ok: true, text: 'OK', durationMs: 3200 }, false))).toBe('ok')
    expect(state(checkRows(ready, { ok: false, text: '', error: 'boom', durationMs: 10 }, false))).toBe('err')
  })
})

describe('CliStatusCard', () => {
  it('renders a ready install with an enabled test button', () => {
    const markup = render({ check: ready })
    expect(markup).toContain('Ready')
    expect(markup).toContain('/usr/local/bin/agy')
    expect(markup).toContain('1.6.0')
    expect(markup).not.toContain('cli-install-box')
    expect(markup).toMatch(/<button type="button" class="btn sm">.*Run test/)
  })

  it('renders the install command and disables the test when agy is missing', () => {
    const markup = render({ check: missing })
    expect(markup).toContain('Not ready')
    expect(markup).toContain('cli-install-box')
    expect(markup).toContain('install.sh')
    expect(markup).toMatch(/<button type="button" class="btn sm" disabled="">.*Run test/)
  })

  it('shows the failed test output with the sign-in hint', () => {
    const markup = render({ check: ready, test: { ok: false, text: '', error: 'Not signed in', durationMs: 900 } })
    expect(markup).toContain('Not signed in')
    expect(markup).toContain('sign in there')
  })

  it('shows the reply of a passed test', () => {
    const markup = render({ check: ready, test: { ok: true, text: 'OK', durationMs: 3200 } })
    expect(markup).toContain('Passed in 3.2s')
    expect(markup).toContain('<pre class="cli-test-output">OK</pre>')
  })
})

describe('installCommandText', () => {
  it('joins the command and its arguments', () => {
    expect(installCommandText(missing)).toBe('bash -c curl -fsSL https://antigravity.google/cli/install.sh | bash')
  })
})
