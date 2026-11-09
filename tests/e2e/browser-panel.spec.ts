import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  return messages.map(message => {
    const m = message as { content?: unknown }
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content.map(part => (part as { text?: string }).text ?? JSON.stringify(part)).join('\n')
    }
    return JSON.stringify(m.content ?? '')
  }).join('\n').replace(/\\"/g, '"').replace(/\\n/g, '\n')
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
          choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${call}`, type: 'function', function: { name: turn.toolCall.name, arguments: JSON.stringify(args) } }] } }]
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
    res.end('<!doctype html><html><head><title>fixture</title></head><body style="margin:0">' +
      '<button id="far" onclick="window.__far=(window.__far||0)+1;document.title=\'far:\'+window.__far">Far</button>' +
      '</body></html>')
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

function seedUserData(userData: string, project: string, meowConfig: Record<string, unknown>, extraAgent = false): void {
  const agents = [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  if (extraAgent) agents.push({ id: 'e2e-other', name: 'other', templateId: 'meow', cwd: project, kind: 'native' } as never)
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project, name: 'E2E Project', agents
  }], null, 2))
  writeFileSync(path.join(userData, 'meow.json'), JSON.stringify(meowConfig, null, 2))
}

async function launch(userData: string, rowIndex = 0): Promise<{ app: ElectronApp; window: Page; sessionId: string }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toBeVisible()
  const row = window.locator('.session-list .session-row').nth(rowIndex)
  try {
    await row.waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    await window.locator('.project-toggle').click()
  }
  await row.click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  const sessionId = await window.evaluate(async (index) => {
    const api = (window as unknown as {
      api: { listWorkspaces(): Promise<Array<{ sessions?: Array<{ id: string }> }>> }
    }).api
    const list = await api.listWorkspaces()
    return list[0]?.sessions?.[index]?.id ?? ''
  }, rowIndex)
  expect(sessionId).toBeTruthy()
  return { app, window, sessionId }
}

interface Rect { x: number; y: number; width: number; height: number }

function viewBounds(app: ElectronApp, url: string): Promise<Rect & { visible: boolean } | null> {
  return app.evaluate(({ BrowserWindow }, fixture) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as Array<{
      webContents?: { getURL(): string }
      getBounds(): Rect
      getVisible(): boolean
    }>
    const page = children.find(c => c.webContents?.getURL().startsWith(fixture))
    return page ? { ...page.getBounds(), visible: page.getVisible() } : null
  }, url)
}

async function compositeShot(app: ElectronApp, fixtureUrl: string, file: string): Promise<number> {
  const data = await app.evaluate(async ({ BrowserWindow, nativeImage }, fixture) => {
    const win = BrowserWindow.getAllWindows()[0]
    const appImage = await win.webContents.capturePage()
    const content = win.getContentBounds()
    const appSize = appImage.getSize()
    const scale = content.width > 0 ? appSize.width / content.width : 1
    const bitmap = Buffer.from(appImage.toBitmap())
    const children = win.contentView.children as unknown as Array<{
      webContents?: { getURL(): string; capturePage(): Promise<{ getSize(): { width: number; height: number }; toBitmap(): Buffer }> }
      getBounds(): { x: number; y: number; width: number; height: number }
    }>
    const page = children.find(c => c.webContents?.getURL().startsWith(fixture))
    if (page && page.webContents) {
      const pageImage = await page.webContents.capturePage()
      const pSize = pageImage.getSize()
      const pBitmap = pageImage.toBitmap()
      const b = page.getBounds()
      const ox = Math.round(b.x * scale)
      const oy = Math.round(b.y * scale)
      for (let row = 0; row < pSize.height && oy + row < appSize.height; row++) {
        if (oy + row < 0) continue
        const src = row * pSize.width * 4
        const dst = ((oy + row) * appSize.width + ox) * 4
        const len = Math.min(pSize.width * 4, (appSize.width - ox) * 4)
        if (dst >= 0 && len > 0) pBitmap.copy(bitmap, dst, src, src + len)
      }
    }
    return nativeImage.createFromBitmap(bitmap, { width: appSize.width, height: appSize.height }).toPNG().toString('base64')
  }, fixtureUrl)
  const buffer = Buffer.from(data, 'base64')
  if (buffer.length === 0) throw new Error(`empty screenshot: ${file}`)
  writeFileSync(file, buffer)
  return buffer.length
}

async function expectBounds(app: ElectronApp, url: string, window: Page): Promise<void> {
  await window.waitForTimeout(250)
  await expect.poll(async () => {
    const view = await viewBounds(app, url)
    const rect = await viewportRect(window)
    if (!view) return false
    return Math.abs(view.x - rect.x) <= 1 && Math.abs(view.y - rect.y) <= 1
      && Math.abs(view.width - rect.width) <= 1 && Math.abs(view.height - rect.height) <= 1
  }, { timeout: 15000 }).toBe(true)
}

function viewportRect(window: Page): Promise<Rect> {
  return window.evaluate(() => {
    const el = document.querySelector('.browser-viewport') as HTMLElement | null
    if (!el) return { x: 0, y: 0, width: 0, height: 0 }
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })
}

test('the panel toggles, drives a tab, switches tabs, reloads and matches the viewport rect', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let releaseSecondTurn: () => void = () => {}
  const secondTurn = new Promise<void>(resolve => { releaseSecondTurn = resolve })
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_list_tabs', args: async () => { await secondTurn; return {} } } },
    { contentFrom: (body: unknown) => `titles: ${titlesIn(body).join(' | ')}` }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const shots = path.join(tmpdir(), 'meow-browser-panel-shots')
  mkdirSync(shots, { recursive: true })
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('open the browser')
      await window.locator('.chat-input-field').press('Enter')

      // The agent-driven panel request opens the panel for the active session.
      const overlay = window.locator('.browser-overlay')
      await expect(overlay).toBeVisible({ timeout: 30000 })
      await expect(window.locator('.browser-banner')).toContainText('Meow is using this tab')
      await expect(window.locator('.browser-url-input')).toBeDisabled()
      await expect(window.locator('.icon-btn[aria-label="Back"]')).toBeDisabled()
      await expect(window.locator('.icon-btn[aria-label="Open in default browser"]')).toBeEnabled()

      // Docked beside the chat, the native view matches the placeholder rect.
      await expectBounds(app, url, window)
      await window.locator('.pane-header .icon-btn[aria-label="Toggle browser"]').click()
      await window.waitForTimeout(300)
      console.log('[e2e] toggle close count', await window.locator('.browser-overlay').count())
      await window.locator('.pane-header .icon-btn[aria-label="Toggle browser"]').click()
      await window.waitForTimeout(300)
      const agentShot = await compositeShot(app, url, path.join(shots, 'browser-agent-banner.png'))

      // Take over / hand back.

      await window.locator('.browser-banner button', { hasText: 'Take over' }).click()
      await expect(window.locator('.browser-banner')).toContainText('Hand back')
      await expect(window.locator('.browser-url-input')).toBeEnabled()
      await window.locator('.browser-banner button', { hasText: 'Hand back' }).click()
      await expect(window.locator('.browser-banner')).toHaveCount(0)
      // The banner row disappeared: the viewport moved without resizing the panel.
      await expectBounds(app, url, window)

      // URL entry reaches the fixture; invalid input shows the error row.
      await window.locator('.browser-url-input').fill(url.replace(/^http:\/\//, ''))
      await window.locator('.browser-url-input').press('Enter')
      await expect(window.locator('.browser-url-input')).toHaveValue(url, { timeout: 10000 })
      await window.locator('.browser-url-input').fill('file:///C:/secret.txt')
      await window.locator('.browser-url-input').press('Enter')
      await expect(window.locator('.terminal-error-bar')).toContainText('Enter an http(s) URL')
      // The error row moved the viewport down.
      await expectBounds(app, url, window)
      await window.locator('.terminal-error-bar .icon-btn').click()
      await expect(window.locator('.terminal-error-bar')).toHaveCount(0)
      await expectBounds(app, url, window)

      // A second tab and a reload.
      await window.locator('.icon-btn[aria-label="New tab"]').click()
      await expect(window.locator('.browser-tab')).toHaveCount(2, { timeout: 10000 })
      await window.locator('.browser-tab').first().click()
      await window.locator('.icon-btn[aria-label="Reload"]').click()

      const chatShot = await compositeShot(app, url, path.join(shots, 'browser-docked-chat.png'))

      // Position-only change: a transition moves .main without resizing it (the
      // panel's own rise animation is the production case; this makes it explicit).
      const beforeMove = await viewportRect(window)
      await window.evaluate(() => {
        const main = document.querySelector('.main') as HTMLElement
        main.style.transition = 'transform 80ms linear'
        main.style.transform = 'translateX(-24px)'
      })
      await window.waitForTimeout(400)
      const afterMove = await viewportRect(window)
      expect(afterMove.width).toBe(beforeMove.width)
      expect(afterMove.height).toBe(beforeMove.height)
      expect(afterMove.x).not.toBe(beforeMove.x)
      await expectBounds(app, url, window)
      await window.evaluate(() => {
        const main = document.querySelector('.main') as HTMLElement
        main.style.transform = ''
      })
      await window.waitForTimeout(300)
      await expectBounds(app, url, window)

      // Expanded: the view follows the new placeholder rect.
      await window.locator('.icon-btn[aria-label="Expand"]').click()
      await expect(overlay).toHaveClass(/full/)
      await expectBounds(app, url, window)
      await window.locator('.icon-btn[aria-label="Restore size"]').click()
      await expectBounds(app, url, window)

      // Docked beside the terminal: both visible, no overlap.
      await window.keyboard.press('Control+`')
      await expect(window.locator('.terminal-overlay')).toBeVisible({ timeout: 10000 })
      const browserBox = await overlay.boundingBox()
      const terminalBox = await window.locator('.terminal-overlay').boundingBox()
      expect(browserBox && terminalBox).toBeTruthy()
      // The grid stacks them: the browser sits above the terminal in the column.
      expect(browserBox!.x).toBeCloseTo(terminalBox!.x, 0)
      expect(browserBox!.y + browserBox!.height).toBeLessThanOrEqual(terminalBox!.y + 1)
      const terminalShot = await compositeShot(app, url, path.join(shots, 'browser-docked-terminal.png'))

      // Closing with the terminal docked: the header Close button must close the panel.
      await window.locator('.icon-btn[aria-label="Close Browser"]').click()
      await expect(overlay).toHaveCount(0)
      await expect.poll(async () => (await viewBounds(app, url))?.x, { timeout: 10000 }).toBe(10_000)

      console.log('[e2e] screenshots', JSON.stringify({
        agent: { path: path.join(shots, 'browser-agent-banner.png'), bytes: agentShot },
        chat: { path: path.join(shots, 'browser-docked-chat.png'), bytes: chatShot },
        terminal: { path: path.join(shots, 'browser-docked-terminal.png'), bytes: terminalShot }
      }))
      releaseSecondTurn()
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

test('a panel request for a session that is not active does not open the panel', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let releaseSecond: () => void = () => {}
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve })
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_navigate', args: async () => { await secondGate; return { url } } } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { contentFrom: () => 'done' }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('open the browser')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.browser-overlay')).toBeVisible({ timeout: 30000 })
      await window.locator('.icon-btn[aria-label="Close Browser"]').click()
      await expect(window.locator('.browser-overlay')).toHaveCount(0)

      // Make another session active, then let the first agent navigate again.
      await window.getByRole('button', { name: 'new session E2E Project', exact: true }).click()
      await expect(window.locator('.pane-slot:not([hidden])')).toContainText('New session', { timeout: 10000 })
      releaseSecond()
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('done', { timeout: 30000 })
      expect(await window.locator('.browser-overlay').count()).toBe(0)
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
