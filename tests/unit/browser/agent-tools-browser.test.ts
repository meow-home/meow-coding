import { describe, expect, it, vi } from 'vitest'
import { createBrowserTools } from '../../../src/main/agent/tools/browser'
import { ChromeBackend } from '../../../src/main/browser/chrome-backend'
import { BrowserRouter } from '../../../src/main/browser/browser-router'
import type { BrowserBackend, BrowserBridgeLike, BrowserLauncherLike } from '../../../src/main/browser/browser-backend'
import type { ToolContext } from '../../../src/main/agent/tools/types'
import type { BrowserCommandName } from '../../../src/shared/browser-types'

const ctx: ToolContext = { cwd: '/proj', ask: async () => null, agentId: 'agent-1' }

function fakeBridge(overrides: Partial<BrowserBridgeLike> = {}): BrowserBridgeLike & { calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }> } {
  const calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }> = []
  return {
    getStatus: () => ({ status: 'paired', port: 3927, paired: true }),
    execute: async (name, params) => {
      calls.push({ name, params })
      return { ok: true, data: { echoed: name } }
    },
    waitForPaired: async () => true,
    getConsoleLogs: () => [{ level: 'error', text: 'boom' }],
    getNetworkLogs: () => [{ method: 'GET', url: 'http://x' }],
    ...overrides,
    calls
  }
}

function fakeLauncher(overrides: Partial<BrowserLauncherLike> = {}): BrowserLauncherLike {
  return {
    openChrome: async () => {},
    openExtensionFolder: async () => {},
    showInstallGuide: async () => {},
    ...overrides
  }
}

function fakeBackend(overrides: Partial<BrowserBackend> = {}): {
  backend: BrowserBackend
  calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }>
  owners: string[]
} {
  const calls: Array<{ name: BrowserCommandName; params?: Record<string, unknown> }> = []
  const owners: string[] = []
  const backend: BrowserBackend = {
    start: async (call) => {
      owners.push(call.ownerId)
      return { output: 'browser paired (port 3927)' }
    },
    execute: async (name, params, call) => {
      calls.push({ name, params })
      owners.push(call.ownerId)
      return { ok: true, data: { echoed: name } }
    },
    getConsoleLogs: (call) => {
      owners.push(call.ownerId)
      return [{ level: 'error', text: 'boom' }]
    },
    getNetworkLogs: (call) => {
      owners.push(call.ownerId)
      return [{ method: 'GET', url: 'http://x' }]
    },
    ...overrides
  }
  return { backend, calls, owners }
}

function fakeRouter(backend: BrowserBackend): {
  backendFor(ownerId: string): BrowserBackend
  select(ownerId: string, target: 'builtin' | 'chrome'): void
  selections: Array<{ ownerId: string; target: 'builtin' | 'chrome' }>
} {
  const selections: Array<{ ownerId: string; target: 'builtin' | 'chrome' }> = []
  return {
    backendFor: () => backend,
    select: (ownerId, target) => { selections.push({ ownerId, target }) },
    selections
  }
}

const toolsFor = (backend: BrowserBackend = fakeBackend().backend) => createBrowserTools(fakeRouter(backend))

describe('browser tools', () => {
  it('registers all 14 tools with names', () => {
    const tools = toolsFor()
    expect(tools.map(t => t.name)).toEqual([
      'browser_start', 'browser_navigate', 'browser_open_tab', 'browser_click', 'browser_type',
      'browser_select', 'browser_scroll', 'browser_read', 'browser_list_tabs',
      'browser_switch_tab', 'browser_close_tab', 'browser_console', 'browser_network',
      'browser_handoff', 'browser_wait_for'
    ])
  })

  it('browser_navigate validates the url scheme', async () => {
    const tools = toolsFor()
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const bad = await nav.run({ url: 'ftp://x' }, ctx)
    expect(bad.error).toContain('invalid url')
  })

  it('browser_navigate forwards the command to the backend', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const r = await nav.run({ url: 'https://example.com' }, ctx)
    expect(r.output).toContain('navigate')
    expect(calls).toEqual([{ name: 'navigate', params: { url: 'https://example.com' } }])
  })

  it('browser_open_tab forwards the url to the backend', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const openTab = tools.find(t => t.name === 'browser_open_tab')!
    const r = await openTab.run({ url: 'https://example.com' }, ctx)
    expect(r.output).toContain('openTab')
    expect(calls).toEqual([{ name: 'openTab', params: { url: 'https://example.com' } }])
  })

  it('browser_open_tab validates the url scheme', async () => {
    const tools = toolsFor()
    const openTab = tools.find(t => t.name === 'browser_open_tab')!
    const bad = await openTab.run({ url: 'ftp://x' }, ctx)
    expect(bad.error).toContain('invalid url')
  })

  it('browser_type and browser_select forward ref or selector', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const typeTool = tools.find(t => t.name === 'browser_type')!
    const selectTool = tools.find(t => t.name === 'browser_select')!
    await typeTool.run({ ref: 'r2', text: 'hi' }, ctx)
    await typeTool.run({ selector: '#q', text: 'bye' }, ctx)
    await selectTool.run({ ref: 'r3', value: 'b' }, ctx)
    await selectTool.run({ selector: '#s', value: 'a' }, ctx)
    expect(calls).toEqual([
      { name: 'type', params: { ref: 'r2', text: 'hi' } },
      { name: 'type', params: { selector: '#q', text: 'bye' } },
      { name: 'select', params: { ref: 'r3', value: 'b' } },
      { name: 'select', params: { selector: '#s', value: 'a' } }
    ])
  })

  it('browser_click uses ref, selector or coordinates', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const click = tools.find(t => t.name === 'browser_click')!
    await click.run({ ref: 'r4' }, ctx)
    expect(calls[0]).toEqual({ name: 'click', params: { ref: 'r4' } })
    await click.run({ selector: '#btn' }, ctx)
    expect(calls[1]).toEqual({ name: 'click', params: { selector: '#btn' } })
    await click.run({ x: 10, y: 20 }, ctx)
    expect(calls[2]).toEqual({ name: 'click', params: { x: 10, y: 20 } })
  })

  it('browser_* tools forward an explicit tabId', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const read = tools.find(t => t.name === 'browser_read')!
    const click = tools.find(t => t.name === 'browser_click')!
    const waitFor = tools.find(t => t.name === 'browser_wait_for')!
    const scroll = tools.find(t => t.name === 'browser_scroll')!
    await read.run({ tabId: 7, mode: 'full' }, ctx)
    await click.run({ tabId: 7, ref: 'r1' }, ctx)
    await waitFor.run({ tabId: 7, selector: '#a' }, ctx)
    await scroll.run({ tabId: 7, direction: 'down' }, ctx)
    expect(calls).toEqual([
      { name: 'read', params: { mode: 'full', tabId: 7 } },
      { name: 'click', params: { tabId: 7, ref: 'r1' } },
      { name: 'waitFor', params: { selector: '#a', timeoutMs: 10_000, tabId: 7 } },
      { name: 'scroll', params: { tabId: 7, direction: 'down' } }
    ])
  })

  it('resolves the owner from snapshotAgentId, falling back to agentId', async () => {
    const { backend, owners } = fakeBackend()
    const tools = toolsFor(backend)
    const read = tools.find(t => t.name === 'browser_read')!
    await read.run({}, ctx)
    await read.run({}, { ...ctx, agentId: 'subagent-9', snapshotAgentId: 'parent-1' })
    expect(owners).toEqual(['agent-1', 'parent-1'])
  })

  it('returns a clear error without a session context', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const read = tools.find(t => t.name === 'browser_read')!
    const r = await read.run({}, { cwd: '/proj', ask: async () => null })
    expect(r.error).toBe('browser: no session context')
    expect(calls).toEqual([])
  })

  it('browser_start when paired returns immediately without launching', async () => {
    const launcher = fakeLauncher()
    const openChrome = vi.spyOn(launcher, 'openChrome')
    const tools = toolsFor(new ChromeBackend({ bridge: fakeBridge(), launcher }))
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(r.output).toContain('paired')
    expect(openChrome).not.toHaveBeenCalled()
  })

  it('browser_start when not paired opens chrome, shows guide and waits', async () => {
    const launcher = fakeLauncher()
    const openChrome = vi.spyOn(launcher, 'openChrome')
    const showGuide = vi.spyOn(launcher, 'showInstallGuide')
    const bridge = fakeBridge({
      getStatus: () => ({ status: 'listening', port: 3927, paired: false }),
      waitForPaired: async () => true
    })
    const tools = toolsFor(new ChromeBackend({ bridge, launcher }))
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(openChrome).toHaveBeenCalled()
    expect(showGuide).toHaveBeenCalled()
    expect(r.output).toContain('paired')
  })

  it('browser_start reports an error when pairing times out', async () => {
    const bridge = fakeBridge({
      getStatus: () => ({ status: 'listening', port: 3927, paired: false }),
      waitForPaired: async () => false
    })
    const tools = toolsFor(new ChromeBackend({ bridge, launcher: fakeLauncher() }))
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({}, ctx)
    expect(r.error).toContain('not paired')
  })

  it('browser_start target=chrome records the selection for the owner', async () => {
    const { backend } = fakeBackend()
    const router = fakeRouter(backend)
    const tools = createBrowserTools(router)
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({ target: 'chrome' }, ctx)
    expect(r.output).toContain('paired')
    expect(router.selections).toEqual([{ ownerId: 'agent-1', target: 'chrome' }])
  })

  it('browser_start target=builtin without a built-in backend errors and keeps chrome', async () => {
    const launcher = fakeLauncher()
    const openChrome = vi.spyOn(launcher, 'openChrome')
    const chrome = new ChromeBackend({ bridge: fakeBridge(), launcher })
    const router = new BrowserRouter({ backends: { chrome }, defaultBackend: () => 'chrome' })
    const tools = createBrowserTools(router)
    const start = tools.find(t => t.name === 'browser_start')!
    const r = await start.run({ target: 'builtin' }, ctx)
    expect(r.error).toContain('built-in browser is not available')
    expect(router.backendFor('agent-1')).toBe(chrome)
    expect(openChrome).not.toHaveBeenCalled()
  })

  it('browser_handoff forwards the trimmed reason and tab id', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const handoff = tools.find(t => t.name === 'browser_handoff')!
    const r = await handoff.run({ reason: '  Sign in to the admin console  ', tabId: 7 }, ctx)
    expect(r.output).toContain('handoff')
    expect(calls).toEqual([
      { name: 'handoff', params: { reason: 'Sign in to the admin console', tabId: 7 } }
    ])
  })

  it('browser_handoff requires a non-empty reason', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const handoff = tools.find(t => t.name === 'browser_handoff')!
    expect((await handoff.run({ reason: '   ' }, ctx)).error).toContain('reason is required')
    expect(calls).toEqual([])
  })

  it('the Chrome backend rejects browser_handoff', async () => {
    const chrome = new ChromeBackend({ bridge: fakeBridge(), launcher: fakeLauncher() })
    const r = await chrome.execute('handoff', { reason: 'x' }, { ownerId: 'agent-1', ask: async () => null })
    expect(r).toEqual({ ok: false, error: 'browser_handoff is only available in the built-in browser' })
  })

  it('browser_console and browser_network read the backend buffers', async () => {
    const tools = toolsFor()
    const consoleTool = tools.find(t => t.name === 'browser_console')!
    const networkTool = tools.find(t => t.name === 'browser_network')!
    const c = await consoleTool.run({}, ctx)
    const n = await networkTool.run({}, ctx)
    expect(c.output).toContain('boom')
    expect(n.output).toContain('http://x')
  })

  it('browser_read forwards mode and tabId', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const read = tools.find(t => t.name === 'browser_read')!
    await read.run({ mode: 'full', tabId: 7 }, ctx)
    expect(calls).toEqual([{ name: 'read', params: { mode: 'full', tabId: 7 } }])
  })

  it('browser_wait_for passes through a longer timeout to the backend', async () => {
    const { backend, calls } = fakeBackend()
    const tools = toolsFor(backend)
    const wait = tools.find(t => t.name === 'browser_wait_for')!
    await wait.run({ selector: '.loaded', timeoutMs: 5000 }, ctx)
    expect(calls).toEqual([{ name: 'waitFor', params: { selector: '.loaded', timeoutMs: 5000 } }])
  })

  it('maps an error result to ToolRunResult.error', async () => {
    const { backend } = fakeBackend({
      execute: async () => ({ ok: false, error: 'selector not found: #x' })
    })
    const tools = toolsFor(backend)
    const read = tools.find(t => t.name === 'browser_read')!
    const r = await read.run({}, ctx)
    expect(r.error).toContain('selector not found')
  })

  it('zod schema rejects invalid input', async () => {
    const tools = toolsFor()
    const nav = tools.find(t => t.name === 'browser_navigate')!
    const out = await nav.schema.safeParse({ url: 123 })
    expect(out.success).toBe(false)
  })
})
