import { test, expect, _electron as electron, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

interface MockTurn {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// Fakes just enough of the OpenAI-compatible streaming chat endpoint
// (@ai-sdk/openai-compatible) for the real IPC -> manager -> loop -> llm
// pipeline to run end to end without a real provider API key.
function startMockLlm(turns: MockTurn[]): Promise<{ server: http.Server; port: number }> {
  let call = 0
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    req.on('data', () => {})
    req.on('end', () => {
      const turn = turns[Math.min(call, turns.length - 1)]
      call++
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = (obj: unknown): void => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`)
      }
      send({ id: 'mock-1', choices: [{ delta: { role: 'assistant', content: turn.content } }] })
      send({ id: 'mock-1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: turn.usage })
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

// Electron leaves cache file handles open briefly after app.close() on
// Windows; retry, then give up quietly. A locked Chrome cache file in a temp
// dir must never fail the test that already ran - and because this runs in
// `finally`, a throw here would REPLACE a real assertion failure from the try
// block, hiding the actual bug behind an EPERM.
function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    console.warn(`[e2e] could not remove ${dir}: ${String(err)}`)
  }
}

// SessionPanes keeps every opened session's pane mounted and marks the inactive
// ones with [hidden], so a bare `.context-footer-wrap` / `.context-ring` lookup
// matches the kept-alive session too (strict-mode violation). Always read the
// readout through the visible pane.
function pane(window: Page): Locator {
  return window.locator('.pane-slot:not([hidden])')
}

function seedUserData(userData: string, project: string, meowConfig: Record<string, unknown>): void {
  const workspaces = [{
    projectPath: project,
    name: 'E2E Project',
    agents: [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }]
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  writeFileSync(path.join(userData, 'meow.json'), JSON.stringify(meowConfig, null, 2))
}

/** Resolves a CSS variable to a concrete rgb() string, for comparing computed colours. */
function resolveVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n: string) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, name)
}

test('context footer shows real token usage, persists across reload, resets on new session', async () => {
  const { server, port } = await startMockLlm([
    { content: 'hi there', usage: { prompt_tokens: 3800, completion_tokens: 431, total_tokens: 4231 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000 }
    })

    let app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    let window = await app.firstWindow()
    await expect(window.locator('.project-row')).toBeVisible()
    await window.locator('.project-toggle').click()
    await window.locator('.session-list .session-row').first().click()
    await expect(window.locator('.chat-panel')).toBeVisible()

    // No messages yet -> placeholder, not a stale number.
    await pane(window).locator('.context-ring').click()
    await expect(window.locator('.context-panel')).toContainText('—')
    await window.keyboard.press('Escape')
    await expect(window.locator('.context-panel')).toHaveCount(0)

    await window.locator('.chat-input-field').fill('hello meow')
    await window.locator('.chat-input-field').press('Enter')
    await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

    // The readout lives in `.context-footer-wrap`; the level class is on
    // `.context-ring` (`.context-footer` itself no longer exists).
    await pane(window).locator('.context-ring').click()
    const panel = window.locator('.context-panel')
    await expect(panel).toContainText('4,231')
    await expect(panel).toContainText('(98% left)')
    await expect(pane(window).locator('.context-ring')).not.toHaveClass(/warn|danger/)

    await app.close()

    // Relaunch against the same user data / session: footer must read the
    // persisted ChatMessage.tokens, not reset to the placeholder.
    app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    window = await app.firstWindow()
    // Same user data: the sidebar restores its persisted expanded state, so the
    // session list is already open — just reselect the session to open its panes.
    await window.locator('.session-list .session-row').first().click()
    await pane(window).locator('.context-ring').click()
    await expect(window.locator('.context-panel')).toContainText('4,231')
    await window.keyboard.press('Escape')

    // New session (the sidebar project row's "+") -> creating it makes it the
    // active session, so the footer is back to the placeholder.
    await window.getByRole('button', { name: 'new session E2E Project', exact: true }).click()
    await pane(window).locator('.context-ring').click()
    await expect(window.locator('.context-panel')).toContainText('—')

    await app.close()
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('context footer turns danger past the auto-compact threshold', async () => {
  const { server, port } = await startMockLlm([
    { content: 'near limit', usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    // maxContextTokens 1100 - buffer 100 = compactThreshold 1000, matched
    // exactly by the mock's reported total_tokens so contextLevel lands on
    // 'danger' (>=) without needing a second, warn-level turn.
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 1100,
      compaction: { auto: true, buffer: 100, keepTokens: 200, tailTurns: 2, toolOutputMaxChars: 2000 }
    })

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await window.locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('near limit')

      await expect(pane(window).locator('.context-ring')).toHaveClass(/danger/)
      await pane(window).locator('.context-ring').click()
      await expect(window.locator('.context-panel')).toContainText('(9% left)')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('the context readout is an icon button that opens the request breakdown', async () => {
  const { server, port } = await startMockLlm([
    { content: 'hi there', usage: { prompt_tokens: 145503, completion_tokens: 431, total_tokens: 145934 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000 }
    })

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      const ring = pane(window).locator('.context-ring')
      await expect(ring).toBeVisible()
      await expect(ring).toHaveAttribute('aria-expanded', 'false')

      // Same box as the sidebar icon buttons (2rem at the 13px root font).
      const box = await ring.boundingBox()
      expect(Math.round(box!.width)).toBe(26)
      expect(Math.round(box!.height)).toBe(26)
      expect(await ring.evaluate(e => getComputedStyle(e).borderRadius)).toBe('3.25px')

      // The arc keeps its clearance inside the box (SIZE/STROKE in ContextFooter).
      const svg = await ring.locator('svg').boundingBox()
      expect(Math.round(svg!.width)).toBe(16)
      expect(Math.round(svg!.height)).toBe(16)

      // A button now: it opens the panel, and hover lifts its box.
      expect(await ring.evaluate(e => getComputedStyle(e).cursor)).toBe('pointer')
      const bgHover = await resolveVar(window, '--bg-hover')
      await window.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await expect.poll(() => ring.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(bgHover)

      // A real turn first, so the breakdown has a transcript to attribute.
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

      await ring.click()
      await expect(ring).toHaveAttribute('aria-expanded', 'true')

      // Portaled to <body> (BaseDropdown), so it is NOT inside the pane slot.
      const panel = window.locator('.context-panel')
      await expect(panel).toBeVisible()
      await expect(panel.locator('.context-popover-row').first()).toContainText('145,934')
      await expect(panel.locator('.context-popover-row').first()).toContainText('(27% left)')
      await expect(panel.locator('.context-popover-row').nth(1)).toContainText(' in / ')

      // Header rows never wrap: each stays one line.
      const rowLines = await panel.locator('.context-popover-row').evaluateAll(rows =>
        rows.map(row => row.getClientRects().length)
      )
      expect(rowLines.every(n => n === 1)).toBe(true)

      // The breakdown is one total per bucket — no drill-down rows.
      await expect(panel).toContainText('System prompt')
      await expect(panel).toContainText('Messages')
      await expect(panel).toContainText('Free space')
      expect(await panel.locator('.context-section-head').count()).toBeGreaterThanOrEqual(4)
      await expect(panel.locator('button.context-section-head')).toHaveCount(0)
      await expect(panel.locator('.context-section-items')).toHaveCount(0)

      const bar = panel.locator('.context-bar-seg')
      expect(await bar.count()).toBeGreaterThanOrEqual(4)

      // 20rem wide and fully inside the window: the panel opens above the ring,
      // so it must never be pushed off the top or clipped by the composer.
      const panelBox = (await panel.boundingBox())!
      expect(Math.round(panelBox.width)).toBe(260)
      expect(panelBox.y).toBeGreaterThanOrEqual(0)
      const viewport = await window.evaluate(() => window.innerHeight)
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
