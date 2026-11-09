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
  // Tool results are JSON strings; unescape so previews and titles read naturally.
  return raw.replace(/\\"/g, '"').replace(/\\n/g, '\n')
}

/** Ref of an element as printed by browser_read, from the latest snapshot in the transcript. */
function refFor(body: unknown, label: string): string {
  const text = conversationText(body)
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...text.matchAll(new RegExp(`(?:button|link|textbox) "${escaped}" \\[(r\\d+)\\]`, 'g'))]
  if (matches.length === 0) {
    console.error(`[e2e] no snapshot ref for "${label}"; conversation tail:
${text.slice(-5000)}`)
    throw new Error(`no snapshot ref for "${label}"`)
  }
  return matches[matches.length - 1][1]
}

function titlesIn(body: unknown): string[] {
  return [...conversationText(body).matchAll(/"title":\s*"([^"]*)"/g)].map(m => m[1])
}

// Fakes the OpenAI-compatible streaming endpoint. A turn may compute its tool
// arguments (or its final text) from the request, which is how the mock finds
// the ref of an element it only learns about from the browser_read result.
function startMockLlm(turns: MockTurn[]): Promise<{ server: http.Server; port: number }> {
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
      const callId = `call_${call}`
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = (obj: unknown): void => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`)
      }
      if (turn.toolCall) {
        const args = typeof turn.toolCall.args === 'function' ? await turn.toolCall.args(body) : turn.toolCall.args
        send({
          id: 'mock-1',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{
                index: 0,
                id: callId,
                type: 'function',
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
      resolve({ server, port })
    })
  })
}

// The fixture the built-in browser drives. The iframe button comes first in the
// AX tree; the far button sits below a 1800px spacer so its click only lands if
// scroll + box-model coordinates are right; the input reflects its value into
// document.title, which browser_list_tabs reports.
function startFixtureServer(host = '127.0.0.1'): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (req.url?.startsWith('/frame')) {
      res.end('<!doctype html><body><button id="inner" onclick="parent.document.title=\'frame-clicked\'">Inner</button></body>')
      return
    }
    res.end(`<!doctype html><html><head><title>fixture</title></head><body style="margin:0">
      <iframe src="/frame" width="320" height="120" style="border:0"></iframe>
      <iframe srcdoc="<button id='sd' onclick='parent.document.title=&quot;srcdoc-clicked&quot;'>Srcdoc button</button>"></iframe>
      <div style="height:1800px">spacer</div>
      <button id="far" onclick="document.title='far-clicked'">Far button</button>
      <input id="name" aria-label="Name" oninput="document.title='name:'+this.value">
      <button id="approve" onclick="window.__approve=(window.__approve||0)+1;document.title='approve:'+window.__approve">Approve button</button>
      <script>
        window.__clicks = 0
        window.__keys = 0
        document.addEventListener('click', () => { window.__clicks++ })
        document.addEventListener('keydown', () => { window.__keys++ })
      </script>
    </body></html>`)
  })
  return new Promise(resolve => {
    server.listen(0, host, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, url: `http://${host}:${port}/` })
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

async function launch(userData: string): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; window: Page }> {
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
  return { app, window }
}

test('the agent drives the built-in browser: navigate, read, click by ref, scroll, type', async () => {
  const { server: fixture, url } = await startFixtureServer()
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_read', args: {} } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Inner') }) } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { toolCall: { name: 'browser_navigate', args: { url: `${url}?v=2` } } },
    { toolCall: { name: 'browser_read', args: {} } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Srcdoc button') }) } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Far button') }) } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    { toolCall: { name: 'browser_type', args: (body: unknown) => ({ ref: refFor(body, 'Name'), text: 'hello' }) } },
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

    const { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('drive the browser')
      await window.locator('.chat-input-field').press('Enter')

      // The mock reports every title it saw in the tool results, in order.
      const final = window.locator('.chat-msg.assistant').last()
      await expect(final).toContainText('name:hello', { timeout: 55_000 })
      const text = (await final.textContent()) ?? ''
      // Clicking the iframe button, the srcdoc button, the below-the-fold button
      // (scrolled into view) and typing into the input — all by ref after the
      // second read — reached the page.
      expect(text).toContain('frame-clicked')
      expect(text).toContain('srcdoc-clicked')
      expect(text).toContain('far-clicked')

      // The transcript really contains the tool calls, including the final listTabs.
      await expect(window.locator('.tool-call-badge', { hasText: 'browser_navigate' })).toHaveCount(2)
      await expect(window.locator('.tool-call-badge', { hasText: 'browser_read' })).toHaveCount(2)
      await expect(window.locator('.tool-call-badge', { hasText: 'browser_list_tabs' })).toHaveCount(4)
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

test('a crashed tab is recovered by browser_navigate', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let crashBrowser = async (): Promise<void> => { throw new Error('app not launched') }
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    {
      toolCall: {
        name: 'browser_click',
        args: async () => {
          await crashBrowser()
          return { x: 5, y: 5 }
        }
      }
    },
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_click', args: { selector: '#far' } } },
    { toolCall: { name: 'browser_list_tabs', args: {} } },
    {
      contentFrom: (body: unknown) => {
        const text = conversationText(body)
        return `crashed-error=${text.includes('tab crashed; call browser_navigate to reload it')} titles: ${titlesIn(body).join(' | ')}`
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

    const { app, window } = await launch(userData)
    // Runs inside the mock's next turn, after the first navigation.
    crashBrowser = async () => {
      await app.evaluate(({ BrowserWindow }, fixtureUrl) => {
        const win = BrowserWindow.getAllWindows()[0]
        const view = win.contentView.children.find(child => {
          const wc = (child as unknown as { webContents?: { getURL(): string } }).webContents
          return !!wc && wc.getURL().startsWith(fixtureUrl)
        }) as unknown as { webContents: { forcefullyCrashRenderer(): void } } | undefined
        if (!view) throw new Error('built-in browser view not found')
        view.webContents.forcefullyCrashRenderer()
      }, url)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    try {
      await window.locator('.chat-input-field').fill('crash the browser')
      await window.locator('.chat-input-field').press('Enter')

      const final = window.locator('.chat-msg.assistant').last()
      await expect(final).toContainText('crashed-error=true', { timeout: 55_000 })
      // The navigate after the crash really reloaded the page: the click landed.
      expect(await final.textContent()).toContain('far-clicked')
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

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>

interface ShieldWebContentsLike {
  id: number
  getURL(): string
  sendInputEvent(event: unknown): void
  executeJavaScript<T>(code: string): Promise<T>
}

interface ShieldViewLike {
  webContents?: ShieldWebContentsLike
  getBounds(): { x: number; y: number; width: number; height: number }
  getVisible(): boolean
}

interface ShieldInspection {
  childCount: number
  pageId: number
  shieldId: number
  shieldAbove: boolean
  sameBounds: boolean
  shieldVisible: boolean
  shieldUrl: string
  pageClicks: number
  pageKeys: number
}

/** Finds the page/shield views of the built-in browser and probes synthetic input. */
function inspectShield(app: ElectronApp, fixtureUrl: string): Promise<ShieldInspection> {
  return app.evaluate(({ BrowserWindow }, fixture) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as ShieldViewLike[]
    const page = children.find(c => c.webContents?.getURL().startsWith(fixture))
    const shield = children.find(c => c.webContents?.getURL().startsWith('data:text/html'))
    if (!page || !shield || !page.webContents || !shield.webContents) {
      throw new Error(`browser views not found (${children.length} children)`)
    }
    const pageWc = page.webContents
    const shieldWc = shield.webContents
    const sameBounds = JSON.stringify(page.getBounds()) === JSON.stringify(shield.getBounds())
    const above = children.indexOf(shield) === children.indexOf(page) + 1
    // Synthetic input: it reaches the target webContents directly, so this proves the
    // shield is the view receiving it, not that an OS hit test picks the shield (S3 did that).
    shieldWc.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 })
    shieldWc.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 })
    // A key sent to the page while the shield is up must be swallowed by before-input-event.
    pageWc.sendInputEvent({ type: 'keyDown', keyCode: 'a' })
    pageWc.sendInputEvent({ type: 'keyUp', keyCode: 'a' })
    return pageWc.executeJavaScript<{ clicks: number; keys: number }>('({ clicks: window.__clicks, keys: window.__keys })')
      .then((counters) => ({
        childCount: children.length,
        pageId: pageWc.id,
        shieldId: shieldWc.id,
        shieldAbove: above,
        sameBounds,
        shieldVisible: shield.getVisible(),
        shieldUrl: shieldWc.getURL().slice(0, 24),
        pageClicks: counters.clicks,
        pageKeys: counters.keys
      }))
  }, fixtureUrl)
}

function shieldVisibility(app: ElectronApp): Promise<{ childCount: number; visible: boolean }> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const children = win.contentView.children as unknown as ShieldViewLike[]
    const shield = children.find(c => c.webContents?.getURL().startsWith('data:text/html'))
    return { childCount: children.length, visible: shield ? shield.getVisible() : false }
  })
}

test('the shield covers the page while the agent works and is destroyed with the session', async () => {
  const { server: fixture, url } = await startFixtureServer()
  let appRef: ElectronApp | null = null
  let probe: ShieldInspection | null = null
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    {
      toolCall: {
        name: 'browser_list_tabs',
        args: async () => {
          if (!appRef) throw new Error('app not launched')
          probe = await inspectShield(appRef, url)
          return {}
        }
      }
    },
    { contentFrom: () => 'shield probe done' }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })

    const { app, window } = await launch(userData)
    appRef = app
    try {
      await window.locator('.chat-input-field').fill('show the shield')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('shield probe done', { timeout: 55_000 })

      const seen = probe as ShieldInspection | null
      expect(seen, 'shield probe did not run').not.toBeNull()
      expect(seen!.childCount).toBe(2)
      expect(seen!.shieldAbove).toBe(true)
      expect(seen!.sameBounds).toBe(true)
      expect(seen!.shieldVisible).toBe(true)
      expect(seen!.shieldUrl.startsWith('data:text/html;charset=')).toBe(true)
      expect(seen!.pageClicks).toBe(0)
      expect(seen!.pageKeys).toBe(0)

      // The turn ended: releaseOwner drops the lease and hides the shield.
      await expect.poll(async () => (await shieldVisibility(app)).visible).toBe(false)

      // Deleting the session destroys both renderers.
      const sessionId = await window.evaluate(async (projectPath) => {
        const api = (window as unknown as {
          api: { listWorkspaces(): Promise<Array<{ projectPath: string; sessions?: Array<{ id: string }> }>> }
        }).api
        const list = await api.listWorkspaces()
        return list.find(ws => ws.projectPath === projectPath)?.sessions?.[0]?.id ?? null
      }, project)
      expect(sessionId).toBeTruthy()
      await window.evaluate(async ({ projectPath, agentId }) => {
        await (window as unknown as { api: { removeAgent(p: string, a: string): Promise<void> } })
          .api.removeAgent(projectPath, agentId)
      }, { projectPath: project, agentId: sessionId! })
      await expect.poll(async () => {
        const destroyed = await app.evaluate(({ webContents }, ids) => ({
          page: webContents.fromId(ids.pageId)?.isDestroyed() ?? null,
          shield: webContents.fromId(ids.shieldId)?.isDestroyed() ?? null
        }), { pageId: seen!.pageId, shieldId: seen!.shieldId })
        return destroyed.page !== false && destroyed.shield !== false
      }, { timeout: 5000 }).toBe(true)
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

test('a non-loopback site needs approval: Deny blocks, session allow lets it through', async () => {
  // 127.0.0.2 is in the loopback range for the OS but not exempt in our policy,
  // so this is a real non-loopback origin without a production hook.
  const { server: fixture, url } = await startFixtureServer('127.0.0.2')
  const { server: llm, port } = await startMockLlm([
    { toolCall: { name: 'browser_navigate', args: { url } } },
    { toolCall: { name: 'browser_read', args: {} } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Approve button') }) } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Approve button') }) } },
    { toolCall: { name: 'browser_click', args: (body: unknown) => ({ ref: refFor(body, 'Approve button') }) } },
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
    const { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('approve the site')
      await window.locator('.chat-input-field').press('Enter')

      // First click: the prompt names the tool, the origin and what the page calls
      // the target; Deny blocks it.
      const prompt = window.locator('.chat-prompt')
      await expect(prompt).toBeVisible({ timeout: 30000 })
      await expect(prompt).toContainText('browser_click on http://127.0.0.2')
      await expect(prompt).toContainText('button "Approve button"')
      await prompt.locator('.chat-option', { hasText: 'Deny' }).click()
      await expect(window.locator('.tool-call-error')).toContainText('not approved')

      // Second click: allow this site for the session, then the third click runs
      // with no prompt at all.
      await expect(window.locator('.chat-prompt')).toBeVisible({ timeout: 30000 })
      await window.locator('.chat-option', { hasText: 'Allow this site for the session' }).click()

      const final = window.locator('.chat-msg.assistant').last()
      await expect(final).toContainText('approve:2', { timeout: 55000 })
      expect(await window.locator('.chat-prompt').count()).toBe(0)
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
