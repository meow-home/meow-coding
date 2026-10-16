import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

interface MockTurn {
  content?: string
  toolCall?: { name: string; args: unknown }
}

// Fakes just enough of the OpenAI-compatible streaming chat endpoint
// (@ai-sdk/openai-compatible) for the real IPC -> manager -> loop -> llm
// pipeline to run end to end without a real provider API key. Unlike the other
// e2e mocks this one can stream a tool call, so the `question` tool really runs.
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
      if (turn.toolCall) {
        send({
          id: 'mock-1',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args) }
              }]
            }
          }]
        })
        send({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        send({ id: 'mock-1', choices: [{ index: 0, delta: { role: 'assistant', content: turn.content ?? '' } }] })
        send({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
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

// Electron leaves cache file handles open briefly after app.close() on Windows;
// retry, then give up quietly - a locked cache file must never replace a real
// assertion failure thrown from the try block.
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
  // A relaunch against the same user data restores the sidebar's expanded
  // state, so the session list is already open - toggling would close it.
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

/** True when the `b` row containing `text` sits after the first `a` row. */
function isAfter(window: Page, a: string, b: string, text: string): Promise<boolean> {
  return window.evaluate(([selA, selB, needle]) => {
    const elA = document.querySelector(selA)
    const elB = [...document.querySelectorAll(selB)].find(el => el.textContent?.includes(needle))
    if (!elA || !elB) return false
    return (elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  }, [a, b, text])
}

const QUESTION_ARGS = {
  question: 'Which database should I use?',
  header: 'Database',
  options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }]
}

test('the question answer is echoed into the feed as a user message after the tool row', async () => {
  const { server, port } = await startMockLlm([
    { toolCall: { name: 'question', args: QUESTION_ARGS } },
    { content: 'thanks, going with it' }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock'
    })

    let { app, window } = await launch(userData)
    try {
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')

      // The tool really ran: the prompt is the question the mock asked.
      await expect(window.locator('.chat-prompt')).toBeVisible()
      await expect(window.locator('.chat-prompt-text')).toContainText('Which database should I use?')
      await window.locator('.chat-option', { hasText: 'PostgreSQL' }).click()

      // The answer becomes a user bubble, and it lands AFTER the question's
      // tool row - the order the transcript is stored in, so a reload agrees.
      const answer = window.locator('.chat-msg.user', { hasText: 'PostgreSQL' })
      await expect(answer).toHaveCount(1)
      await expect(window.locator('.tool-call-badge-question')).toBeVisible()
      expect(await isAfter(window, '.tool-call', '.chat-msg.user', 'PostgreSQL')).toBe(true)

      // The turn continues with the answer in context.
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('thanks, going with it')

      await app.close()

      // Reload from disk: the echo is persisted, not a live-only render.
      ;({ app, window } = await launch(userData))
      await expect(window.locator('.chat-msg.user', { hasText: 'PostgreSQL' })).toHaveCount(1)
      await expect(window.locator('.tool-call-badge-question')).toBeVisible()
      expect(await isAfter(window, '.tool-call', '.chat-msg.user', 'PostgreSQL')).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
