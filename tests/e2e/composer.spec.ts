import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

interface MockTurn {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

// A gate-ended variant of the mock LLM in context-footer.spec.ts: it accepts the
// `@ai-sdk/openai-compatible` streaming request but holds the response body open
// until `release()` is called. That keeps a real turn in flight ("running") for
// as long as a test needs, so the composer can be inspected while a turn is
// genuinely mid-turn rather than racing an instant reply.
async function startGatedMockLlm(turn: MockTurn): Promise<{
  server: http.Server
  port: number
  firstCall: Promise<void>
  release: () => void
}> {
  let resolveCall: () => void = () => {}
  const firstCall = new Promise<void>(resolve => { resolveCall = resolve })
  let pendingRelease: (() => void) | null = null
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    req.on('data', () => {})
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const send = (obj: unknown): void => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`)
      }
      resolveCall()
      pendingRelease = () => {
        send({ id: 'mock-1', choices: [{ delta: { role: 'assistant', content: turn.content } }] })
        send({ id: 'mock-1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: turn.usage })
        res.write('data: [DONE]\n\n')
        res.end()
      }
    })
  })
  const port = await new Promise<number>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
  return { server, port, firstCall, release: () => pendingRelease?.() }
}

// Electron leaves cache file handles open briefly after app.close() on Windows;
// retry so a transient EPERM/EBUSY never masks a real assertion failure.
function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function seedWorkspaces(userData: string, project: string): void {
  const workspaces = [{
    projectPath: project,
    name: 'E2E Project',
    agents: [{ id: 'e2e-0', name: 'Alpha', templateId: 'meow', cwd: project, kind: 'native' }]
  }]
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  // Mark the one-time v0.37 "single native session" migration as already done:
  // without this flag main rewrites the seeded workspace to one fresh session.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

function seedMeowConfig(userData: string, port: number): void {
  writeFileSync(path.join(userData, 'meow.json'), JSON.stringify({
    provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
    model: 'mock',
    maxContextTokens: 200000,
    compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
  }, null, 2))
}

async function launch(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toBeVisible()
  return { app, window }
}

async function openProject(window: Page): Promise<void> {
  await window.locator('.project-toggle').click()
  await expect(window.locator('.session-list')).toBeVisible()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.session-panes')).toBeVisible()
}

const PLACEHOLDER_IDLE = 'Type a message... (/ for commands)'
const PLACEHOLDER_RUNNING = 'Processing...'
const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

/**
 * The height the card must have with a single-line field: its own border +
 * padding around a textarea whose box is its padding plus exactly one line box.
 * Derived from the live computed styles, because the root font-size is
 * user-configurable. If the field renders more than one line, the measured card
 * height exceeds this and the assertion that compares them fails.
 */
function oneLineCardHeight(card: Locator): Promise<number> {
  return card.evaluate(el => {
    const cs = getComputedStyle(el)
    const field = el.querySelector('.chat-input-field')!
    const fs = getComputedStyle(field)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const fieldBox = parseFloat(fs.paddingTop) + parseFloat(fs.paddingBottom) + parseFloat(fs.lineHeight)
    return Math.round(border + pad + fieldBox)
  })
}

function lineHeight(field: Locator): Promise<number> {
  return field.evaluate(el => parseFloat(getComputedStyle(el).lineHeight))
}

test('the composer card is one line tall, with the send button inside its right edge', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const send = card.locator('.chat-input-send')

      // The toolbar line is gone — that was the whole reason the empty card was
      // two text rows tall.
      await expect(card.locator('.chat-input-toolbar')).toHaveCount(0)

      await expect(send).toBeVisible()
      await expect(send).toHaveAttribute('aria-label', 'Send')
      await expect(send).toBeDisabled()

      const cardBox = (await card.boundingBox())!
      const sendBox = (await send.boundingBox())!
      expect(Math.round(cardBox.height)).toBe(await oneLineCardHeight(card))

      // Inside the frame, at its right edge, inset by the card's own padding.
      const padRight = await card.evaluate(el => parseFloat(getComputedStyle(el).paddingRight))
      expect(Math.round(cardBox.x + cardBox.width - (sendBox.x + sendBox.width))).toBe(Math.round(padRight))
      expect(Math.round(sendBox.width)).toBe(24)
      expect(Math.round(sendBox.height)).toBe(24)

      // Centred on the single text line at rest.
      const lineCenter = await card.locator('.chat-input-field').evaluate(el => {
        const cs = getComputedStyle(el)
        return el.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight) / 2
      })
      expect(Math.abs((sendBox.y + sendBox.height / 2) - lineCenter)).toBeLessThanOrEqual(1)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('the input grows with the text, caps at eight lines and shrinks back', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')

      // The growth mechanism is CSS-only. If this ever fails, the spec's JS
      // autoGrow fallback is required.
      expect(await window.evaluate(() => CSS.supports('field-sizing', 'content'))).toBe(true)

      const rest = await oneLineCardHeight(card)
      const lh = await lineHeight(field)
      expect(Math.round((await card.boundingBox())!.height)).toBe(rest)

      // Every line the field takes must be a line the card gains.
      await field.fill('one\ntwo\nthree\nfour\nfive')
      await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(rest + 4 * lh)

      // Past the cap the field scrolls instead of growing: 8 lines is the most it
      // shows, so the card tops out 7 line-heights above rest, and the cap is
      // exactly 8 lines plus the field's own padding.
      const padY = await field.evaluate(el => {
        const cs = getComputedStyle(el)
        return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      })
      const maxHeight = await field.evaluate(el => parseFloat(getComputedStyle(el).maxHeight))
      expect(Math.round(maxHeight)).toBe(Math.round(padY + 8 * lh))
      await field.fill(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'))
      await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(rest + 7 * lh)
      const scrolled = await field.evaluate(el => {
        const t = el as HTMLTextAreaElement
        return t.scrollHeight > t.clientHeight
      })
      expect(scrolled).toBe(true)

      // And shrinking is as important as growing: an emptied field must give the
      // space back, or the card stays permanently tall.
      await field.fill('')
      await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(rest)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('clicking send submits the message and resets the field', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({ content: 'mock answer', usage: USAGE })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')
      const send = card.locator('.chat-input-send')

      await expect(send).toBeDisabled()

      // Whitespace is not content: submit() trims before sending.
      await field.fill('   ')
      await expect(send).toBeDisabled()

      await field.fill('hello composer')
      await expect(send).toBeEnabled()
      await send.click()
      await expect(window.locator('.chat-msg.user').last()).toContainText('hello composer')
      await expect(field).toHaveValue('')
      await firstCall
      release()

      // The turn ends, so the slot is Send again — and empty again, so disabled.
      await expect(send).toBeVisible()
      await expect(send).toBeDisabled()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('Enter sends and Shift+Enter adds a newline', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({ content: 'mock answer', usage: USAGE })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')

      await field.fill('line one')
      await field.press('Shift+Enter')
      await field.pressSequentially('line two')
      await expect(field).toHaveValue('line one\nline two')

      await field.press('Enter')
      await firstCall
      release()
      await expect(window.locator('.chat-msg.user').last()).toContainText('line one')
      await expect(field).toHaveValue('')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('while a turn runs the button becomes stop, and Enter still queues', async () => {
  const { server, port, firstCall } = await startGatedMockLlm({ content: 'held answer', usage: USAGE })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')

      await field.fill('hold the line')
      await field.press('Enter')
      await firstCall

      await expect(card.locator('.chat-input-stop')).toBeVisible()
      await expect(card.locator('.chat-input-send')).toHaveCount(0)
      await expect(field).toHaveAttribute('placeholder', PLACEHOLDER_RUNNING)

      // Sending while a turn runs queues the message (max 5) rather than starting
      // a second turn — the queue is meow's steering feature, so the composer must
      // stay writable while the button is Stop.
      await field.fill('queued while running')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-item')).toHaveCount(1)
      await expect(window.locator('.chat-queue-text')).toHaveText('queued while running')
      await expect(field).toHaveValue('')

      // The mock never releases, so the turn is still in flight and the slot is
      // still Stop.
      await expect(card.locator('.chat-input-stop')).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('editing a queued message while running swaps stop for a save button', async () => {
  const { server, port, firstCall } = await startGatedMockLlm({ content: 'held answer', usage: USAGE })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')

      await field.fill('first turn')
      await field.press('Enter')
      await firstCall

      // Only a message sent *while* a turn runs lands in the queue: the first send
      // became the running turn itself.
      await field.fill('queued text')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-item')).toHaveCount(1)

      // Clicking the queued row loads it into the composer for editing.
      await window.locator('.chat-queue-text').click()
      await expect(field).toHaveValue('queued text')
      // Editing is not "running": the slot is Send, not Stop, even though a turn
      // is in flight.
      await expect(card.locator('.chat-input-stop')).toHaveCount(0)
      const send = card.locator('.chat-input-send')
      await expect(send).toBeVisible()
      await expect(send).toBeEnabled()
      await expect(send).toHaveAttribute('aria-label', 'Save edit')

      await field.fill('edited while running')
      await send.click()
      await expect(window.locator('.chat-queue-text')).toHaveText('edited while running')

      // The edit is saved, so edit mode ends and the turn's Stop comes back.
      await expect(card.locator('.chat-input-stop')).toBeVisible()
      await expect(card.locator('.chat-input-send')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('stop ends the turn and brings the send button back', async () => {
  const { server, port, firstCall } = await startGatedMockLlm({ content: 'held answer', usage: USAGE })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const field = card.locator('.chat-input-field')

      // Nothing is queued: with a non-empty queue, stop drains it and immediately
      // starts the next turn, so the composer would stay in the running state.
      await field.fill('stop me')
      await field.press('Enter')
      await firstCall
      await expect(card.locator('.chat-input-stop')).toBeVisible()

      await card.locator('.chat-input-stop').click()
      // Aborting emits done(reason: stopped) -> the composer returns to Send.
      await expect(card.locator('.chat-input-send')).toBeVisible()
      await expect(field).toHaveAttribute('placeholder', PLACEHOLDER_IDLE)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
