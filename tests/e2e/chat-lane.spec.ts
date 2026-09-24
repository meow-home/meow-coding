import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The chat lane: the transcript content, the question/permission prompt and the
// composer card all sit on ONE centered column of `--chat-lane-w` (64rem). The
// todo list is a compact pill (TodoPill) seated in the pane header, not a lane
// surface. Two
// details are load-bearing and pinned here:
//
//  1. The feed box stays full panel width, so the scrollbar hugs the panel edge
//     instead of being pulled inside the lane; the lane is applied to the inner
//     `.chat-feed-content`.
//  2. The transcript lane must match the composer's padding box exactly, in both
//     cases (feed overflowing / feed fitting). The feed reserves the scrollbar
//     gutter symmetrically (`stable both-edges`), because a one-sided gutter
//     shortens the lane by the scrollbar width and desyncs it from the composer
//     card — the "steps in the feed are 8px short on the right" bug.

const WIDE = { width: 1400, height: 900 }
const NARROW = { width: 900, height: 700 }

function createFixture(long: boolean): { userData: string } {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-lane-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-lane-project-'))
  const agentId = 'e2e-meow'
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project,
    name: 'Lane Test',
    agents: [{ id: agentId, name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }], null, 2))
  // Mark the one-time v0.37 "single native session" migration as done, or main
  // rewrites the workspace and discards the seeded transcript below.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))

  const now = Date.now()
  const items: Array<{ kind: string; message: { id: string; role: string; text: string; createdAt: number } }> = []
  for (let i = 0; i < (long ? 30 : 1); i++) {
    items.push({ kind: 'message', message: { id: `u-${i}`, role: 'user', text: `user question ${i}`, createdAt: now + i } })
    items.push({
      kind: 'message',
      message: {
        id: `a-${i}`,
        role: 'assistant',
        text: `assistant answer ${i}\n` + 'detail line\n'.repeat(20),
        createdAt: now + i + 1
      }
    })
  }
  writeFileSync(path.join(userData, 'sessions.json'), JSON.stringify([{
    id: 'sess-1',
    agentId,
    projectPath: project,
    title: 'Lane transcript',
    items,
    todos: [{ content: 'first todo', status: 'completed' }, { content: 'second todo', status: 'pending' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    createdAt: now,
    updatedAt: now
  }], null, 2))
  return { userData }
}

async function launchAt(userData: string, size: { width: number; height: number }): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setSize(s.width, s.height)
  }, size)
  await expect(window.locator('.project-row')).toBeVisible()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  return { app, window }
}

/**
 * One evaluation returning every column edge that matters. The lane column is
 * derived from the composer's padding box (the composer spans the full panel and
 * insets the lane with padding, so its padding box IS the lane), then checked
 * against the feed's rendered content lane, the composer children
 * and the prompt.
 */
async function measureLane(window: Page) {
  return window.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right }
    }
    const composer = document.querySelector<HTMLElement>('.chat-composer')!
    const cBox = composer.getBoundingClientRect()
    const ccs = getComputedStyle(composer)
    const feed = document.querySelector<HTMLElement>('.chat-feed')!
    const panel = document.querySelector<HTMLElement>('.chat-panel')!.getBoundingClientRect()
    return {
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      panelRight: panel.right,
      composerWidth: cBox.width,
      laneLeft: cBox.left + parseFloat(ccs.paddingLeft),
      laneRight: cBox.right - parseFloat(ccs.paddingRight),
      laneContentWidth: cBox.width - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight),
      feedRight: feed.getBoundingClientRect().right,
      feedOverflows: feed.scrollHeight > feed.clientHeight,
      feedContent: box('.chat-feed-content'),
      card: box('.chat-input'),
      footer: box('.chat-footer'),
      prompt: box('.chat-prompt'),
      overflowsX: feed.scrollWidth > feed.clientWidth + 1
    }
  })
}

type LaneBox = { left: number; right: number } | null

/** Every surface that must sit on the lane column: the transcript content lane,
 *  the composer card and the composer footer. The todo list is a compact pill
 *  (see TodoPill) seated in the pane header, so it is intentionally NOT a lane
 *  surface. */
function laneBoxes(m: Awaited<ReturnType<typeof measureLane>>): Array<[string, LaneBox]> {
  return [
    ['.chat-feed-content', m.feedContent],
    ['.chat-input', m.card],
    ['.chat-footer', m.footer]
  ]
}

function expectOnLane(m: Awaited<ReturnType<typeof measureLane>>): void {
  for (const [name, b] of laneBoxes(m)) {
    expect(b, `${name} should be rendered`).not.toBeNull()
    expect(Math.abs(b!.left - m.laneLeft), `${name} left edge`).toBeLessThanOrEqual(1)
    expect(Math.abs(b!.right - m.laneRight), `${name} right edge`).toBeLessThanOrEqual(1)
  }
}

for (const long of [true, false]) {
  test(`wide pane, ${long ? 'overflowing' : 'fitting'} transcript: every surface shares one centered lane`, async () => {
    const { userData } = createFixture(long)
    const { app, window } = await launchAt(userData, WIDE)
    try {
      await expect(window.locator('.todo-pill')).toBeVisible()
      expect((await measureLane(window)).feedOverflows).toBe(long)

      const m = await measureLane(window)
      const lane = 64 * m.rootFontSize

      // Centered at the lane width (not shifted by the scrollbar gutter).
      expect(Math.abs(m.laneContentWidth - lane)).toBeLessThanOrEqual(1)

      // Feed content, composer card and footer on the same column.
      expectOnLane(m)

      // The scroller itself is still full width: its right edge is the panel
      // edge, which is where the scrollbar is painted.
      expect(m.panelRight - m.feedRight).toBeLessThanOrEqual(1)
      expect(m.feedRight - m.laneRight).toBeGreaterThan(lane * 0.05)
    } finally {
      await app.close()
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}

test('the prompt popup is clamped to the lane column', async () => {
  const { userData } = createFixture(true)
  const { app, window } = await launchAt(userData, WIDE)
  try {
    await app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('chat:event', {
        type: 'prompt-request', agentId: 'e2e-meow', promptId: 'p1', kind: 'question',
        question: 'Pick an option:', custom: true
      })
    })
    await expect(window.locator('.chat-prompt')).toBeVisible()
    const m = await measureLane(window)
    expect(m.prompt).not.toBeNull()
    expect(Math.abs(m.prompt!.left - m.laneLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.prompt!.right - m.laneRight)).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('narrow pane: the lane shrinks with the pane instead of overflowing the feed', async () => {
  const { userData } = createFixture(true)
  const { app, window } = await launchAt(userData, NARROW)
  try {
    const m = await measureLane(window)
    const lane = 64 * m.rootFontSize

    // Pane narrower than the lane: the max() clamp falls back to the base
    // padding, so the lane is the panel width minus 2 x 14px (and the reserved
    // scrollbar gutters sit outside it).
    expect(m.laneContentWidth).toBeLessThan(lane)
    expect(Math.abs(m.laneContentWidth - (m.composerWidth - 2 * 1.166667 * m.rootFontSize))).toBeLessThanOrEqual(1)
    expect(m.overflowsX).toBe(false)
    expectOnLane(m)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
