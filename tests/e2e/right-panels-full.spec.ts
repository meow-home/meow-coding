import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'

// A `.full` (expanded) panel is `position: absolute` with sub-pixel insets, so which
// ancestor resolves those insets decides how much it covers. It has to resolve against
// `.main` (the whole pane area, chat included) — not against `.right-panels-container`,
// the 420px column the docked panels live in, which is `position: relative` for its
// resizer. Getting this wrong confines "expand" to the docked column and leaves the
// chat pane uncovered, which is invisible to typecheck and to CSS-only assertions.

function seedWorkspaces(userData: string, project: string): void {
  writeFileSync(
    path.join(userData, 'workspaces.json'),
    JSON.stringify(
      [
        {
          projectPath: project,
          name: 'E2E Project',
          agents: [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
        }
      ],
      null,
      2
    )
  )
}

async function launch(userData: string) {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await window.locator('.session-panes').waitFor()
  return { app, window }
}

async function openFromPaneMenu(window: Page, label: 'Files' | 'Processes'): Promise<void> {
  await window.locator('.pane-header .pane-menu button').first().click()
  await window.locator('button.menu-item').filter({ hasText: new RegExp(`^${label}$`) }).click()
}

function rectOf(window: Page, selector: string) {
  return window.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }, selector)
}

test('expanding a panel covers the pane area, not just the docked column', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspaces(userData, project)
  const { app, window } = await launch(userData)
  try {
    await openFromPaneMenu(window, 'Files')
    await window.locator('.files-overlay').waitFor()

    // Docked first: the panel sits in the right-hand column, chat pane still visible.
    await expect(window.locator('.right-panels-container')).toBeVisible()
    const docked = await rectOf(window, '.files-overlay.docked')
    const chat = await rectOf(window, '.chat-panel')

    await window.getByRole('button', { name: 'Expand', exact: true }).click()
    await window.locator('.files-overlay.full').waitFor()

    const main = await rectOf(window, '.main')
    const full = await rectOf(window, '.files-overlay.full')
    expect(main).not.toBeNull()
    expect(full).not.toBeNull()

    // The containing block must be `.main`, not the docked container.
    const offsetParentClass = await window.evaluate(() => {
      const el = document.querySelector('.files-overlay.full')
      return el instanceof HTMLElement ? (el.offsetParent as HTMLElement | null)?.className ?? null : null
    })
    expect(offsetParentClass).toContain('main')

    // Expanded fills the pane area within its 0.333333rem gap on every edge, so it
    // covers the chat pane instead of the docked column.
    expect(full!.x).toBeCloseTo(main!.x + 4, 0)
    expect(full!.w).toBeCloseTo(main!.w - 8, 0)
    expect(full!.w).toBeGreaterThan(docked!.w + 400)
    expect(full!.w).toBeGreaterThan(chat!.w)

    // Nothing is docked while the only panel is expanded — no leftover empty column.
    await expect(window.locator('.right-panels-container')).toHaveCount(0)

    // Restoring brings the docked column back.
    await window.getByRole('button', { name: 'Restore size', exact: true }).click()
    await window.locator('.files-overlay.docked').waitFor()
    await expect(window.locator('.right-panels-container')).toBeVisible()
    const restored = await rectOf(window, '.files-overlay.docked')
    expect(restored!.w).toBeCloseTo(docked!.w, 0)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('expanding the Processes panel covers the pane area too', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspaces(userData, project)
  const { app, window } = await launch(userData)
  try {
    await openFromPaneMenu(window, 'Processes')
    await window.locator('.processes-overlay').waitFor()
    await window.getByRole('button', { name: 'Expand', exact: true }).click()
    await window.locator('.processes-overlay.full').waitFor()

    const main = await rectOf(window, '.main')
    const full = await rectOf(window, '.processes-overlay.full')
    expect(full!.x).toBeCloseTo(main!.x + 4, 0)
    expect(full!.w).toBeCloseTo(main!.w - 8, 0)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
