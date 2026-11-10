import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, beforeEach } from 'vitest'
import CliLoginDialog, { extractFirstUrl, stripAnsi } from '../../src/renderer/src/components/settings/CliLoginDialog'
import CliAgentsTab from '../../src/renderer/src/components/settings/CliAgentsTab'
import SettingsDialog from '../../src/renderer/src/components/settings/SettingsDialog'
import type { CliAgentsStatus } from '../../src/shared/types'

describe('CliLoginDialog helpers', () => {
  it('stripAnsi removes ANSI escape sequences and normalizes newlines', () => {
    const raw = '\u001b[32m✓ Signed in\u001b[0m as user@example.com\r\n\u001b[1;34mPlan:\u001b[0m Pro\r'
    const clean = stripAnsi(raw)
    expect(clean).toBe('✓ Signed in as user@example.com\nPlan: Pro\n')
  })

  it('stripAnsi removes OSC sequences', () => {
    const raw = '\u001b]0;Login title\u0007Hello world'
    expect(stripAnsi(raw)).toBe('Hello world')
  })

  it('extractFirstUrl finds the first http/https link in output', () => {
    const text = 'Please open https://accounts.google.com/o/oauth2/v2/auth?client_id=123 in your browser, or see http://example.com'
    expect(extractFirstUrl(text)).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=123')
  })

  it('extractFirstUrl returns null when no URL is present', () => {
    expect(extractFirstUrl('Waiting for authorization code...')).toBeNull()
  })
})

describe('CliLoginDialog rendering', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = (globalThis as any).window || {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.api = {
      onCliLogin: () => () => {},
      onCliAgentsChanged: () => () => {},
      getCliAgentsStatus: async () => ({
        runtimes: {
          antigravity: { enabled: true, binaryPath: null },
          opencode: { enabled: true, binaryPath: null }
        },
        agents: []
      }),
      cliLoginInput: async () => {},
      cancelCliLogin: async () => {},
      browserOpenExternal: async () => {}
    }
  })

  it('renders login modal with terminal area and form', () => {
    const markup = renderToStaticMarkup(
      createElement(CliLoginDialog, {
        loginId: 'clil_test_1',
        runtime: 'antigravity',
        label: 'Antigravity Google Sign-in',
        onClose: () => {}
      })
    )

    expect(markup).toContain('Sign in to Antigravity Google Sign-in')
    expect(markup).toContain('cli-login-terminal')
    expect(markup).toContain('Waiting for login session output')
    expect(markup).toContain('cli-login-input')
    expect(markup).toContain('Send')
    expect(markup).toContain('Cancel')
  })

  it('renders OpenCode runtime title when no label is provided', () => {
    const markup = renderToStaticMarkup(
      createElement(CliLoginDialog, {
        loginId: 'clil_test_2',
        runtime: 'opencode',
        onClose: () => {}
      })
    )

    expect(markup).toContain('Sign in to OpenCode')
  })
})

describe('CliAgentsTab rendering', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = (globalThis as any).window || {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.api = {
      getCliAgentsStatus: async (): Promise<CliAgentsStatus> => ({
        runtimes: {
          antigravity: {
            enabled: true,
            binaryPath: 'C:\\tools\\agy.exe',
            version: '1.5.4',
            maxConcurrent: 2
          },
          opencode: {
            enabled: true,
            binaryPath: 'C:\\npm\\opencode.cmd',
            version: '2.2.7',
            maxConcurrent: 3
          }
        },
        agents: [
          {
            id: 'cli_agent_1',
            runtime: 'antigravity',
            kind: 'google',
            label: 'Antigravity · Personal',
            email: 'user@gmail.com',
            plan: 'Google AI Pro',
            model: 'claude-sonnet-4-6',
            mode: 'edit',
            status: 'ready',
            active: true,
            createdAt: 1000
          },
          {
            id: 'cli_agent_2',
            runtime: 'opencode',
            kind: 'profile',
            label: 'OpenCode · Anthropic Work',
            provider: 'anthropic',
            profileDir: 'cli-profiles/opencode/oc_1',
            model: 'claude-sonnet-5-5',
            mode: 'edit',
            status: 'ready',
            createdAt: 2000
          }
        ],
        defaultAgentId: 'cli_agent_1',
        delegation: {
          allow: true,
          maxRounds: 3,
          maxNonterminalPerAgent: 5
        }
      }),
      listCliModels: async () => ['gemini-3.8-flash-high', 'claude-sonnet-4-6'],
      detectCliRuntime: async (runtime: string) => ({
        runtime,
        found: true,
        binaryPath: 'C:\\tools\\bin',
        version: '1.0.0',
        valid: true,
        minVersion: '1.0.0'
      }),
      installCliRuntime: async () => null,
      setCliRuntimePath: async () => {},
      setCliRuntimeEnabled: async () => {},
      addCliAgent: async () => ({ loginId: 'log_1' }),
      renameCliAgent: async () => {},
      removeCliAgent: async () => {},
      activateCliAgent: async () => ({}),
      setDefaultCliAgent: async () => {},
      createCliSession: async () => ({
        id: 'cs_1',
        agentId: 'cli_agent_1',
        projectPath: '',
        cwd: '',
        title: 'Session 1',
        status: 'idle',
        createdAt: 1000,
        updatedAt: 1000
      }),
      browserOpenExternal: async () => {},
      onCliAgentsChanged: () => () => {},
      onCliSessionsChanged: () => () => {},
      onCliLogin: () => () => {}
    }
  })

  it('renders initial loading state when status is null', () => {
    const markup = renderToStaticMarkup(createElement(CliAgentsTab))
    expect(markup).toContain('Loading CLI agents…')
  })

  it('renders SettingsDialog with CLI Agents tab item in navigation', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.api.getSettings = async () => ({
      version: 1,
      agents: [],
      providers: {},
      permission: { rules: [] },
      mcp: { servers: {} },
      compaction: { thresholdTokens: 1000 },
      toolOutput: { maxBytes: 1000 },
      maxSteps: 10,
      notifications: { needsInput: true, onDone: true }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.api.getMcpStatus = async () => []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.api.listProviderCatalog = async () => []

    const markup = renderToStaticMarkup(
      createElement(SettingsDialog, {
        onClose: () => {},
        initialTab: 'cli-agents'
      })
    )

    expect(markup).toContain('CLI Agents')
    expect(markup).toContain('Sub-agents')
    expect(markup).toContain('Intelligence')
  })
})
