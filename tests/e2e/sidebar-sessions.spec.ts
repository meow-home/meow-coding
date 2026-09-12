import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
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
// as long as a test needs, so switching sessions can be checked while the first
// one is genuinely mid-turn rather than racing an instant reply.
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

function seedWorkspaces(userData: string, project: string, sessionNames: string[]): void {
  const workspaces = [{
    projectPath: project,
    name: 'E2E Project',
    agents: sessionNames.map((name, i) => ({
      id: `e2e-${i}`, name, templateId: 'meow', cwd: project, kind: 'native'
    }))
  }]
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  // Mark the one-time v0.37 "single native session" migration as already done:
  // without this flag main rewrites every seeded workspace to one fresh session
  // with a new random id (src/main/fresh-start.ts), discarding the fixtures.
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

// Expands the (single) seeded project's session list, then opens its panes by
// selecting the first session. Asserts the pane container rather than
// `.chat-panel`, which matches once per session.
async function openProject(window: Page): Promise<void> {
  await window.locator('.project-toggle').click()
  await expect(window.locator('.session-list')).toBeVisible()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.session-panes')).toBeVisible()
}

test('the project row "+" creates a session that appears in the session list', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      await expect(window.locator('.session-list .session-row')).toHaveCount(1)
      // The project row is a lightweight group header: the path moved onto the
      // row's `title` (there is no path line and no session count any more).
      await expect(window.locator('.project-row')).toHaveAttribute('title', project)

      // The "+" is a `Plus` icon button in the row's `.project-actions`, keyed by
      // aria-label `new session <project name>` (Sidebar.tsx project-actions).
      await window.getByRole('button', { name: 'new session E2E Project', exact: true }).click()

      await expect(window.locator('.session-list .session-row')).toHaveCount(2)
      // onNewSession makes the new session the project's active one.
      await expect(window.locator('.session-row.active .session-name')).toHaveText('New session')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('switching sessions does not stop the running one, and only one pane is shown', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({
    content: 'held answer', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // Start a real turn in Alpha and leave it in flight (the mock holds the
      // response open), so Alpha is genuinely 'running' when we switch away.
      await window.locator('.chat-input-field').fill('hold the line')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.user').last()).toContainText('hold the line')
      const alphaRow = window.locator('.session-row', { hasText: 'Alpha' })
      await expect(alphaRow.locator('.session-dot')).toHaveClass(/session-status-running/)
      await firstCall

      // Create + activate a second session. Alpha's pane must stay mounted and
      // its turn must keep running: Goal 1 is "switching a session must NOT stop
      // or pause any other session's run".
      await window.getByRole('button', { name: 'new session E2E Project', exact: true }).click()
      const newRow = window.locator('.session-row', { hasText: 'New session' })
      await expect(window.locator('.session-row.active .session-name')).toHaveText('New session')
      await expect(alphaRow.locator('.session-dot')).toHaveClass(/session-status-running/)
      await expect(newRow.locator('.session-dot')).toHaveClass(/session-status-idle/)

      // Switch back by clicking the pre-existing row — the `onSelectSession` path
      // rather than `onNewSession` — so the row-click route is exercised too and a
      // *pre-existing* session is shown to survive a switch. Then return to the new
      // session so Alpha is the hidden one for the pane assertions below.
      await alphaRow.click()
      await expect(window.locator('.session-row.active .session-name')).toHaveText('Alpha')
      await expect(alphaRow.locator('.session-dot')).toHaveClass(/session-status-running/)
      await newRow.click()
      await expect(window.locator('.session-row.active .session-name')).toHaveText('New session')

      // Exactly one pane is visible. The inactive slots carry `hidden`, hidden by
      // the CSS rule `.pane-slot[hidden] { display: none !important }`; without it
      // the slot's own `display: flex` would win and every session would stack, so
      // counting only *visible* slots is what catches that regression.
      await expect(window.locator('.session-panes .pane-slot')).toHaveCount(2)
      await expect(window.locator('.session-panes .pane-slot:visible')).toHaveCount(1)

      // The hidden session's pane is still mounted and consuming chat events: its
      // reply lands even though it is not the active session.
      release()
      await expect(window.locator('.session-panes .pane-slot[hidden] .chat-msg.assistant'))
        .toContainText('held answer')
      await expect(alphaRow.locator('.session-dot')).toHaveClass(/session-status-idle/)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('session status dot reflects idle, running and waiting', async () => {
  const { server, port, firstCall, release } = await startGatedMockLlm({
    content: 'still going', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  })
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    seedMeowConfig(userData, port)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const row = window.locator('.session-row', { hasText: 'Alpha' })
      const dot = row.locator('.session-dot')

      // At rest a native session is idle.
      await expect(dot).toHaveClass(/session-status-idle/)

      // A turn in flight -> running.
      await window.locator('.chat-input-field').fill('start a turn')
      await window.locator('.chat-input-field').press('Enter')
      await expect(dot).toHaveClass(/session-status-running/)
      await firstCall

      // A pending permission/question prompt -> waiting. Driven through the real
      // main -> renderer event (`prompt:state-changed`) the Sidebar subscribes to,
      // the same way prompt.spec.ts drives prompts (src/shared/ipc.ts).
      await app.evaluate(({ BrowserWindow }, projectPath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('prompt:state-changed', {
          projectPath, agentId: 'e2e-0', pending: true
        })
      }, project)
      // Waiting wins over running: the turn is still mid-flight but the dot must
      // go yellow because the session needs the user.
      await expect(dot).toHaveClass(/session-status-waiting/)

      // Answering returns it to running, and the finished turn to idle.
      await app.evaluate(({ BrowserWindow }, projectPath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('prompt:state-changed', {
          projectPath, agentId: 'e2e-0', pending: false
        })
      }, project)
      await expect(dot).toHaveClass(/session-status-running/)

      release()
      await expect(dot).toHaveClass(/session-status-idle/)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

test('the session row menu deletes a session', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha', 'Beta'])
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      await expect(window.locator('.session-list .session-row')).toHaveCount(2)

      await window.locator('.session-row', { hasText: 'Beta' })
        .getByRole('button', { name: 'Session menu', exact: true }).click()
      await window.getByRole('button', { name: 'Delete', exact: true }).click()

      await expect(window.locator('.session-list .session-row')).toHaveCount(1)
      await expect(window.locator('.session-list .session-row .session-name')).toHaveText('Alpha')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('sidebar icon buttons are 24x24 squares with a 3px radius', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // Project row: the "+" (new session) and the "..." (project menu). Both are
      // revealed on hover; boundingBox() ignores opacity, but hovering keeps the
      // measurement on the state the user actually sees.
      await window.locator('.project-row').hover()
      for (const name of ['new session E2E Project', 'menu E2E Project']) {
        const btn = window.getByRole('button', { name, exact: true })
        const box = await btn.boundingBox()
        expect(box).not.toBeNull()
        expect(Math.round(box!.width)).toBe(24)
        expect(Math.round(box!.height)).toBe(24)
        await expect(btn).toHaveCSS('border-radius', '3px')
      }

      // Session row: the per-row "..." menu button.
      const row = window.locator('.session-list .session-row').first()
      await row.hover()
      const sessionMenu = row.getByRole('button', { name: 'Session menu', exact: true })
      const box = await sessionMenu.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.round(box!.width)).toBe(24)
      expect(Math.round(box!.height)).toBe(24)
      await expect(sessionMenu).toHaveCSS('border-radius', '3px')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
