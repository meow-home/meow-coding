import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Local fixture helpers: isolated temp userData + project, a long stored
// transcript, and a built-app launch that opens the project's chat feed.
function createScrollFixture(withTranscript: boolean): { userData: string; project: string } {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-scroll-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-scroll-project-'))
  const agentId = 'e2e-meow'
  const workspaces = [{
    projectPath: project,
    name: 'Scroll Test',
    agents: [
      { id: agentId, name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }
    ]
  }]
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  // Mark the one-time v0.37 "single native session" migration as already done:
  // without this flag main rewrites the workspace to one fresh session with a
  // new id and deletes sessions.json (src/main/fresh-start.ts), discarding the
  // seeded transcript this fixture exists to provide.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))

  if (withTranscript) {
    const now = Date.now()
    const items: Array<{ kind: string; message: { id: string; role: string; text: string; createdAt: number } }> = []
    for (let i = 0; i < 60; i++) {
      items.push({ kind: 'message', message: { id: `u-${i}`, role: 'user', text: `user question ${i}`, createdAt: now + i } })
      items.push({
        kind: 'message',
        message: {
          id: `a-${i}`,
          role: 'assistant',
          text: `assistant answer ${i}\n` + 'detail line\n'.repeat(30 + (i % 4) * 10),
          createdAt: now + i + 1
        }
      })
    }
    const sessions = [{
      id: 'sess-1',
      agentId,
      projectPath: project,
      title: 'Long transcript',
      items,
      todos: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      createdAt: now,
      updatedAt: now
    }]
    writeFileSync(path.join(userData, 'sessions.json'), JSON.stringify(sessions, null, 2))
  }
  return { userData, project }
}

async function launchChatProject(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toBeVisible()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  return { app, window }
}

// Measured from inside the feed in one evaluation. Resolving `.chat-msg.user`
// first and then reading it races the optimistic->persisted handoff: sending a
// turn renders a provisional row that React replaces once the transcript
// reloads, and evaluating on that detached node made `closest('.chat-feed')`
// return null (an intermittent TypeError, not an assertion failure).
// Returns NaN while no user row is in the feed yet, so expect.poll retries.
function anchorTop(window: Page): Promise<number> {
  return window.locator('.chat-feed').evaluate((feed) => {
    const rows = feed.querySelectorAll('.chat-msg.user')
    const row = rows[rows.length - 1]
    if (!row) return Number.NaN
    return row.getBoundingClientRect().top - feed.getBoundingClientRect().top
  })
}

// Resolves once the feed scrollTop has been stable across several frames, so
// a wheel gesture's smooth scroll has fully finished before we record values.
function waitForScrollSettle(window: Page): Promise<void> {
  return window.evaluate(() => new Promise<void>(resolve => {
    const feed = document.querySelector('.chat-feed')!
    let last = feed.scrollTop
    let stable = 0
    const tick = () => {
      if (Math.abs(feed.scrollTop - last) < 0.5) stable += 1
      else stable = 0
      last = feed.scrollTop
      if (stable > 3) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

// Resolves once the feed's scrollHeight has stopped changing across several
// frames (bounded by a frame cap). Needed because the app pins the feed to the
// bottom for ~60 frames after a session load: reading the gap during that loop
// always looks correct, so the "landed at the bottom" assertion has to be judged
// against the settled layout to mean anything.
function waitForHeightSettle(window: Page): Promise<void> {
  return window.evaluate(() => new Promise<void>(resolve => {
    const feed = document.querySelector('.chat-feed')!
    let last = feed.scrollHeight
    let stable = 0
    let frames = 0
    const tick = () => {
      frames += 1
      if (Math.abs(feed.scrollHeight - last) < 1) stable += 1
      else stable = 0
      last = feed.scrollHeight
      if (stable > 10 || frames > 600) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

test('chat feed scrollbar reflects the full transcript (no content-visibility collapse)', async () => {
  const { userData, project } = createScrollFixture(true)
  try {
    const { app, window } = await launchChatProject(userData)
    try {
      const feed = window.locator('.chat-feed')
      await expect(feed).toBeVisible()

      // Opening the project must land the feed at the real bottom, even though
      // content-visibility rows settle their true heights a few frames late.
      await waitForHeightSettle(window)
      await expect.poll(() => feed.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight), {
        timeout: 5000
      }).toBeLessThan(4)

      // The feed renders one transcript window at a time (transcriptWindow's
      // default limit is 50) and pulls in the previous page once the feed nears
      // the top. Page the whole 120-message transcript in first: the regression
      // this test guards — content-visibility rows reserving zero height when
      // skipped, collapsing scrollHeight to a couple of viewports — can only be
      // judged against a fully rendered feed.
      const msgs = window.locator('.chat-msg')
      await expect.poll(async () => {
        const count = await msgs.count()
        if (count >= 120) return count
        await feed.evaluate(el => { el.scrollTop = 0 })
        return count
      }, { timeout: 20000 }).toBe(120)

      await expect.poll(() => feed.evaluate(el => el.scrollHeight / el.clientHeight), {
        timeout: 5000
      }).toBeGreaterThan(8)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('sending a new turn anchors it near the top and yields to manual scrolling', async () => {
  const { userData, project } = createScrollFixture(true)
  try {
    const { app, window } = await launchChatProject(userData)
    try {
      const feed = window.locator('.chat-feed')
      await expect(feed).toBeVisible()

      // Scroll to an older position, then submit: the new user row must land at
      // the stable 20px reading position near the top of the feed.
      await feed.evaluate(el => { el.scrollTop = 400 })
      await window.locator('.chat-input-field').fill('anchor this turn')
      await window.locator('.chat-input-field').press('Enter')

      await expect.poll(() => anchorTop(window), { timeout: 10000 }).toBeGreaterThanOrEqual(18)
      await expect.poll(() => anchorTop(window), { timeout: 10000 }).toBeLessThanOrEqual(22)

      // Real layout growth below the boundary: the production ResizeObserver
      // must keep following while the application owns scrolling.
      const scrollTop = () => feed.evaluate(el => el.scrollTop)
      const beforeFollow = await scrollTop()
      const block = await window.evaluateHandle(() => {
        const boundary = document.querySelector('.chat-latest-boundary')!
        const el = document.createElement('div')
        el.className = 'e2e-stream-growth'
        el.style.height = '900px'
        boundary.parentElement!.insertBefore(el, boundary)
        return el
      })
      await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThan(beforeFollow)

      // A deliberate wheel-up hands ownership to the user: growing content
      // below must not move the viewport anymore.
      await feed.hover()
      await window.mouse.wheel(0, -240)
      await waitForScrollSettle(window)
      const beforeManual = await scrollTop()
      await block.evaluate((el: HTMLElement) => { el.style.height = '1400px' })
      await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThanOrEqual(beforeManual - 1)
      await expect.poll(scrollTop, { timeout: 5000 }).toBeLessThanOrEqual(beforeManual + 1)

      await expect(window.locator('.chat-jump-to-end')).toBeVisible()

      // Scroll to end resumes following and hides itself.
      await window.locator('.chat-jump-to-end').click()
      const beforeResume = await scrollTop()
      await block.evaluate((el: HTMLElement) => { el.style.height = '1800px' })
      await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThan(beforeResume)
      await expect(window.locator('.chat-jump-to-end')).toBeHidden()
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('new turn anchor holds under reduced motion', async () => {
  const { userData, project } = createScrollFixture(true)
  try {
    const { app, window } = await launchChatProject(userData)
    try {
      const feed = window.locator('.chat-feed')
      await expect(feed).toBeVisible()
      await window.emulateMedia({ reducedMotion: 'reduce' })

      await feed.evaluate(el => { el.scrollTop = 400 })
      await window.locator('.chat-input-field').fill('another turn')
      await window.locator('.chat-input-field').press('Enter')

      await expect.poll(() => anchorTop(window), { timeout: 10000 }).toBeGreaterThanOrEqual(18)
      await expect.poll(() => anchorTop(window), { timeout: 10000 }).toBeLessThanOrEqual(22)
    } finally {
      await app.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
