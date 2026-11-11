import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/missing.png')) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html><head><title>fixture</title></head><body style="margin:0">' +
      "<button id=\"far\" onclick=\"window.__far=(window.__far||0)+1;document.title='far:'+window.__far\">Far</button>" +
      "<button id=\"boom\" onclick=\"console.error('fixture boom')\">Boom</button>" +
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
  await expect(window.locator('.project-row').first()).toBeVisible()
  const row = window.locator('.session-list .session-row').nth(rowIndex)
  try {
    await row.waitFor({ state: 'visible', timeout: 2000 })
  } catch {
    await window.locator('.project-toggle').first().click()
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

function onscreenView(app: ElectronApp): Promise<{ url: string; visible: boolean; x: number } | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as Array<{
      webContents?: { getURL(): string }
      getBounds(): { x: number; width: number }
      getVisible(): boolean
    }>
    const child = children.find(c => !!c.webContents && c.getBounds().x < 10_000)
    return child?.webContents
      ? { url: child.webContents.getURL(), visible: child.getVisible(), x: child.getBounds().x }
      : null
  })
}

async function compositeShot(app: ElectronApp, fixtureUrl: string, file: string): Promise<number> {
  const data = await app.evaluate(async ({ BrowserWindow, nativeImage }, fixture) => {
    const win = BrowserWindow.getAllWindows()[0]
    // capturePage can fail transiently with UnknownVizError (spike S1).
    const capture = async <T>(source: { capturePage(): Promise<T> }): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await source.capturePage()
        } catch (err) {
          if (attempt >= 3) throw err
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }
    }
    const appImage = await capture(win.webContents)
    const content = win.getContentBounds()
    const appSize = appImage.getSize()
    const scale = content.width > 0 ? appSize.width / content.width : 1
    const bitmap = Buffer.from(appImage.toBitmap())
    const children = win.contentView.children as unknown as Array<{
      webContents?: { getURL(): string; capturePage(): Promise<{ getSize(): { width: number; height: number }; toBitmap(): Buffer }> }
      getBounds(): { x: number; y: number; width: number; height: number }
    }>
    const page = children.find(c => !!c.webContents && c.getBounds().x < 10_000 && c.getVisible())
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
      await window.locator('.icon-btn[aria-label="Browser menu"]').click()
      await expect(window.locator('button.menu-item', { hasText: 'Open in default browser' })).toBeEnabled()
      await window.keyboard.press('Escape')
      await expect(window.locator('button.menu-item', { hasText: 'Open in default browser' })).toHaveCount(0)

      // Docked beside the chat, the native view matches the placeholder rect.
      await expectBounds(app, url, window)
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await window.waitForTimeout(300)
      await expect(window.locator('.browser-overlay')).toHaveCount(0)
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
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

      // Position-only change: a transition moves .main without resizing it, which a
      // ResizeObserver alone would miss (the panel also re-measures on transition and
      // animation ends).
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

test('a panel opening under a modal stays hidden, and an agent shield does not cover the modal', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let releaseNavigate: () => void = () => {}
  const navigateGate = new Promise<void>(resolve => { releaseNavigate = resolve })
  let releaseEnd: () => void = () => {}
  const endGate = new Promise<void>(resolve => { releaseEnd = resolve })
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: async () => { await navigateGate; return { url } } } },
    { toolCall: { name: 'browser_list_tabs', args: async () => { await endGate; return {} } } },
    { contentFrom: () => 'done' }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const onScreenVisible = (app: ElectronApp): Promise<number> => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as Array<{
      webContents?: unknown
      getBounds(): { x: number }
      getVisible(): boolean
    }>
    return children.filter(c => !!c.webContents && c.getBounds().x < 10_000 && c.getVisible()).length
  })
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('open the browser')
      await window.locator('.chat-input-field').press('Enter')
      const dialog = window.locator('.browser-dialog')
      await window.locator('.sb-browser').click()
      await expect(dialog).toBeVisible()

      releaseNavigate()
      await expect(window.locator('.browser-overlay')).toHaveCount(1, { timeout: 30000 })
      for (let i = 0; i < 12; i++) {
        expect(await onScreenVisible(app)).toBe(0)
        await window.waitForTimeout(60)
      }
      // The modal is still usable while the agent holds the tab.
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect.poll(() => onScreenVisible(app), { timeout: 15000 }).toBeGreaterThan(0)
      releaseEnd()
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('done', { timeout: 30000 })
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
      // The draft's name is in the title bar; the pane itself has no header row.
      await expect(window.locator('.title-bar-session-name')).toHaveText('New session', { timeout: 10000 })
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

test('occlusion: menus and the resizer hide the native view, and it comes back', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port } = await startMockLlm([{ content: 'ok' }])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const shots = path.join(tmpdir(), 'meow-browser-panel-shots')
  mkdirSync(shots, { recursive: true })
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const project2 = mkdtempSync(path.join(tmpdir(), 'meow-e2e-two-'))
    const workspaces = JSON.parse(readFileSync(path.join(userData, 'workspaces.json'), 'utf8')) as unknown[]
    workspaces.push({ projectPath: project2, name: 'E2E Two', agents: [{ id: 'e2e-two', name: 'meow', templateId: 'meow', cwd: project2, kind: 'native' }] })
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
    const { app, window, sessionId } = await launch(userData)
    try {
      window.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)) })
      await window.evaluate(({ id, u }) => window.api.browserTabCreate(id, u), { id: sessionId, u: url })
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await expect(window.locator('.browser-overlay')).toBeVisible()
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)

      const visible = async (): Promise<boolean | undefined> => (await viewBounds(app, url))?.visible

      // Tab menu (a BaseDropdown over the page): visible, clickable, view hidden.
      const tab = window.locator('.browser-tab').first()
      await tab.click({ button: 'right' })
      const menu = window.locator('.base-dropdown-menu')
      await expect(menu).toBeVisible()
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      const dropdownBytes = await compositeShot(app, url, path.join(shots, 'browser-occlusion-dropdown.png'))
      await menu.getByText('Reload', { exact: true }).click()
      await expect(menu).toHaveCount(0)
      await expect.poll(visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)

      // Rapid open/close ends visible.
      for (let i = 0; i < 5; i++) {
        await tab.click({ button: 'right' })
        await expect(menu).toBeVisible()
        await window.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
      await expect.poll(visible, { timeout: 15000 }).toBe(true)

      // Resizer drag: hidden during, visible after, bounds updated.
      const resizer = window.locator('.right-panels-resizer')
      const box = await resizer.boundingBox()
      expect(box).toBeTruthy()
      const before = await viewportRect(window)
      await window.mouse.move(box!.x + box!.width / 2, box!.y + 100)
      await window.mouse.down()
      await window.mouse.move(box!.x - 300, box!.y + 100, { steps: 6 })
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      await window.mouse.up()
      await expect.poll(visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)
      const after = await viewportRect(window)
      expect(after.width).toBeGreaterThan(before.width)

      // Another panel expanded over the browser hides it; restoring shows it.
      await window.keyboard.press('Control+`')
      await expect(window.locator('.terminal-overlay')).toBeVisible({ timeout: 10000 })
      await window.locator('.terminal-overlay .icon-btn[aria-label="Expand"]').click()
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      await window.locator('.terminal-overlay .icon-btn[aria-label="Restore size"]').click()
      await expect.poll(visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)
      await window.keyboard.press('Control+`')

      // Modal (status bar browser pill): hides the view; closing restores the same bounds.
      const dialog = window.locator('.browser-dialog')
      await window.locator('.sb-browser').click()
      await expect(dialog).toBeVisible()
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      // A page title/loading change while the modal is open must not trigger
      // another capture or hide: main already knows the panel is hidden.
      const counters = await window.evaluate(() => {
        const api = window.api as unknown as Record<string, unknown>
        const freeze = api.browserPanelFreeze as () => Promise<unknown>
        const hide = api.browserPanelHide as () => Promise<unknown>
        const counts = { freeze: 0, hide: 0 }
        api.browserPanelFreeze = (...a: unknown[]) => { counts.freeze++; return freeze.apply(api, a) }
        api.browserPanelHide = (...a: unknown[]) => { counts.hide++; return hide.apply(api, a) }
        ;(window as unknown as Record<string, unknown>).__occlusionCounts = () => ({ ...counts })
        return true
      })
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith('http://127.0.0.1')
        }) as unknown as { webContents?: { executeJavaScript(code: string): Promise<unknown> } } | undefined
        void child?.webContents?.executeJavaScript('document.title = "occlusion-title-change"')
      })
      await window.waitForTimeout(400)
      expect(counters).toBe(true)
      expect(await window.evaluate(() => (window as unknown as { __occlusionCounts(): { freeze: number; hide: number } }).__occlusionCounts())).toEqual({ freeze: 0, hide: 0 })
      expect(await visible()).toBe(false)
      const modalBytes = await compositeShot(app, url, path.join(shots, 'browser-occlusion-modal.png'))
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect.poll(visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)

      // Modal + tab switch: the new tab must not appear over the modal.
      await window.locator('.sb-browser').click()
      await expect(dialog).toBeVisible()
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      const created = await window.evaluate(id => window.api.browserTabCreate(id), sessionId)
      await window.evaluate(({ id, tab }) => window.api.browserTabActivate(id, tab), { id: sessionId, tab: created.id })
      // The renderer reacts on the next frame; the regression is a view that stays
      // visible for the whole modal, so start polling after that frame.
      await window.waitForTimeout(150)
      for (let i = 0; i < 10; i++) {
        await window.waitForTimeout(60)
        expect((await onscreenView(app))?.visible).toBe(false)
      }
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await onscreenView(app))?.visible, { timeout: 15000 }).toBe(true)
      expect((await onscreenView(app))?.url.startsWith('about:blank')).toBe(true)
      expect(await window.locator('.browser-tab.active').count()).toBe(1)
      // Back to the fixture tab for the remaining cases.
      await window.evaluate(async ({ id, u }) => {
        const tabs = await window.api.browserTabsList(id)
        const fixture = tabs.find(t => t.url.startsWith(u))
        if (fixture) await window.api.browserTabActivate(id, fixture.id)
      }, { id: sessionId, u: url })
      await expectBounds(app, url, window)

      // Sidebar project menu: far from the panel, no freeze, view stays visible.
      const freezeWrapped = await window.evaluate(() => {
        try {
          const api = window.api as unknown as Record<string, unknown>
          const original = api.browserPanelFreeze as () => Promise<unknown>
          let count = 0
          ;(window as unknown as Record<string, unknown>).__freezeCount = () => count
          api.browserPanelFreeze = (...args: unknown[]) => { count++; return original.apply(api, args) }
          return true
        } catch {
          return false
        }
      })
      const sidebarMenu = window.locator('.project-row button[aria-label^="menu "]').first()
      await sidebarMenu.click()
      await expect(window.locator('.project-menu-dropdown')).toBeVisible()
      for (let i = 0; i < 5; i++) {
        await window.waitForTimeout(60)
        expect(await visible()).toBe(true)
      }
      await window.keyboard.press('Escape')
      expect(await visible()).toBe(true)
      if (freezeWrapped) {
        expect(await window.evaluate(() => (window as unknown as { __freezeCount(): number }).__freezeCount())).toBe(0)
      }

      // Project switch away from the panel's session hides it; coming back shows it.
      await window.locator('button[aria-label="menu E2E Two"]').click()
      await window.locator('.project-menu-dropdown').getByText('Open', { exact: true }).click()
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      await window.locator('button[aria-label="menu E2E Project"]').click()
      await window.locator('.project-menu-dropdown').getByText('Open', { exact: true }).click()
      await expect.poll(visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)

      // Crash: the message replaces the view; a menu does not bring it back; Reload does.
      await app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const view = win.contentView.children.find(child => {
          const wc = (child as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { forcefullyCrashRenderer(): void } } | undefined
        if (!view) throw new Error('built-in browser view not found')
        view.webContents.forcefullyCrashRenderer()
      }, url)
      await expect(window.locator('.browser-empty[role="alert"]')).toContainText('This tab crashed.', { timeout: 15000 })
      await expect.poll(visible, { timeout: 15000 }).toBe(false)
      const crashedTab = window.locator('.browser-tab.active')
      await crashedTab.click({ button: 'right' })
      await expect(menu).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await window.waitForTimeout(300)
      expect(await visible()).toBe(false)
      await window.getByRole('button', { name: 'Reload' }).last().click()
      await expect.poll(visible, { timeout: 20000 }).toBe(true)
      await expectBounds(app, url, window)

      console.log('[e2e] occlusion screenshots', JSON.stringify({
        dropdown: { file: path.join(shots, 'browser-occlusion-dropdown.png'), bytes: dropdownBytes },
        modal: { file: path.join(shots, 'browser-occlusion-modal.png'), bytes: modalBytes },
        freezeWrapped
      }))
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

test('keyboard shortcuts from a focused page', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port } = await startMockLlm([{ content: 'ok' }])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await window.evaluate(({ id, u }) => window.api.browserTabCreate(id, u), { id: sessionId, u: url })
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await expect(window.locator('.browser-overlay')).toBeVisible()
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(true)

      const sendKey = (input: Record<string, unknown>): Promise<void> => app.evaluate(({ BrowserWindow }, { fixtureUrl, event }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { focus(): void; sendInputEvent(e: unknown): void } } | undefined
        if (!child) throw new Error('built-in browser view not found')
        child.webContents.focus()
        child.webContents.sendInputEvent(event)
      }, { fixtureUrl: url, event: input })
      const pageOrigin = (): Promise<number> => app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { executeJavaScript(code: string): Promise<number> } }
        return child.webContents.executeJavaScript('performance.timeOrigin') as Promise<number>
      }, url)

      // Ctrl+R reloads the tab, not the app: the page origin changes, the renderer survives.
      await window.evaluate(() => { (window as unknown as Record<string, unknown>).__e2eMarker = 42 })
      const originBefore = await pageOrigin()
      await sendKey({ type: 'keyDown', keyCode: 'r', modifiers: ['control'] })
      await expect.poll(pageOrigin, { timeout: 15000 }).not.toBe(originBefore)
      expect(await window.evaluate(() => (window as unknown as Record<string, unknown>).__e2eMarker)).toBe(42)

      // Ctrl+` toggles the terminal from the page.
      await sendKey({ type: 'keyDown', keyCode: '`', modifiers: ['control'] })
      await expect(window.locator('.terminal-overlay')).toBeVisible({ timeout: 10000 })
      await sendKey({ type: 'keyDown', keyCode: '`', modifiers: ['control'] })
      await expect(window.locator('.terminal-overlay')).toHaveCount(0)

      // Ctrl+L moves focus into the URL input; typing lands there.
      await sendKey({ type: 'keyDown', keyCode: 'l', modifiers: ['control'] })
      await window.keyboard.type('127.0.0.1:9')
      await expect(window.locator('.browser-url-input')).toHaveValue(/127\.0\.0\.1:9/)
      await window.keyboard.press('Escape')

      // Ctrl+W must not close the app window.
      await sendKey({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] })
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

      // Ctrl+Shift+B from the page closes the panel.
      await sendKey({ type: 'keyDown', keyCode: 'B', modifiers: ['control', 'shift'] })
      await expect(window.locator('.browser-overlay')).toHaveCount(0)

      // Focus in the renderer: Ctrl+Shift+B reopens it.
      await window.locator('.chat-input-field').click()
      await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await window.keyboard.press('Control+Shift+B')
      await expect(window.locator('.browser-overlay')).toBeVisible({ timeout: 10000 })
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


test('drawer shows console and network logs, sends them to chat, and the view follows', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port, calls } = await startMockLlm([{ content: 'ok' }])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const shots = path.join(tmpdir(), 'meow-browser-panel-shots')
  mkdirSync(shots, { recursive: true })
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await window.evaluate(({ id, u }) => window.api.browserTabCreate(id, u), { id: sessionId, u: url })
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await expect(window.locator('.browser-overlay')).toBeVisible()
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(true)
      await expectBounds(app, url, window)

      // Closed drawer: no log polling at all.
      // Open: console error with a count, then the network request.
      await window.locator('.icon-btn[aria-label="Console and network"]').click()
      await window.waitForTimeout(300)
      const drawer = window.locator('.browser-drawer')
      await expect(drawer).toBeVisible()
      // Log and request after the debugger is attached, so the entries are captured.
      await app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { executeJavaScript(code: string): Promise<unknown> } } | undefined
        if (!child) throw new Error('built-in browser view not found')
        return child.webContents.executeJavaScript(
          "document.getElementById('boom').click(); const i=new Image(); i.src='/missing.png?late=1'; document.body.appendChild(i); true"
        )
      }, url)
      await expect(drawer).toContainText('fixture boom', { timeout: 10000 })
      await expect(drawer.locator('.browser-drawer-count')).toHaveText(/^[1-9]d*$/)
      await expectBounds(app, url, window)
      const shot = await compositeShot(app, url, path.join(shots, 'browser-drawer.png'))
      await drawer.getByRole('tab', { name: 'Network' }).click()
      await expect(drawer).toContainText('missing.png', { timeout: 10000 })
      await expect(drawer).toContainText('404')

      // Send to chat fills the composer and never sends.
      await drawer.getByRole('tab', { name: /Console/ }).click()
      await expect(drawer).toContainText('fixture boom', { timeout: 10000 })
      const callsBefore = calls()
      await drawer.getByRole('button', { name: 'Send to chat' }).click()
      await expect(window.locator('.chat-input-field')).toHaveValue(/fixture boom/)
      await window.waitForTimeout(400)
      expect(calls()).toBe(callsBefore)

      // A tab created while the panel is closed is the active one on attach.
      await window.locator('.icon-btn[aria-label="Close Browser"]').click()
      await expect(window.locator('.browser-overlay')).toHaveCount(0)
      await window.evaluate(async ({ id, u }) => {
        const created = await window.api.browserTabCreate(id, u)
        await window.api.browserTabActivate(id, created.id)
      }, { id: sessionId, u: `${url}?second=1` })
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await expect(window.locator('.browser-overlay')).toBeVisible()
      await expect(window.locator('.browser-url-input')).toHaveValue(/second=1/, { timeout: 10000 })
      console.log('[e2e] drawer screenshot', JSON.stringify({ file: path.join(shots, 'browser-drawer.png'), bytes: shot }))
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

test('settings: backend pill, read-modify-write and clearing browsing data', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port } = await startMockLlm([{ content: 'ok' }])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const shots = path.join(tmpdir(), 'meow-browser-panel-shots')
  mkdirSync(shots, { recursive: true })
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })
    const { app, window, sessionId } = await launch(userData)
    try {
      await expect(window.locator('.sb-browser')).toContainText('browser: built-in')
      const providerBefore = JSON.parse(readFileSync(path.join(userData, 'meow.json'), 'utf8')).provider

      // Switch to Chrome through the dialog; the pill and meow.json follow.
      await window.locator('.sb-browser').click()
      const dialog = window.locator('.browser-dialog')
      await expect(dialog).toBeVisible()
      await dialog.locator('.select-trigger').first().click()
      await window.getByRole('option', { name: 'Chrome' }).click()
      await expect(window.locator('.sb-browser')).toContainText(/browser: (waiting|off|paired)/, { timeout: 10000 })
      const saved = JSON.parse(readFileSync(path.join(userData, 'meow.json'), 'utf8'))
      expect(saved.browser.backend).toBe('chrome')
      expect(saved.provider).toEqual(providerBefore)
      await dialog.locator('.select-trigger').first().click()
      await window.getByRole('option', { name: 'Built-in' }).click()
      await expect(window.locator('.sb-browser')).toContainText('browser: built-in', { timeout: 10000 })
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      // Open the panel and leave data in the partition.
      await window.evaluate(({ id, u }) => window.api.browserTabCreate(id, u), { id: sessionId, u: url })
      await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]').click()
      await expect(window.locator('.browser-overlay')).toBeVisible()
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(true)
      const seedData = (): Promise<unknown> => app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { executeJavaScript(code: string): Promise<unknown> } }
        return child.webContents.executeJavaScript(
          "document.cookie='meow_e2e=1; path=/'; localStorage.setItem('meow_e2e','1'); [document.cookie, localStorage.getItem('meow_e2e')]"
        )
      }, url)
      expect(await seedData()).toEqual(['meow_e2e=1', '1'])
      const readData = (): Promise<unknown> => app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const child = win.contentView.children.find(c => {
          const wc = (c as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { executeJavaScript(code: string): Promise<unknown> } }
        return child.webContents.executeJavaScript("[document.cookie, localStorage.getItem('meow_e2e')]")
      }, url)

      // Clear data: the confirm sits above, Escape closes only it, the view stays hidden.
      await window.locator('.sb-browser').click()
      await expect(dialog).toBeVisible()
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(false)
      await dialog.getByRole('button', { name: 'Clear browsing data' }).first().click()
      const confirm = window.locator('[role="alertdialog"]')
      await expect(confirm).toBeVisible()
      const modalBytes = await compositeShot(app, url, path.join(shots, 'browser-settings-clear.png'))
      await window.keyboard.press('Escape')
      await expect(confirm).toHaveCount(0)
      await expect(dialog).toBeVisible()
      expect((await viewBounds(app, url))?.visible).toBe(false)

      await dialog.getByRole('button', { name: 'Clear browsing data' }).first().click()
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Clear browsing data' }).click()
      await expect(dialog).toContainText('Browsing data cleared.', { timeout: 10000 })
      await expect.poll(readData, { timeout: 15000 }).toEqual(['', null])

      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await viewBounds(app, url))?.visible, { timeout: 15000 }).toBe(true)
      console.log('[e2e] settings screenshot', JSON.stringify({ file: path.join(shots, 'browser-settings-clear.png'), bytes: modalBytes }))
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

test('the title bar toggles every panel, and each panel header is its tabs with no title', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const shots = path.join(tmpdir(), 'meow-browser-panel-shots')
  mkdirSync(shots, { recursive: true })
  try {
    seedUserData(userData, project, {})
    writeFileSync(path.join(project, 'notes.md'), '# Notes\n')
    const { app, window } = await launch(userData)
    try {
      const tool = (label: string) => window.locator(`.title-bar-tools .icon-btn[aria-label="Toggle ${label}"]`)
      const shot = async (name: string): Promise<void> => {
        const data = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
        const buffer = Buffer.from(data, 'base64')
        if (buffer.length === 0) throw new Error(`empty screenshot: ${name}`)
        writeFileSync(path.join(shots, name), buffer)
      }
      expect(await window.locator('.pane-header').count()).toBe(0)

      for (const [label, panel, head] of [
        ['files', '.files-overlay[aria-label="Files"]', '.panel-head'],
        ['tasks', '.tasks-panel', '.tasks-head'],
        ['terminal', '.terminal-overlay', '.panel-head'],
        ['browser', '.browser-overlay', '.panel-head']
      ] as const) {
        await tool(label).click()
        await expect(window.locator(panel)).toBeVisible()
        await expect(tool(label)).toHaveClass(/active/)
        await expect(window.locator(`${panel} ${head}`)).toHaveCount(1)
        expect(await window.locator(`${panel} .files-head-title`).count()).toBe(0)
        if (label === 'terminal') await expect(window.locator('.terminal-overlay .panel-tab.terminal-tab')).toHaveCount(1, { timeout: 20_000 })
        await shot(`panel-tabs-${label}.png`)
        await tool(label).click()
        await expect(window.locator(panel)).toHaveCount(0)
        await expect(tool(label)).not.toHaveClass(/active/)
      }

      // Files: an opened file is a tab in the header, and there is no second tab row.
      await tool('files').click()
      await window.locator('.files-overlay').getByText('notes.md').click()
      await expect(window.locator('.files-overlay .panel-head .panel-tab')).toHaveCount(1)
      await expect(window.locator('.files-overlay .panel-tab.active')).toContainText('notes.md')
      expect(await window.locator('.files-overlay .files-tabs').count()).toBe(0)
      await shot('panel-tabs-files-open.png')
      // Editing: no save buttons, a dot while unsaved, kept across a tab switch, Ctrl+S saves.
      writeFileSync(path.join(project, 'other.md'), 'other')
      expect(await window.locator('.files-overlay .viewer-actions').getByRole('button', { name: /Save|Copy|Open in VS Code/ }).count()).toBe(0)
      await window.locator('.files-overlay .viewer-actions').getByRole('button', { name: 'Edit Source' }).click()
      await window.locator('.files-overlay .cm-content').click()
      await window.keyboard.type('edited ')
      const dirtyDot = window.locator('.files-overlay .panel-tab .panel-tab-dirty')
      await expect(dirtyDot).toHaveCount(1)
      await shot('panel-tabs-files-dirty.png')
      await window.keyboard.press('Escape')
      await expect(window.locator('.files-overlay[aria-label="Files"]')).toBeVisible()
      await window.locator('.files-overlay [aria-label="Files menu"]').click()
      await window.locator('button.menu-item', { hasText: 'Refresh' }).click()
      await window.locator('.files-overlay').getByText('other.md', { exact: true }).click()
      await expect(window.locator('.files-overlay .panel-tab.active')).toContainText('other.md')
      await expect(dirtyDot).toHaveCount(1)
      await window.locator('.files-overlay .panel-tab', { hasText: 'notes.md' }).click()
      await expect(window.locator('.files-overlay .cm-content:visible')).toContainText('edited')
      await window.locator('.files-overlay .cm-content:visible').click()
      await window.keyboard.press('Control+s')
      await expect(dirtyDot).toHaveCount(0)
      expect(readFileSync(path.join(project, 'notes.md'), 'utf8')).toContain('edited')
      expect(readFileSync(path.join(project, 'other.md'), 'utf8')).toBe('other')
      await window.locator('.files-overlay .cm-content:visible').click()
      await window.keyboard.type('more ')
      await expect(dirtyDot).toHaveCount(1)
      await window.locator('.files-overlay [aria-label="Close notes.md"]').click()
      await expect(window.getByRole('button', { name: 'Discard' })).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(window.locator('.files-overlay .panel-tab', { hasText: 'notes.md' })).toHaveCount(1)
      await window.locator('.files-overlay [aria-label="Close notes.md"]').click()
      await window.getByRole('button', { name: 'Discard' }).click()
      await expect(window.locator('.files-overlay .panel-tab', { hasText: 'notes.md' })).toHaveCount(0)
      expect(readFileSync(path.join(project, 'notes.md'), 'utf8')).not.toContain('more')
      await window.locator('.files-overlay [aria-label="Close other.md"]').click()
      await expect(window.locator('.files-overlay .panel-tab')).toHaveCount(0)
      await window.locator('[aria-label="Close Files"]').click()

      // Nothing has opened a sub-agent yet.
      await expect(tool('sub-agents')).toBeDisabled()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('closing the Files panel asks before discarding, and expanding keeps the edits', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  const project2 = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {})
    const workspacesPath = path.join(userData, 'workspaces.json')
    const seeded = JSON.parse(readFileSync(workspacesPath, 'utf8')) as Array<Record<string, unknown>>
    seeded.push({ ...seeded[0], projectPath: project2, name: 'E2E Two', agents: [] })
    writeFileSync(workspacesPath, JSON.stringify(seeded, null, 2))
    writeFileSync(path.join(project, 'notes.txt'), 'hello\n')
    const { app, window } = await launch(userData)
    try {
      const filesTool = window.locator('.title-bar-tools .icon-btn[aria-label="Toggle files"]')
      const panel = window.locator('.files-overlay[aria-label="Files"]')
      const dot = panel.locator('.panel-tab-dirty')
      const discard = window.getByRole('button', { name: 'Discard' })
      const cancel = window.locator('.base-modal, [role="dialog"], [role="alertdialog"]').getByRole('button', { name: 'Cancel' })

      // A clean panel closes with no prompt.
      await filesTool.click()
      await expect(panel).toBeVisible()
      await filesTool.click()
      await expect(panel).toHaveCount(0)

      await filesTool.click()
      await panel.getByText('notes.txt', { exact: true }).click()
      await panel.locator('.cm-content').click()
      await window.keyboard.type('edited ')
      await expect(dot).toHaveCount(1)

      // Expanding and restoring move the panel between parents without losing anything.
      await panel.locator('[aria-label="Expand"]').click()
      await expect(panel).toHaveClass(/full/)
      await expect(panel.locator('.cm-content')).toContainText('edited')
      await expect(dot).toHaveCount(1)
      await panel.locator('[aria-label="Restore size"]').click()
      await expect(panel).toHaveClass(/docked/)
      await expect(panel.locator('.cm-content')).toContainText('edited')
      await expect(dot).toHaveCount(1)
      const box = await panel.boundingBox()
      expect(box && box.width > 200 && box.height > 200).toBe(true)

      // The close button: Cancel keeps everything.
      await panel.locator('[aria-label="Close Files"]').click()
      await expect(discard).toBeVisible()
      await cancel.click()
      await expect(discard).toHaveCount(0)
      await expect(panel.locator('.cm-content')).toContainText('edited')

      // The title bar button asks too.
      await filesTool.click()
      await expect(discard).toBeVisible()
      await cancel.click()
      await expect(panel).toBeVisible()

      // A project switch asks, and Cancel goes back to the edits.
      await window.locator('button[aria-label="menu E2E Two"]').click()
      await window.locator('.project-menu-dropdown').getByText('Open', { exact: true }).click()
      await expect(discard).toBeVisible()
      await cancel.click()
      await expect(discard).toHaveCount(0)
      await expect(filesTool).toHaveClass(/active/)
      await expect(panel.locator('.cm-content')).toContainText('edited')

      // Discard after a switch closes the panel and leaves the file on disk untouched.
      await window.locator('button[aria-label="menu E2E Two"]').click()
      await window.locator('.project-menu-dropdown').getByText('Open', { exact: true }).click()
      await discard.click()
      await expect(panel).toHaveCount(0)
      expect(readFileSync(path.join(project, 'notes.txt'), 'utf8')).toBe('hello\n')

      // After a discard nothing is considered dirty: reopening and closing does not ask.
      await filesTool.click()
      await expect(panel).toBeVisible()
      await filesTool.click()
      await expect(panel).toHaveCount(0)
      await expect(discard).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    cleanupDir(project2)
  }
})
