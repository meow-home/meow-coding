import { test, expect, _electron as electron, type Page } from '@playwright/test'
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
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
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
    await expect(window.locator('.context-footer-wrap')).toContainText('—')

    await window.locator('.chat-input-field').fill('hello meow')
    await window.locator('.chat-input-field').press('Enter')
    await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

    // The readout lives in `.context-footer-wrap`; the level class is on
    // `.context-ring` (`.context-footer` itself no longer exists).
    const footer = window.locator('.context-footer-wrap')
    await expect(footer).toContainText('4,231')
    await expect(footer).toContainText('(98% left)')
    await expect(window.locator('.context-ring')).not.toHaveClass(/warn|danger/)

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
    await expect(window.locator('.context-footer-wrap')).toContainText('4,231')

    // New session (the sidebar project row's "+") -> creating it makes it the
    // active session, so the footer is back to the placeholder.
    await window.getByRole('button', { name: 'new session E2E Project', exact: true }).click()
    await expect(window.locator('.context-footer-wrap')).toContainText('—')

    await app.close()
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('context footer turns danger and shows the compacting note past the auto-compact threshold', async () => {
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
      compaction: { auto: true, buffer: 100, keepTokens: 200, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
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

      await expect(window.locator('.context-ring')).toHaveClass(/danger/)
      await expect(window.locator('.context-footer-wrap')).toContainText('compacting soon')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('the context readout is a 24x24 icon button with a hover background', async () => {
  const { server, port } = await startMockLlm([
    { content: 'unused', usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
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

      const ring = window.locator('.context-ring')
      await expect(ring).toBeVisible()

      // The box is the icon-button square (was 30x30), matching the sidebar buttons.
      const box = await ring.boundingBox()
      expect(Math.round(box!.width)).toBe(24)
      expect(Math.round(box!.height)).toBe(24)
      expect(await ring.evaluate(e => getComputedStyle(e).borderRadius)).toBe('3px')

      // The ring shrank with the box so the arc keeps its clearance inside it.
      const svg = await ring.locator('svg').boundingBox()
      expect(Math.round(svg!.width)).toBe(20)
      expect(Math.round(svg!.height)).toBe(20)

      // A readout, not a button: transparent at rest, hover lifts it, cursor stays default.
      expect(await ring.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      const bgHover = await resolveVar(window, '--bg-hover')
      // Move the pointer onto the ring explicitly: `locator.hover()` retargets to
      // the element's own center and races the pane's mount animation, which made
      // this assertion flaky when the whole file ran in one worker.
      await window.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await expect.poll(() => ring.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(bgHover)
      await expect(ring).toHaveCSS('cursor', 'default')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('the context popover is wider than the 200px floor and keeps its rows on one line', async () => {
  // Realistic counts (a real session's ~145k prompt tokens): with short content
  // the popover's width is decided by its min-width floor, not by the text, so
  // this fixture is what makes the 216px assertion meaningful.
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
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
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

      // A real turn, so the popover carries its longest rows (tokens in/out).
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

      const popover = window.locator('.context-footer-popover')
      const wrapBox = await window.locator('.context-footer-wrap').boundingBox()
      await window.mouse.move(wrapBox!.x + wrapBox!.width / 2, wrapBox!.y + wrapBox!.height / 2)
      await expect(popover).toBeVisible()

      // Wider than the old 200px floor, and nothing is clipped horizontally.
      // (Measured before this change: 200px exactly — the floor, not the text.)
      const metrics = await popover.evaluate(e => ({ w: e.offsetWidth, scroll: e.scrollWidth, client: e.clientWidth }))
      expect(metrics.w).toBeGreaterThanOrEqual(216)
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1)

      // Guard, not a fix: with short values the box is already content-driven and
      // does not wrap, but `width: max-content` alone stops applying the moment an
      // ancestor is clamped — so assert the rows can never break. A range over the
      // row is useless here — the row is a flex container, so each span is
      // blockified and the range reports one rect per span, not per line. Measure
      // the TEXT NODES instead: a range over a text node yields one rect per line
      // fragment, so stacked (wrapped) lines are visible. Fragments whose vertical
      // spans overlap belong to the same line (the label uses the UI font and the
      // value the mono font, so their tops differ even on one line).
      const rowLines = await window.locator('.context-popover-row').evaluateAll(rows =>
        rows.map(row => {
          const rects: DOMRect[] = []
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.nodeValue?.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            rects.push(...Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0))
          }
          rects.sort((a, b) => a.top - b.top)
          let lines = 0
          let lineBottom = -Infinity
          for (const r of rects) {
            if (r.top >= lineBottom - 1) {
              lines++
              lineBottom = r.bottom
            } else {
              lineBottom = Math.max(lineBottom, r.bottom)
            }
          }
          return lines
        })
      )
      expect(rowLines.length).toBeGreaterThan(0)
      expect(rowLines, `lines per row: ${JSON.stringify(rowLines)}`).toEqual(rowLines.map(() => 1))

      // The mechanism, stated explicitly so a later edit cannot silently undo it.
      const nowrap = await window.locator('.context-popover-row').evaluateAll(rows =>
        rows.map(row => getComputedStyle(row).whiteSpace)
      )
      expect(nowrap.every(v => v === 'nowrap')).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
