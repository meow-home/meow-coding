import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Seed a workspace whose session id the test addresses directly, and mark the
// one-time v0.37 "single native session" migration as already done: without the
// flag main rewrites every workspace to one fresh session with a new random id
// (src/main/fresh-start.ts), so the injected `chat:event` agentId would match
// nothing.
function seedWorkspace(userData: string, project: string): void {
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project,
    name: 'E2E',
    agents: [{ id: 'a1', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }]))
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

async function launchPrompt() {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspace(userData, project)
  const app = await electron.launch({ args: ['.'], env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData } })
  const window = await app.firstWindow()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('chat:event', {
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'permission',
      call: { id: 'c1', tool: 'bash', input: { command: 'x' }, permission: 'pending' }
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  return { app, window }
}

test('click allow closes the prompt', async () => {
  const { app, window } = await launchPrompt()
  try {
    await window.locator('.chat-prompt-actions button.allow').click()
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('keyboard 1 triggers allow when panel focused', async () => {
  const { app, window } = await launchPrompt()
  try {
    await window.locator('.chat-panel').click()
    await window.keyboard.press('1')
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

async function launchQuestion() {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspace(userData, project)
  const app = await electron.launch({ args: ['.'], env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData } })
  const window = await app.firstWindow()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('chat:event', {
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'question',
      question: 'Please enter your username:', custom: true
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  return { app, window }
}

test('text-only question submits the typed answer', async () => {
  const { app, window } = await launchQuestion()
  try {
    await window.locator('.chat-prompt-input').fill('nguyen.vana')
    await window.locator('.chat-prompt-actions button', { hasText: 'Send' }).click()
    await expect(window.locator('.chat-prompt')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('prompt is the last row of the chat feed', async () => {
  const { app, window } = await launchPrompt()
  try {
    // It is a feed row (a child of the transcript content), not a composer child.
    const placement = await window.evaluate(() => {
      const prompt = document.querySelector('.chat-prompt')!
      const content = document.querySelector('.chat-feed-content')!
      const composer = document.querySelector('.chat-composer')!
      return { inFeed: content.contains(prompt), inComposer: composer.contains(prompt) }
    })
    expect(placement.inFeed).toBe(true)
    expect(placement.inComposer).toBe(false)

    const feed = await window.locator('.chat-feed').boundingBox()
    const prompt = await window.locator('.chat-prompt').boundingBox()
    expect(feed).not.toBeNull()
    expect(prompt).not.toBeNull()
    // Inside the feed's scroll region, on its lane column.
    expect(prompt!.y).toBeGreaterThanOrEqual(feed!.y)
    expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(feed!.y + feed!.height + 1)
    expect(prompt!.x).toBeGreaterThanOrEqual(feed!.x)
    expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(feed!.x + feed!.width + 1)
  } finally {
    await app.close()
  }
})

test('prompt does not sit in the composer', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspace(userData, project)
  const app = await electron.launch({ args: ['.'], env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData } })
  const window = await app.firstWindow()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('chat:event', {
      type: 'prompt-request', agentId: 'a1', promptId: 'p1', kind: 'question',
      question: 'Pick an option:', custom: true
    })
  })
  await expect(window.locator('.chat-prompt')).toBeVisible()
  const composerBox = await window.locator('.chat-composer').boundingBox()
  const prompt = await window.locator('.chat-prompt').boundingBox()
  try {
    expect(composerBox).not.toBeNull()
    expect(prompt).not.toBeNull()
    // The prompt lives in the feed above the composer, so it must not overlap
    // the composer region (the input card and footer stay unobstructed).
    expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(composerBox!.y + 1)
  } finally {
    await app.close()
  }
})
