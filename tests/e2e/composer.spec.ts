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
    compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000 }
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

const PLACEHOLDER_IDLE = 'Ask anything, @ to mention, / for actions'
const PLACEHOLDER_RUNNING = 'Processing...'
const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

/**
 * The height the card must have with a single-line field: its own border +
 * padding, a textarea whose box is its padding plus exactly one line box, and
 * the control bar underneath (measured live — the round send button sets it).
 * Derived from the live computed styles, because the root font-size is
 * user-configurable. If the field renders more than one line, the measured card
 * height exceeds this and the assertion that compares them fails.
 */
function oneLineCardHeight(card: Locator): Promise<number> {
  return card.evaluate(el => {
    const cs = getComputedStyle(el)
    const field = el.querySelector('.chat-input-field')!
    const bar = el.querySelector('.chat-input-bar')!
    const fs = getComputedStyle(field)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const fieldBox = parseFloat(fs.paddingTop) + parseFloat(fs.paddingBottom) + parseFloat(fs.lineHeight)
    return Math.round(border + pad + fieldBox + bar.getBoundingClientRect().height)
  })
}

function lineHeight(field: Locator): Promise<number> {
  return field.evaluate(el => parseFloat(getComputedStyle(el).lineHeight))
}

/** The live root font-size in px: every rem-derived metric scales with it. */
function rootFontSize(window: Page): Promise<number> {
  return window.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
}

test('the composer is one card: the field on top, every control on one bottom row', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const card = window.locator('.chat-input')
      const send = card.locator('.chat-input-send')
      const bar = card.locator('.chat-input-bar')
      const field = card.locator('.chat-input-field')

      await expect(send).toBeVisible()
      await expect(send).toHaveAttribute('aria-label', 'Send')
      await expect(send).toBeDisabled()

      // The add menu, the model picker, the effort variant and the send button
      // all live inside the card's single control row.
      await expect(bar.locator('.add-dropdown')).toHaveCount(1)
      await expect(bar.locator('.model-picker')).toHaveCount(1)
      await expect(bar.locator('.chat-input-send')).toHaveCount(1)
      // Nothing was left behind in the footer row.
      await expect(window.locator('.chat-footer .model-picker')).toHaveCount(0)

      const cardBox = (await card.boundingBox())!
      const sendBox = (await send.boundingBox())!
      const barBox = (await bar.boundingBox())!
      const fieldBox = (await field.boundingBox())!
      expect(Math.round(cardBox.height)).toBe(await oneLineCardHeight(card))

      // The bar sits below the field, inside the card's frame.
      expect(barBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)
      expect(barBox.y + barBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height)

      // Inside the frame, at its right edge, inset by the card's padding *and* its
      // border (the box is border-box, so the content edge sits one border further in).
      const inset = await card.evaluate(el => {
        const cs = getComputedStyle(el)
        return parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)
      })
      expect(cardBox.x + cardBox.width - (sendBox.x + sendBox.width)).toBeCloseTo(inset, 0)
      // The button is a 2.25rem circle, so it scales with the user-configurable root.
      const rem = await rootFontSize(window)
      expect(sendBox.width).toBeCloseTo(2.25 * rem, 0)
      expect(sendBox.height).toBeCloseTo(2.25 * rem, 0)
      const radius = await send.evaluate(el => getComputedStyle(el).borderRadius)
      expect(radius).toContain('50%')

      // Vertically centred in the bar, not on the text line.
      expect(Math.abs((sendBox.y + sendBox.height / 2) - (barBox.y + barBox.height / 2))).toBeLessThanOrEqual(1)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

// The picker sits at the card's LEFT edge now, so a menu anchored to the trigger
// (25rem wide) overflows the pane — and `.pane` is `overflow: hidden`, which cut
// the menu off at the sidebar's edge. It is portaled to <body> through
// BaseDropdown instead, so neither the pane nor the sidebar can clip it.
test('the model menu is portaled, so a narrow pane never clips it', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(560, 620)
      })
      await openProject(window)
      await window.locator('.model-trigger').click()
      const menu = window.locator('.model-menu')
      await expect(menu).toBeVisible()

      const menuBox = (await menu.boundingBox())!
      const viewport = await window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
      expect(menuBox.x).toBeGreaterThanOrEqual(0)
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
      expect(menuBox.y).toBeGreaterThanOrEqual(0)
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)

      // Nothing overlaps it: the element at the menu's centre is inside the menu.
      expect(await menu.evaluate(el => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return hit === el || el.contains(hit)
      })).toBe(true)
      // Portaled out of the pane (that is what escapes `overflow: hidden`).
      expect(await menu.evaluate(el => el.parentElement === document.body)).toBe(true)

      await window.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
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
      // Compare unrounded: `rest` is a fractional sum, so rounding it before adding
      // whole line-heights drifts by a pixel once the root font-size is not 12px.
      expect((await card.boundingBox())!.height).toBeCloseTo(rest, 0)

      // Every line the field takes must be a line the card gains.
      await field.fill('one\ntwo\nthree\nfour\nfive')
      await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(rest + 4 * lh, 0)

      // Past the cap the field scrolls instead of growing: 8 lines is the most it
      // shows, so the card tops out 7 line-heights above rest, and the cap is
      // exactly 8 lines plus the field's own padding.
      const padY = await field.evaluate(el => {
        const cs = getComputedStyle(el)
        return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      })
      const maxHeight = await field.evaluate(el => parseFloat(getComputedStyle(el).maxHeight))
      expect(maxHeight).toBeCloseTo(padY + 8 * lh, 0)
      await field.fill(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'))
      await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(rest + 7 * lh, 0)
      const scrolled = await field.evaluate(el => {
        const t = el as HTMLTextAreaElement
        return t.scrollHeight > t.clientHeight
      })
      expect(scrolled).toBe(true)

      // And shrinking is as important as growing: an emptied field must give the
      // space back, or the card stays permanently tall.
      await field.fill('')
      await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(rest, 0)
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
      await expect(window.locator('.chat-queue-row')).toHaveCount(1)
      await expect(window.locator('.chat-queue-row-text')).toHaveText('queued while running')
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
      await expect(window.locator('.chat-queue-row')).toHaveCount(1)

      // The pencil on a queued row loads it into the composer for editing.
      await window.locator('.chat-queue-action.edit').click()
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
      await expect(window.locator('.chat-queue-row-text')).toHaveText('edited while running')

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

// A queued message can leave the queue without being sent — removed, or drained
// into its own turn. If the composer stayed in edit mode for it, the next Enter
// called editQueued() on a message that no longer existed: the field cleared and
// nothing was sent, so the message looked like it had vanished.
// The queue's arrow is "send now": it promotes that message to the head of the
// queue and aborts the running turn, so it starts immediately instead of being
// steered into the current turn at its next step (or waiting for it to end).
test('send now starts a queued message immediately instead of waiting for the turn', async () => {
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

      await field.fill('queued text')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-row')).toHaveCount(1)
      await expect(window.locator('.chat-msg.user').last()).toContainText('first turn')

      // The mock never answers, so only send-now can get this message into the
      // transcript while the app is still "running".
      await window.locator('.chat-queue-action.send-now').click()
      await expect(window.locator('.chat-queue-row')).toHaveCount(0)
      await expect(window.locator('.chat-msg.user').last()).toContainText('queued text')
      // The next turn is in flight again (the second request is held too).
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

test('removing a queued message being edited leaves the composer clean and sends the next message', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({ content: 'held answer', usage: USAGE })
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

      await field.fill('queued text')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-row')).toHaveCount(1)

      // Load the queued message into the composer, then remove it from the queue.
      await window.locator('.chat-queue-action.edit').click()
      await expect(field).toHaveValue('queued text')
      await window.locator('.chat-queue-action.remove').click()
      await expect(window.locator('.chat-queue-row')).toHaveCount(0)

      // Edit mode ended with the removal: the composer is empty again and the
      // slot is Stop (the turn is still in flight), not Save edit.
      await expect(field).toHaveValue('')
      await expect(card.locator('.chat-input-stop')).toBeVisible()

      release()
      await expect(card.locator('.chat-input-send')).toBeVisible()

      // The next message must actually go out.
      await field.fill('after the edit')
      await field.press('Enter')
      await expect(window.locator('.chat-msg.user').last()).toContainText('after the edit')
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

test('a queued message being edited that drains into a turn does not swallow the next send', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({ content: 'held answer', usage: USAGE })
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

      await field.fill('queued text')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-row')).toHaveCount(1)

      // Edit the queued message, then let the turn end so the queue drains while
      // the composer is still in edit mode for that message.
      await window.locator('.chat-queue-action.edit').click()
      await expect(field).toHaveValue('queued text')
      release()

      // The drained message starts its own turn; edit mode must end with it and
      // the composer must be clean.
      await expect(window.locator('.chat-msg.user').last()).toContainText('queued text')
      await expect(card.locator('.chat-input-stop')).toBeVisible()
      await expect(field).toHaveValue('')

      // The next message reaches main (queued behind the running turn) instead
      // of being swallowed by the stale edit target.
      await field.fill('after the drain')
      await field.press('Enter')
      await expect(window.locator('.chat-queue-row-text')).toHaveText('after the drain')
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
