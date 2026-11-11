import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'

// A `.full` (expanded) panel is `position: absolute` and covers the pane area edge to
// edge, so which ancestor resolves its insets decides how much it covers. It has to resolve against
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

async function openFromToolbar(window: Page, label: 'files' | 'tasks'): Promise<void> {
  await window.locator(`.title-bar-tools .icon-btn[aria-label="Toggle ${label}"]`).click()
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
    await openFromToolbar(window, 'files')
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

    // Expanded fills the pane area edge to edge, so it covers the chat pane instead of
    // the docked column.
    expect(full!.x).toBeCloseTo(main!.x, 0)
    expect(full!.y).toBeCloseTo(main!.y, 0)
    expect(full!.w).toBeCloseTo(main!.w, 0)
    expect(full!.h).toBeCloseTo(main!.h, 0)
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

test('the Tasks panel docks in the right column and maximizes over the pane area', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspaces(userData, project)
  const { app, window } = await launch(userData)
  try {
    await openFromToolbar(window, 'tasks')
    await window.locator('.tasks-panel').waitFor()
    // Docked: one cell of the right-hand grid, exactly like the Files panel.
    await expect(window.locator('.right-panel-cell > .tasks-panel')).toHaveCount(1)
    const main = await rectOf(window, '.main')
    const grid = await rectOf(window, '.right-panels-grid')
    const docked = await rectOf(window, '.tasks-panel')
    // Same column as the other panels: right-hand side, grid height, grid width
    // minus its 1px left hairline.
    expect(docked!.x).toBeGreaterThan(main!.x + main!.w / 2)
    expect(docked!.h).toBeCloseTo(grid!.h, 0)
    expect(docked!.w).toBeGreaterThan(grid!.w - 8)
    await expect(window.locator('.workspace-active')).toBeVisible()

    await window.getByRole('button', { name: 'Maximize', exact: true }).click()
    await window.locator('.tasks-panel.full').waitFor()
    const full = await rectOf(window, '.tasks-panel.full')
    expect(full!.x).toBeCloseTo(main!.x, 0)
    expect(full!.w).toBeCloseTo(main!.w, 0)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

// The grid fills its cells column by column, so a short column's panel stretches over
// the rows the others left. With three docked panels the third one spans both rows of
// the right column instead of sitting in the top cell and leaving the cell below it
// empty (the bug this guards).
test('three docked panels fill the grid without an empty cell', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  seedWorkspaces(userData, project)
  const { app, window } = await launch(userData)
  try {
    await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle files"]').click()
    await window.locator('.files-overlay').waitFor()
    await openFromToolbar(window, 'tasks')
    await window.locator('.tasks-panel').waitFor()
    await window.locator('.title-bar-tools .icon-btn[aria-label="Toggle Git panel"]').click()
    await window.locator('.git-panel').waitFor()

    await expect(window.locator('.right-panel-cell')).toHaveCount(3)
    const grid = await rectOf(window, '.right-panels-grid')
    const files = await rectOf(window, '.files-overlay.docked')
    const tasks = await rectOf(window, '.tasks-panel')
    const git = await rectOf(window, '.git-panel.docked')
    expect(grid && files && tasks && git).toBeTruthy()

    // The two first panels share the left column, one above the other.
    expect(files!.x).toBeCloseTo(tasks!.x, 0)
    expect(tasks!.y).toBeGreaterThan(files!.y + files!.h - 2)
    expect(files!.w).toBeCloseTo(tasks!.w, 0)
    // The third spans both rows of the right column: no empty cell under it.
    expect(git!.x).toBeGreaterThan(files!.x + files!.w - 2)
    expect(git!.h).toBeCloseTo(grid!.h, 0)
    expect(git!.w).toBeCloseTo(files!.w, 0)

    // Two panels in one column give that column a vertical splitter.
    const splitter = window.locator('.right-panels-row-resizer')
    await expect(splitter).toHaveCount(1)
    const handle = await splitter.boundingBox()
    expect(handle).toBeTruthy()
    await window.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
    await window.mouse.down()
    await window.mouse.move(handle!.x + handle!.width / 2, handle!.y + 120, { steps: 6 })
    await window.mouse.up()
    const grown = await rectOf(window, '.files-overlay.docked')
    expect(grown!.h).toBeGreaterThan(files!.h + 60)
    // The spanning panel keeps covering the whole column height.
    const stillFull = await rectOf(window, '.git-panel.docked')
    expect(stillFull!.h).toBeCloseTo(grid!.h, 0)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
