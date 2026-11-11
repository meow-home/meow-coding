import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A shell fence in an assistant message renders as a command box: the command
// with Run in terminal / Copy command. Run opens this session's terminal panel
// and types the block there (a fresh tab when the session has none); Copy puts
// the command on the clipboard. Non-shell fences must stay plain code blocks.

const COMMAND = 'echo meow-cmd-ok'

function createFixture(): { userData: string } {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-cmdbox-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-cmdbox-project-'))
  const agentId = 'e2e-meow'
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
    projectPath: project,
    name: 'Command Box',
    agents: [{ id: agentId, name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
  }], null, 2))
  // Mark the one-time v0.37 migration as done, or main rewrites the workspace
  // and discards the seeded transcript below.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))

  const now = Date.now()
  const text = [
    'Delete the review branch when you are done:',
    '',
    '```powershell',
    COMMAND,
    '```',
    '',
    'And this is output, not a command to replay:',
    '',
    '```console',
    '$ npm test',
    'ok',
    '```'
  ].join('\n')

  writeFileSync(path.join(userData, 'sessions.json'), JSON.stringify([{
    id: 'sess-cmd',
    agentId,
    projectPath: project,
    title: 'Command box transcript',
    items: [{ kind: 'message', message: { id: 'a-0', role: 'assistant', text, createdAt: now } }],
    todos: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    createdAt: now,
    updatedAt: now
  }], null, 2))
  return { userData }
}

async function openSession(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
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

test('a shell fence in the chat runs in the session terminal and copies to the clipboard', async () => {
  const { userData } = createFixture()
  const { app, window } = await openSession(userData)

  try {
    const box = window.locator('.chat-cmd')
    await expect(box).toHaveCount(1)
    await expect(box.locator('.chat-cmd-text')).toHaveText(COMMAND)
    // `console` fences mix a prompt with its output and stay plain code.
    await expect(window.locator('.chat-md > pre')).toHaveCount(1)

    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await box.locator('button[aria-label="Copy command"]').click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(COMMAND)

    await box.locator('button[aria-label="Run in terminal"]').click()

    await expect(window.locator('.terminal-overlay')).toBeVisible({ timeout: 20_000 })
    await expect(window.locator('.terminal-tab')).toHaveCount(1, { timeout: 20_000 })
    await expect(window.locator('.terminal-view-container .xterm-screen')).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => (await window.locator('.terminal-view-container .xterm-rows').textContent()) ?? '', { timeout: 30_000 })
      .toContain('meow-cmd-ok')
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
