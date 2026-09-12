# Composer Send / Stop Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the composer card's bottom into one row — a one-line-tall auto-growing textarea with a single square icon button at the card's right edge (Send at rest, Stop while a turn runs).

**Architecture:** `.chat-input` stays a column (prompt + chips stack above), but its bottom becomes `.chat-input-row`: `[textarea flex:1][24 × 24 button]`. The empty `.chat-input-toolbar` flex line is deleted, the textarea drops to `rows={1}` and grows via CSS `field-sizing: content` (cap 8 lines at `max-height: 13rem`, then it scrolls), and one button slot renders Send or Stop depending on `running` / `editTarget`. The textarea stays uncontrolled; a `hasText` boolean — updated only on the empty ↔ non-empty transition — drives the Send button's disabled state.

**Tech Stack:** Electron 41, electron-vite 5, React 19, TypeScript (strict), plain CSS in `src/renderer/src/styles.css`, `lucide-react` icons, Playwright `_electron` for e2e, Vitest (unit).

**Spec:** `docs/superpowers/specs/2026-09-12-composer-send-stop-design.md`

## Global Constraints

- **The two buttons are one slot, never two at once.** `showSend = !running || !!editTarget`, `showStop = running && !editTarget`. Editing a queued message while a turn runs shows **only** Send.
- **No accent border or glow for the running state.** Only the red Stop button and the `Processing...` placeholder signal "running". `.chat-input:focus-within` styling is untouched.
- **`.chat-footer` is not touched** (`+` AddMenu, ModePicker, ModelPicker, VariantPicker, ContextFooter keep their markup, classes and positions).
- **The textarea stays uncontrolled.** Never convert it to a controlled input: the repository's measured rule (a controlled composer re-renders on every keystroke and triggers a full-page layout) is documented in `docs/reference/09-ui-guide.md` §9.7.3 and `docs/reference/11-conventions-and-pitfalls.md`.
- **`hasText` may only `setState` on the empty ↔ non-empty transition.** Use the functional form returning the previous value when unchanged, so React bails out and no render happens per keystroke.
- **Button geometry is fixed at `2rem × 2rem` (24 × 24 at the default 12px root), `border-radius: var(--radius-sm)` (4px), `padding: 0`, `margin-bottom: 0.25rem`, `display: inline-flex` centred, `line-height: 0`.** Sizes in this plan assume `1rem = 12px` (the app's root font-size, and the composer field's `font-size: 1rem` + `line-height: 1.5` → an 18px line box).
- **Never hard-code a text color that fights the theme.** Send/Stop use `--accent` / `--red` with `#fff` icons (both are dark hues, so the icon stays legible in light mode too).
- **A parallel session edits this checkout.** Before every commit run `git status --short`, read `git diff` on any dirty file you did not touch, and stage only the paths and hunks you changed — never `git add -A`. If foreign edits overlap a hunk you need, stop and ask. **Known foreign work at plan-writing time:** `src/renderer/src/styles.css` carries four uncommitted hunks around lines 1271-1412 (menu / command-menu backgrounds `--bg-raised` → `--bg-chat`) — they are nowhere near the `/* Composer */` block this plan edits, so take the composer hunks and leave those staged-or-not as you found them.
- **Line endings:** at plan time every file this plan touches is LF (`CR count=0`). Re-check with `tr -cd '\r' < <file> | wc -c` before scripting an edit; if a file has become CRLF, do the edit with `io.open(..., newline='')` so the endings are preserved.
- **Language: English** for source, UI labels, docs and commit messages. Commits must **not** carry a `Co-Authored-By` trailer.
- **Verification before claiming done:** `npm run typecheck`, `npm test`, and for UI `npm run build && npx playwright test` on the affected specs.

## File map

| File | Responsibility | Change |
|---|---|---|
| `tests/e2e/composer.spec.ts` | New spec: rest geometry, growth/cap/shrink, send, Enter/Shift+Enter, running, edit-queued-while-running, stop | **Create** |
| `src/renderer/src/components/chat/ChatInput.tsx` | Composer markup: the row, the button slot, `hasText` | Modify |
| `src/renderer/src/styles.css` | `.chat-input-row`, the growing field, the two button rules; delete `.chat-input-toolbar*` and the text Stop rule | Modify |
| `docs/reference/09-ui-guide.md` | `ChatPanel.tsx` / `ChatInput.tsx` rows, the e2e spec list, the icon-button paragraph | Modify |
| `docs/reference/01-product-overview.md` | The capability rows that mention the composer | Verify only (Step 4) |
| `src/renderer/src/components/chat/AGENTS.md` | `ChatInput.tsx` row | Modify |
| `tests/e2e/AGENTS.md` | A row for `composer.spec.ts` | Modify |

---

### Task 1: The failing e2e spec

Seven tests that lock the whole design, written first and observed failing. Tests 2, 4 and 5 are flipped green by Task 2 (the row + growing field + Stop); tests 1, 3, 6 and 7 additionally need Task 3 (the Send button). A red test after Task 2 is therefore expected — the task text below says which.

**Files:**
- Create: `tests/e2e/composer.spec.ts`

**Interfaces:**
- Consumes: nothing from the repo. The helpers below are copied from `tests/e2e/sidebar-sessions.spec.ts` (`startGatedMockLlm`, `cleanupDir`, `seedWorkspaces`, `seedMeowConfig`, `launch`, `openProject`) with the seeded session named `Alpha` in project `E2E Project`.
- Produces: the selector contract every later task must satisfy — `.chat-input-row`, `.chat-input-send` (`aria-label` `Send` / `Save edit`, 24 × 24, inside the card at its right edge), `.chat-input-stop` (24 × 24, red), `placeholder` `Type a message... (/ for commands)` when idle and `Processing...` while running, and **no** `.chat-input-toolbar`.

- [ ] **Step 1: Write the failing spec**

Create `tests/e2e/composer.spec.ts`:

```ts
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

      await field.fill('queued text')
      await field.press('Enter')
      await firstCall
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/composer.spec.ts`
Expected: **7 failed**. The first failures are the geometry ones — `Expected: 0, Received: 1` for `.chat-input-toolbar` (still rendered) and `.chat-input-send` not found (no Send button exists yet). If instead the whole file errors before any test runs, the compile error is in this spec, not the app.

- [ ] **Step 3: Commit the failing spec**

```bash
git add tests/e2e/composer.spec.ts
git commit -m "test(e2e): lock the composer send/stop row, growth and running states"
```

---

### Task 2: One row — the growing field, the placeholder and a square Stop

Removes the toolbar line and puts the textarea and the Stop button on one row. No Send button yet (Task 3), so tests 2, 4 and 5 pass at the end of this task while 1, 3, 6 and 7 stay red — expected, because the Send button does not exist.

**Files:**
- Modify: `src/renderer/src/components/chat/ChatInput.tsx` (the `return` block, lines ~243-388)
- Modify: `src/renderer/src/styles.css` (the `/* Composer */` block, lines ~939-955)

**Interfaces:**
- Consumes: nothing from Task 1 (the test is already committed).
- Produces: `.chat-input-row` (flex, `align-items: flex-end`, `gap: 0.5rem`), a `.chat-input-field` that grows via `field-sizing: content` with `max-height: 13rem`, `overflow-y: auto`, and a `.chat-input-stop` that is a `2rem × 2rem` icon button carrying a `Square` glyph. Task 3 adds `.chat-input-send` next to the Stop rules.

- [ ] **Step 1: Replace the composer CSS block**

In `src/renderer/src/styles.css`, replace this exact block (the `.chat-input-main` rule down to `.chat-input-stop:hover`):

```css
.chat-input-main { display: flex; flex-direction: column; gap: 0.333333rem; min-width: 0; }
.chat-input-field {
  flex: 1; resize: none; background: transparent; color: var(--text);
  border: none; padding: 0.5rem 0.333rem;
  font-family: var(--font-ui); font-size: 1rem; user-select: text; line-height: 1.5;
}
.chat-input-field:focus, .chat-input-field:focus-visible { outline: none; }
.chat-input-field::placeholder { color: var(--text-faint); }
.chat-input-toolbar { display: flex; align-items: center; gap: 0.666667rem; }
.chat-input-toolbar-spacer { flex: 1; }
.chat-input-stop {
  padding: 0.5rem 1.333333rem; appearance: none; background: var(--red); border: none;
  color: #fff; font-weight: var(--fw-semibold); cursor: pointer;
  border-radius: var(--radius);
  transition: background 120ms ease;
}
.chat-input-stop:hover { background: #ff7479; }
```

with:

```css
.chat-input-main { display: flex; flex-direction: column; gap: 0.333333rem; min-width: 0; }
/* The field and its button share one row, so the button is always inside the card
   at its right edge and the text can never render underneath it. */
.chat-input-row { display: flex; align-items: flex-end; gap: 0.5rem; }
.chat-input-field {
  flex: 1; min-width: 0; resize: none; background: transparent; color: var(--text);
  border: none; padding: 0.5rem 0.333rem;
  font-family: var(--font-ui); font-size: 1rem; user-select: text; line-height: 1.5;
  /* Grow with the content up to 8 lines, then scroll inside the card instead of
     pushing the transcript off screen. */
  field-sizing: content; max-height: 13rem; overflow-y: auto;
}
.chat-input-field:focus, .chat-input-field:focus-visible { outline: none; }
.chat-input-field::placeholder { color: var(--text-faint); }
/* Square icon button in the row's trailing slot. `align-items: flex-end` pins it to
   the row's bottom once the field grows; the 3px bottom margin lifts the 24px box so
   its centre matches the 18px first line box's centre at rest. */
.chat-input-stop {
  flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0; margin-bottom: 0.25rem;
  display: inline-flex; align-items: center; justify-content: center; line-height: 0;
  appearance: none; border: none; border-radius: var(--radius-sm);
  background: var(--red); color: #fff; cursor: pointer;
  transition: background 120ms ease;
}
.chat-input-stop:hover { background: #ff7479; }
```

`.chat-input` (the card), `.chat-input:focus-within`, `.chat-input-chips` and the later `.chat-input { position: relative; }` (for the command menu) are unchanged. `.chat-input-toolbar*` no longer exists anywhere — verify:

Run: `grep -rn "chat-input-toolbar" src/ ; echo "exit=$?"`
Expected: no output, exit 1.

- [ ] **Step 2: Add the `Square` icon import**

In `src/renderer/src/components/chat/ChatInput.tsx`, add the import directly under the existing type import on line 3:

```tsx
import { Square } from 'lucide-react'
```

- [ ] **Step 3: Replace the toolbar with a row around the textarea**

Two edits in the same file. First, open the row — the textarea's opening tag plus its `placeholder` and `rows` currently reads:

```tsx
        <textarea
          ref={fieldRef}
          className={`chat-input-field mode-${mode}`}
          placeholder="Message Meow...  ( / for commands )"
          rows={2}
```

Change it to:

```tsx
        <div className="chat-input-row">
        <textarea
          ref={fieldRef}
          className={`chat-input-field mode-${mode}`}
          placeholder={running ? 'Processing...' : 'Type a message... (/ for commands)'}
          rows={1}
```

Second, close the row and carry the Stop button into it. Note the exact shape of the region being replaced: the `</div>` on the first line is the one that **currently** closes `.chat-input-main` (the textarea's own `/>` is above it), and the file input sits between it and the toolbar. Replace this whole region:

```tsx
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          addImageFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <div className="chat-input-toolbar">
        <span className="chat-input-toolbar-spacer" />
        {running && (
          <button className="chat-input-stop" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
```

with:

```tsx
        {running && (
          <button className="chat-input-stop" title="Stop" aria-label="Stop" onClick={onStop}>
            <Square size={12} fill="currentColor" aria-hidden="true" />
          </button>
        )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          addImageFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
```

The two `</div>`s now close `.chat-input-row` first and `.chat-input-main` second — the input stays a direct child of the card, and the card's own closing `</div>` further down is untouched. Do not add a third `</div>`: the region above already contained the `.chat-input-main` close.

Verify the JSX balances:

Run: `npm run typecheck`
Expected: exit 0. A stray `</div>` fails here as `TS17008: JSX element 'div' has no corresponding closing tag` or `TS1382`.

- [ ] **Step 4: Run the tests this task must flip green**

Run: `npm run build && npx playwright test tests/e2e/composer.spec.ts -g "grows with the text|Enter sends|button becomes stop"`
Expected: **3 passed**. These are the growth/cap/shrink test, the Enter/Shift+Enter test, and the running/queue test.

- [ ] **Step 5: Confirm the Send tests are still red, for the right reason**

Run: `npx playwright test tests/e2e/composer.spec.ts -g "one line tall|send submits|save button|brings the send button back"`
Expected: **4 failed**, each because `.chat-input-send` is not found (the Send button is Task 3), not because of geometry — read one failure's output to confirm.

If the geometry test (`.chat-input-send` aside) shows a card height mismatch, stop: the `field-sizing` route is not holding and the spec's `autoGrow` fallback is needed. Read the failure before continuing — the fallback changes Task 3's shape.

- [ ] **Step 6: Check the neighbouring composer consumers**

Run: `npx playwright test tests/e2e/smoke.spec.ts tests/e2e/prompt.spec.ts tests/e2e/context-footer.spec.ts`
Expected: all pass. `smoke.spec.ts` sends through the composer, `prompt.spec.ts` asserts the prompt sits inside `.chat-input`, `context-footer.spec.ts` sends real turns.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/renderer/src/styles.css src/renderer/src/components/chat/ChatInput.tsx
git commit -m "feat(ui): one-row composer with an auto-growing field and a square stop

The empty card was two text rows plus a toolbar line tall. The field drops to
rows=1 and grows via field-sizing: content, capped at 8 lines with its own
scroll; the text Stop button becomes a 24x24 square in the input's row, at the
card's right edge inside the frame."
```

---

### Task 3: The Send button

Adds the Send button in the same slot as Stop, and the `hasText` flag that drives its disabled state — updated on the empty ↔ non-empty transition only, so the composer stays uncontrolled and no keystroke re-renders.

**Files:**
- Modify: `src/renderer/src/components/chat/ChatInput.tsx` (imports, state, `onInput`, `submit`, `removeMention`, `pickFile`, `applyCommand`, the `editTarget` effect, the row's button slot)
- Modify: `src/renderer/src/styles.css` (the Stop button rule gains `.chat-input-send` + its own rules)

**Interfaces:**
- Consumes: Task 2's `.chat-input-row` and the shared square-button geometry.
- Produces: `.chat-input-send` — `2rem × 2rem`, `--accent`, `--accent-dim` + `--text-faint` when `:disabled`, `aria-label` `Send` (or `Save edit` while `editTarget` is set), which calls the existing `submit()`. And the `hasText` boolean, whose invariant is "true iff the trimmed field value is non-empty".

- [ ] **Step 1: Add the icon and the state**

Extend the lucide import from Task 2:

```tsx
import { CornerDownLeft, Square } from 'lucide-react'
```

Add the state next to the other `useState` calls (after `const [mentions, setMentions] = useState<string[]>([])`):

```tsx
  // The field is uncontrolled, so its emptiness is mirrored here rather than read
  // from React state. It only changes on the empty <-> non-empty transition, which
  // keeps the composer free of per-keystroke re-renders.
  const [hasText, setHasText] = useState(false)
```

- [ ] **Step 2: Keep the flag true through every programmatic write**

Programmatic `field.value` writes do not fire `onInput`, so each site that sets the value must set the flag too. Apply all five:

In `onInput`:

```tsx
  const onInput = useCallback((raw: string) => {
    setHasText(prev => {
      const next = raw.trim().length > 0
      return prev === next ? prev : next
    })
    syncMenu(raw)
    syncMentions(raw)
  }, [syncMenu, syncMentions])
```

In `submit()`, right after `if (fieldRef.current) fieldRef.current.value = ''`:

```tsx
    setHasText(false)
```

In the `editTarget` effect, inside the `if (fieldRef.current)` block:

```tsx
      setHasText(true)
```

In `pickFile`, after `field.value = next`:

```tsx
    setHasText(next.trim().length > 0)
```

In `applyCommand`, after `fieldRef.current.value = `/${cmd.name} ``:

```tsx
    setHasText(true)
```

In `removeMention`, after the `field.value = field.value.replace(...)` line, inside the same `if (field)` block:

```tsx
    setHasText(field.value.trim().length > 0)
```

- [ ] **Step 3: Render the Send button in the row**

Add `showSend` / `showStop` next to the `filtered` memo (the button slot must render exactly one of them):

```tsx
  // One slot, one button: while a turn runs the same slot is Stop — except while a
  // queued message is being edited, which is a Send (save) action, not a stop.
  const showSend = !running || !!editTarget
  const showStop = running && !editTarget
```

Then, in the row, replace the `{running && (...)}` Stop block from Task 2 with both buttons:

```tsx
        {showSend && (
          <button
            className="chat-input-send"
            title={editTarget ? 'Save edit (Enter)' : 'Send (Enter)'}
            aria-label={editTarget ? 'Save edit' : 'Send'}
            disabled={!hasText}
            onMouseDown={e => e.preventDefault()}
            onClick={submit}
          >
            <CornerDownLeft size={14} aria-hidden="true" />
          </button>
        )}
        {showStop && (
          <button className="chat-input-stop" title="Stop" aria-label="Stop" onClick={onStop}>
            <Square size={12} fill="currentColor" aria-hidden="true" />
          </button>
        )}
```

`onMouseDown={e => e.preventDefault()}` keeps the caret in the field when the button is pressed, so clicking Send never blurs the composer.

- [ ] **Step 4: Style the Send button**

In `src/renderer/src/styles.css`, replace the `.chat-input-stop` geometry rule written in Task 2:

```css
.chat-input-stop {
  flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0; margin-bottom: 0.25rem;
  display: inline-flex; align-items: center; justify-content: center; line-height: 0;
  appearance: none; border: none; border-radius: var(--radius-sm);
  background: var(--red); color: #fff; cursor: pointer;
  transition: background 120ms ease;
}
```

with the shared rule plus the two colour sets:

```css
.chat-input-send, .chat-input-stop {
  flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0; margin-bottom: 0.25rem;
  display: inline-flex; align-items: center; justify-content: center; line-height: 0;
  appearance: none; border: none; border-radius: var(--radius-sm);
  color: #fff; cursor: pointer; transition: background 120ms ease;
}
.chat-input-send { background: var(--accent); }
.chat-input-send:hover:not(:disabled) { background: var(--accent-strong); }
.chat-input-send:disabled { background: var(--accent-dim); color: var(--text-faint); cursor: default; }
.chat-input-stop { background: var(--red); }
```

Leave `.chat-input-stop:hover { background: #ff7479; }` (written in Task 2) in place, directly after.

- [ ] **Step 5: Run the whole composer spec**

Run: `npm run build && npx playwright test tests/e2e/composer.spec.ts`
Expected: **7 passed**. Test 1 (`one line tall`) is the one that proves the button is inside the frame at the right edge and centred on the single line; test 2 is the one that proves the field both grows *and* shrinks back.

- [ ] **Step 6: Verify the surrounding specs**

Run: `npx playwright test`
Expected: all pass. If `menus.spec.ts` or `context-footer.spec.ts` fails, check whether the shared checkout carries foreign uncommitted edits to `src/renderer/src/styles.css` (`git diff src/renderer/src/styles.css`) before attributing the failure to this task.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/renderer/src/components/chat/ChatInput.tsx src/renderer/src/styles.css
git commit -m "feat(ui): a send button in the composer's trailing slot

Send at rest (Enter still works), Stop while a turn runs, and Send alone while a
queued message is being edited. The disabled state comes from a hasText flag that
only changes on the empty <-> non-empty transition, so the field stays
uncontrolled and no keystroke re-renders the composer."
```

---

### Task 4: Sync the docs

Five prose places describe the old composer (Enter-only, no button) or the old toolbar, and the new spec file needs a row in the e2e inventory.

**Files:**
- Modify: `docs/reference/09-ui-guide.md` (lines 93-94, the e2e list at ~line 283)
- Verify: `docs/reference/01-product-overview.md` (Step 4 — expected to need no edit)
- Modify: `src/renderer/src/components/chat/AGENTS.md` (line 13)
- Modify: `tests/e2e/AGENTS.md` (the key-files table)

**Interfaces:**
- Consumes: the final class names and behaviour from Tasks 2-3.
- Produces: nothing importable.

- [ ] **Step 1: Update the `ChatInput.tsx` row in the UI guide**

`docs/reference/09-ui-guide.md` line 94 currently reads:

```
| `ChatInput.tsx` | Composer: textarea (Enter to send), paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, `/` command menu, edit-queued flow. Memoized, **uncontrolled**. |
```

Replace it with a row that names the new shape: the composer card's bottom is one row (`chat-input-row`) holding the auto-growing field (`rows=1`, `field-sizing: content`, capped at 8 lines then scrolling) and a single `24 × 24` square button at the card's trailing edge — Send at rest (disabled while the field is empty), Stop while a turn runs, Send again while a queued message is edited; placeholder `Type a message... (/ for commands)`, or `Processing...` while running. Keep the existing clauses (`Enter to send` becomes "Enter sends, Shift+Enter inserts a newline"), the image-chip limits, the `@`-mention dropdown, the `/` command menu, the edit-queued flow, and `Memoized, **uncontrolled**`.

- [ ] **Step 2: Update the `ChatPanel.tsx` row**

`docs/reference/09-ui-guide.md` line 93 describes "The composer's bottom row (`chat-footer`)". That is still true, but it now sits under a composer card whose own bottom is the input row. Extend the sentence so the two rows are distinguishable: the input row is inside the card, the `chat-footer` row is below it. Do not restate the whole row description — change only what is now incomplete or wrong.

- [ ] **Step 3: Add the spec to the e2e inventory**

`docs/reference/09-ui-guide.md` lines 268-270 list the Playwright specs:

```
- Playwright e2e (`npm run build && npm run e2e`), which launches the real app:
  `smoke.spec.ts`, `prompt.spec.ts`, `context-footer.spec.ts`, `chat-scrollbar.spec.ts`,
  `sidebar-sessions.spec.ts`
```

That list is already missing `selectors.spec.ts` and `menus.spec.ts` (both exist in `tests/e2e/`), so replace those three lines with the complete, alphabetical inventory of the directory:

```
- Playwright e2e (`npm run build && npm run e2e`), which launches the real app:
  `smoke.spec.ts`, `prompt.spec.ts`, `composer.spec.ts`, `context-footer.spec.ts`,
  `chat-scrollbar.spec.ts`, `sidebar-sessions.spec.ts`, `selectors.spec.ts`, `menus.spec.ts`
```

- [ ] **Step 4: Check the product overview for a stale composer claim**

`docs/reference/01-product-overview.md` was checked while writing this plan: its capability table has **no** row describing how a message is submitted (the composer appears only inside the `@`-mentions and Images rows, both of which stay true), so it should need no edit. Verify rather than assume:

Run: `grep -n "Enter\|Send\|composer" docs/reference/01-product-overview.md`
Expected: only the `@`-mentions and Images rows ("`@path` in the composer…", "Paste/drop … into the composer…"). If an Enter-only or "no send button" claim appears, fix that sentence and add the file to the commit; if not, this file stays untouched — do not invent a new table row for a button.

- [ ] **Step 5: Update the chat module's AGENTS.md**

`src/renderer/src/components/chat/AGENTS.md` line 13 reads:

```
| `ChatInput.tsx` | Composer: textarea (Enter to send), paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, edit-queued flow. Memoized. |
```

Update only this row, in the same style as Step 1: the one-row card, the auto-growing field, and the Send/Stop/`Save edit` button slot. Leave every other row and the Conventions section untouched.

- [ ] **Step 6: Add the row to tests/e2e/AGENTS.md**

In the key-files table of `tests/e2e/AGENTS.md`, add a row for `composer.spec.ts` in the same format as its neighbours, naming what it locks: the card's one-line rest height with the button inside its right edge and centred on the text line; growth to the 8-line cap, scrolling past it, and shrinking back; Send disabled/enabled/click; Enter vs Shift+Enter; the running state (Stop, `Processing...`, Enter still queues); editing a queued message while running (Save edit only); and Stop ending the turn. Also mention (as its neighbours do) that it copies `sidebar-sessions.spec.ts`'s gated mock LLM, which holds the response open so the running state is real rather than raced.

- [ ] **Step 7: Verify no stale composer description survives**

Run: `grep -rn "Message Meow" docs/ src/ tests/ ; echo "exit=$?"`
Expected: no output (exit 1) — the old placeholder is gone from code and docs. Hits inside `docs/superpowers/specs/` or `plans/` that quote the old placeholder as history are acceptable; a hit in `src/` is a miss.

- [ ] **Step 8: Commit**

```bash
git status --short
git add docs/reference/09-ui-guide.md docs/reference/01-product-overview.md src/renderer/src/components/chat/AGENTS.md tests/e2e/AGENTS.md
git commit -m "docs: sync the one-row composer, its send/stop button and the new e2e spec"
```

---

### Task 5: Full verification

**Files:** none modified.

**Interfaces:**
- Consumes: every prior task.
- Produces: nothing.

- [ ] **Step 1: Typecheck and unit suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; Vitest all passing.

- [ ] **Step 2: Full e2e suite**

Run: `npm run build && npx playwright test`
Expected: all pass.

- [ ] **Step 3: Confirm the composer spec is not flaky**

Run: `for i in 1 2 3 4 5; do npx playwright test tests/e2e/composer.spec.ts 2>&1 | grep -E "[0-9]+ passed|[0-9]+ failed"; done`
Expected: 5 × `7 passed`. The height polls (`expect.poll`) and the turn-completion waits are the parts most likely to be timing-sensitive; a single flake here means a wait needs a real condition, not a longer timeout.

- [ ] **Step 4: Confirm only intended paths are committed**

Run: `git status --short && git log --oneline -8`
Expected: no file this plan touched is still dirty. Other dirty/uncommitted paths belong to the parallel session — leave them alone.

- [ ] **Step 5: Record the visual result for the record**

Run: `npx playwright test tests/e2e/composer.spec.ts --grep "one line tall"`

If the user wants visual confirmation, capture the three states (empty, 5 lines, running) with a temporary Playwright screenshot run and compare against the two reference images in the request. This is a manual check, not a committed test: the committed assertions already cover geometry numerically.

---

## Not in this plan

Deliberately out of scope, from the spec's follow-ups — do not add them here:

- **A cancel affordance for a queued-message edit.** Escape keeps closing the `/`-command and file-mention menus; it gains no second meaning. Today an unwanted edit can only be saved, which is a pre-existing gap.
- **A drag handle / persisted composer height.** The cap is fixed at 8 lines.
- **Any change to `.chat-footer`, the prompt card, the chips, or the image/`@mention` paths.**
