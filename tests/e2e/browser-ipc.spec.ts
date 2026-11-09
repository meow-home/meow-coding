import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

interface MockTurn {
  content?: string
  contentFrom?: (body: unknown) => string
  toolCall?: { name: string; args: unknown | ((body: unknown) => unknown) }
}

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

function conversationText(body: unknown): string {
  const messages = (body as { messages?: unknown[] } | null)?.messages
  if (!Array.isArray(messages)) return ''
  const raw = messages.map(message => {
    const m = message as { content?: unknown }
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content.map(part => (part as { text?: string }).text ?? JSON.stringify(part)).join('\n')
    }
    return JSON.stringify(m.content ?? '')
  }).join('\n')
  return raw.replace(/\\"/g, '"').replace(/\\n/g, '\n')
}

function titlesIn(body: unknown): string[] {
  return [...conversationText(body).matchAll(/"title":\s*"([^"]*)"/g)].map(m => m[1])
}

function startMockLlm(turns: MockTurn[]): Promise<{ server: http.Server; port: number; calls: () => number }> {
  let call = 0
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      void handle().catch(err => {
        console.error('[e2e] mock turn failed', err)
        try { res.writeHead(500); res.end() } catch { /* already sent */ }
      })
    })

    async function handle(): Promise<void> {
      let body: unknown = {}
      try { body = JSON.parse(raw) } catch { /* leave {} */ }
      const turn = turns[Math.min(call, turns.length - 1)]
      call++
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      const send = (obj: unknown): void => { res.write(`data: ${JSON.stringify(obj)}\n\n`) }
      if (turn.toolCall) {
        const args = typeof turn.toolCall.args === 'function' ? await turn.toolCall.args(body) : turn.toolCall.args
        send({
          id: 'mock-1',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{
                index: 0, id: `call_${call}`, type: 'function',
                function: { name: turn.toolCall.name, arguments: JSON.stringify(args) }
              }]
            }
          }]
        })
        send({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        const content = turn.contentFrom ? turn.contentFrom(body) : (turn.content ?? '')
        send({ id: 'mock-1', choices: [{ index: 0, delta: { role: 'assistant', content } }] })
        send({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
      res.write('data: [DONE]\n\n')
      res.end()
    }
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port, calls: () => call })
    })
  })
}

function startFixtureServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><html><head><title>fixture</title></head><body style="margin:0">
      <button id="far" onclick="window.__far=(window.__far||0)+1;document.title='far:'+window.__far">Far button</button>
      <script>window.__far = 0; console.log('fixture-log')</script>
    </body></html>`)
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}/` })
    })
  })
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    console.warn(`[e2e] could not remove ${dir}: ${String(err)}`)
  }
}

function seedUserData(userData: string, project: string, meowConfig: Record<string, unknown>): void {
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project,
    name: 'E2E Project',
    agents: [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }], null, 2))
  writeFileSync(path.join(userData, 'meow.json'), JSON.stringify(meowConfig, null, 2))
}

async function launch(userData: string): Promise<{ app: ElectronApp; window: Page; sessionId: string }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toBeVisible()
  const row = window.locator('.session-list .session-row').first()
  try {
    await row.waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    await window.locator('.project-toggle').click()
  }
  await row.click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  const sessionId = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: { listWorkspaces(): Promise<Array<{ sessions?: Array<{ id: string }> }>> }
    }).api
    const list = await api.listWorkspaces()
    return list[0]?.sessions?.[0]?.id ?? ''
  })
  expect(sessionId).toBeTruthy()
  return { app, window, sessionId }
}

interface TabInfoLike {
  id: number
  control: string
  holdReason?: string
  title: string
}

function tabs(window: Page, sessionId: string): Promise<TabInfoLike[]> {
  return window.evaluate(async (id) => {
    const api = (window as unknown as { api: { browserTabsList(agentId: string): Promise<TabInfoLike[]> } }).api
    return api.browserTabsList(id)
  }, sessionId)
}

function pageViewBounds(app: ElectronApp, fixtureUrl: string): Promise<{
  x: number; y: number; width: number; height: number; visible: boolean
} | null> {
  return app.evaluate(({ BrowserWindow }, fixture) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as Array<{
      webContents?: { getURL(): string }
      getBounds(): { x: number; y: number; width: number; height: number }
      getVisible(): boolean
    }>
    const page = children.find(c => c.webContents?.getURL().startsWith(fixture))
    return page ? { ...page.getBounds(), visible: page.getVisible() } : null
  }, fixtureUrl)
}

test('browser_handoff exposes user state and browserHandBack resumes the turn', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_handoff', args: { reason: 'Sign in to the fixture' } } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { contentFrom: (body: unknown) => `handoff=${conversationText(body).includes('originChanged')}` }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('sign in')
      await window.locator('.chat-input-field').press('Enter')

      await expect.poll(async () => (await tabs(window, sessionId))[0]?.control, { timeout: 30000 }).toBe('user')
      const info = (await tabs(window, sessionId))[0]
      expect(info.holdReason).toBe('Sign in to the fixture')

      await window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserHandBack(id: number): Promise<void> } }).api.browserHandBack(tabId)
      }, info.id)

      await expect(window.locator('.chat-msg.assistant').last()).toContainText('handoff=true', { timeout: 30000 })
      expect((await tabs(window, sessionId))[0].control).toBe('idle')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    fixture.close()
    llm.close()
  }
})

test('browserTakeOver makes the next command wait, browserHandBack resumes it', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let releaseClick: () => void = () => {}
  const clickGate = new Promise<void>(resolve => { releaseClick = resolve })
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_read', args: {} } },
    { toolCall: { name: 'browser_click', args: async () => { await clickGate; return { selector: '#far' } } } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { contentFrom: (body: unknown) => `titles: ${titlesIn(body).join(' | ')}` }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('take over')
      await window.locator('.chat-input-field').press('Enter')

      await expect.poll(async () => (await tabs(window, sessionId))[0]?.control, { timeout: 30000 }).toBe('agent')
      const info = (await tabs(window, sessionId))[0]
      await window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserTakeOver(id: number): Promise<void> } }).api.browserTakeOver(tabId)
      }, info.id)
      expect((await tabs(window, sessionId))[0].control).toBe('user')

      releaseClick()
      await window.waitForTimeout(400)
      // The click is queued behind the user hold.
      await expect(window.locator('.tool-call-running')).toHaveCount(1)

      await window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserHandBack(id: number): Promise<void> } }).api.browserHandBack(tabId)
      }, info.id)
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('far:1', { timeout: 30000 })
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    fixture.close()
    llm.close()
  }
})

test('panel IPC drives bounds, metrics, freeze and logs', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let releaseFirst: () => void = () => {}
  let releaseSecond: () => void = () => {}
  let releaseLogs: () => void = () => {}
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve })
  const logsGate = new Promise<void>(resolve => { releaseLogs = resolve })
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_read', args: {} } },
    { toolCall: { name: 'browser_click', args: async () => { await firstGate; return { selector: '#far' } } } },
    { toolCall: { name: 'browser_click', args: async () => { await secondGate; return { selector: '#far' } } } },
    { toolCall: { name: 'browser_console', args: async () => { await logsGate; return {} } } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    {
      contentFrom: (body: unknown) => {
        const text = conversationText(body)
        return `agentSawHeld=${text.includes('held-log')} titles: ${titlesIn(body).join(' | ')}`
      }
    }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('panel ipc')
      await window.locator('.chat-input-field').press('Enter')
      await expect.poll(async () => (await tabs(window, sessionId))[0]?.control, { timeout: 30000 }).toBe('agent')
      const info = (await tabs(window, sessionId))[0]

      // A second, user-created tab must stay off screen with the background placement.
      await window.evaluate(async (agentId) => {
        await (window as unknown as { api: { browserTabCreate(id: string): Promise<unknown> } })
          .api.browserTabCreate(agentId)
      }, sessionId)

      const rect = { x: 100, y: 120, width: 600, height: 400 }
      await window.evaluate(async ({ id, bounds }) => {
        await (window as unknown as {
          api: { browserPanelAttach(agentId: string, b: typeof bounds): Promise<void> }
        }).api.browserPanelAttach(id, bounds)
      }, { id: sessionId, bounds: rect })
      await expect.poll(async () => (await pageViewBounds(app, url))?.x, { timeout: 10000 }).toBe(rect.x)
      expect(await pageViewBounds(app, url)).toMatchObject(rect)
      const offscreen = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const children = win.contentView.children as unknown as Array<{
          webContents?: { getURL(): string }
          getBounds(): { x: number; y: number; width: number; height: number }
        }>
        const blank = children.find(c => c.webContents?.getURL() === 'about:blank')
        return blank ? blank.getBounds() : null
      })
      expect(offscreen).toMatchObject({ x: 10_000, y: 10_000, width: 1280, height: 800 })

      // A click still lands after the metrics switch.
      releaseFirst()
      await expect.poll(async () => (await tabs(window, sessionId))[0]?.title, { timeout: 15000 }).toBe('far:1')

      const moved = { x: 20, y: 30, width: 500, height: 300 }
      await window.evaluate(async (bounds) => {
        await (window as unknown as { api: { browserPanelSetBounds(b: typeof bounds): Promise<void> } })
          .api.browserPanelSetBounds(bounds)
      }, moved)
      await expect.poll(async () => (await pageViewBounds(app, url))?.width, { timeout: 10000 }).toBe(moved.width)

      // Freeze/hide/unfreeze with the generation guard.
      const frozen = await window.evaluate(async () => {
        return (window as unknown as {
          api: { browserPanelFreeze(): Promise<{ generation: number; image: string | null } | null> }
        }).api.browserPanelFreeze()
      })
      expect(frozen?.image?.startsWith('data:image/')).toBe(true)
      await window.evaluate(async (generation) => {
        await (window as unknown as { api: { browserPanelHideFrozen(g: number): Promise<void> } })
          .api.browserPanelHideFrozen(generation)
      }, frozen!.generation)
      await expect.poll(async () => (await pageViewBounds(app, url))?.visible).toBe(false)
      await window.evaluate(async () => {
        await (window as unknown as { api: { browserPanelUnfreeze(): Promise<void> } }).api.browserPanelUnfreeze()
      })
      await expect.poll(async () => (await pageViewBounds(app, url))?.visible).toBe(true)
      // Stale hide is ignored.
      await window.evaluate(async (generation) => {
        await (window as unknown as { api: { browserPanelHideFrozen(g: number): Promise<void> } })
          .api.browserPanelHideFrozen(generation)
      }, frozen!.generation)
      expect((await pageViewBounds(app, url))?.visible).toBe(true)

      // Scheme and hold guards.
      await expect(window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserTabNavigate(id: number, u: string): Promise<void> } })
          .api.browserTabNavigate(tabId, 'file:///C:/secret.txt')
      }, info.id)).rejects.toThrow('invalid url')
      await expect(window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserTabNavigate(id: number, u: string): Promise<void> } })
          .api.browserTabNavigate(tabId, 'http://127.0.0.1:1/')
      }, info.id)).rejects.toThrow('Meow is using this tab: take over first')

      // Detach returns the view off screen; a click still lands there.
      await window.evaluate(async () => {
        await (window as unknown as { api: { browserPanelDetach(): Promise<void> } }).api.browserPanelDetach()
      })
      await expect.poll(async () => (await pageViewBounds(app, url))?.x, { timeout: 10000 }).toBe(10_000)
      releaseSecond()
      await expect.poll(async () => (await tabs(window, sessionId))[0]?.title, { timeout: 15000 }).toBe('far:2')

      // A log written while the user holds the tab is drawer-only.
      await window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserTakeOver(id: number): Promise<void> } }).api.browserTakeOver(tabId)
      }, info.id)
      await app.evaluate(({ BrowserWindow }, fixture) => {
        const win = BrowserWindow.getAllWindows()[0]
        const children = win.contentView.children as unknown as Array<{ webContents?: { getURL(): string; executeJavaScript(c: string): Promise<unknown> } }>
        const page = children.find(c => c.webContents?.getURL().startsWith(fixture))
        void page?.webContents?.executeJavaScript('console.log("held-log")')
      }, url)
      await window.waitForTimeout(300)
      const drawerLogs = await window.evaluate(async (tabId) => {
        return (window as unknown as { api: { browserTabLogs(id: number, kind: 'console'): Promise<unknown[]> } })
          .api.browserTabLogs(tabId, 'console')
      }, info.id)
      expect(JSON.stringify(drawerLogs)).toContain('held-log')
      await window.evaluate(async (tabId) => {
        await (window as unknown as { api: { browserHandBack(id: number): Promise<void> } }).api.browserHandBack(tabId)
      }, info.id)
      releaseLogs()

      const final = window.locator('.chat-msg.assistant').last()
      await expect(final).toContainText('agentSawHeld=false', { timeout: 30000 })
      expect(await final.textContent()).toContain('far:2')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    fixture.close()
    llm.close()
  }
})
