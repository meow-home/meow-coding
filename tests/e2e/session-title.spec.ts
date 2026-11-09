import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The session's identity lives in the window title bar now (status dot, name, `⋮`
// menu) — the pane has no header row, so the chat starts right at the top. The title
// bar is a single flex row: brand, session title, then the panel tools. The name must
// ellipsize and the `⋮` must keep its size, otherwise a long session name pushes the
// menu under the tools (the original report: the button was covered once the window
// was not maximized and the right-side panel was open).

const LONG_NAME = 'card browser chưa có border radius giống các card còn lại và phần tên rất dài'

function seed(userData: string, project: string): void {
  writeFileSync(
    path.join(userData, 'workspaces.json'),
    JSON.stringify(
      [
        {
          projectPath: project,
          name: 'Narrow header project with a fairly long name',
          agents: [{ id: 'e2e-meow', name: LONG_NAME, templateId: 'meow', cwd: project, kind: 'native' }]
        }
      ],
      null,
      2
    )
  )
  // Mark the one-time v0.37 "single native session" migration as done: without this
  // flag main rewrites the seeded workspace to one fresh "Session 1".
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

async function launch(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  // Narrow, not maximized: the title bar has to share its row between the brand,
  // the session name and the panel tools.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(900, 700)
  })
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
  return { app, window }
}

test('the session title seats the name and menu in the title bar without covering either', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seed(userData, project)
  const { app, window } = await launch(userData)
  try {
    // No pane header row at all — the chat pane starts at the top.
    await expect(window.locator('.pane-header')).toHaveCount(0)

    const geometry = await window.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      const name = document.querySelector<HTMLElement>('.title-bar-session-name')!
      return {
        bar: box('.title-bar')!,
        session: box('.title-bar-session')!,
        name: box('.title-bar-session-name')!,
        menu: box('.title-bar-session .icon-btn')!,
        tools: box('.title-bar-tools')!,
        nameClipped: name.scrollWidth > name.clientWidth,
        fullName: name.getAttribute('title')
      }
    })

    // The title keeps the whole name available (tooltip) but truncates it visually.
    expect(geometry.fullName).toBe(LONG_NAME)
    expect(geometry.nameClipped).toBe(true)

    // The `⋮` stays inside the title bar, left of the panel tools: never covered.
    expect(geometry.menu.right).toBeLessThanOrEqual(geometry.session.right + 0.5)
    expect(geometry.menu.right).toBeLessThanOrEqual(geometry.tools.left + 0.5)
    expect(geometry.name.right).toBeLessThanOrEqual(geometry.menu.left + 0.5)
    expect(geometry.tools.right).toBeLessThanOrEqual(geometry.bar.right + 0.5)

    // The panel tools are all still on the bar (the browser toggle is the last one).
    await expect(window.locator('.title-bar-tools .icon-btn[aria-label="Toggle browser"]')).toBeVisible()
    await expect(window.locator('.title-bar-tools .icon-btn[aria-label="Toggle files"]')).toBeVisible()

    // And the session menu actually receives the click instead of being covered.
    await window.getByRole('button', { name: `menu ${LONG_NAME}`, exact: true }).click()
    await expect(window.getByRole('button', { name: 'Delete session' })).toBeVisible()
    await window.keyboard.press('Escape')

    // Collapsed sidebar: the brand strip shrinks to its logo + toggle, so the session
    // title moves left and sits right next to the expand button instead of starting
    // 22.33rem in over an empty strip.
    await window.locator('.sidebar-toggle[aria-label="Collapse sidebar"]').click()
    const collapsed = await window.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel)!
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      return {
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 12,
        brand: box('.title-bar-brand'),
        session: box('.title-bar-session')
      }
    })
    expect(collapsed.brand.width).toBeLessThan(8 * collapsed.rem)
    expect(collapsed.session.left - collapsed.brand.right).toBeLessThan(0.75 * collapsed.rem)
    expect(collapsed.session.left).toBeLessThan(7 * collapsed.rem)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
