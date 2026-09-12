import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
  // without this flag main rewrites the workspace to one fresh session.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

async function launch(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.sidebar')
  return { app, window }
}

/** Opens the seeded project and expands its session list. */
async function openProject(window: Page): Promise<void> {
  await expect(window.locator('.project-row')).toBeVisible()
  await window.locator('.project-row').click()
  await window.locator('.project-expand').click()
  await expect(window.locator('.session-list')).toBeVisible()
}

/** Computed + box metrics of a menu's rows, for geometry assertions. */
async function rows(window: Page, containerSel: string): Promise<{
  h: number; padding: string; radius: string
}[]> {
  return window.evaluate((sel: string) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error('menu not found: ' + sel)
    return Array.from(el.querySelectorAll('button')).map(b => {
      const r = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      return { h: Math.round(r.height), padding: cs.padding, radius: cs.borderRadius }
    })
  }, containerSel)
}

async function containerStyle(window: Page, sel: string): Promise<{ radius: string; padding: string; gap: string }> {
  return window.evaluate((s: string) => {
    const el = document.querySelector(s)
    if (!el) throw new Error('menu not found: ' + s)
    const cs = getComputedStyle(el)
    return { radius: cs.borderRadius, padding: cs.padding, gap: cs.gap }
  }, sel)
}

test('every menu shares one metric set', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // Project menu (a sidebar dropdown)
      await window.getByRole('button', { name: 'menu E2E Project', exact: true }).click()
      await expect(window.locator('.project-menu-dropdown')).toBeVisible()
      const projectItems = await rows(window, '.project-menu-dropdown')
      expect(projectItems.length).toBe(6)
      for (const item of projectItems) {
        expect(item.h).toBe(32)
        expect(item.padding).toBe('0px 10px')
        expect(item.radius).toBe('6px')
      }
      const projectBox = await containerStyle(window, '.project-menu-dropdown')
      expect(projectBox.radius).toBe('10px')
      expect(projectBox.padding).toBe('6px')
      expect(projectBox.gap).toBe('0px')

      // Mode picker (a metrics-only surface)
      await window.keyboard.press('Escape')
      await window.getByRole('button', { name: 'Mode', exact: true }).click()
      await expect(window.locator('.mode-menu')).toBeVisible()
      const modeItems = await rows(window, '.mode-menu')
      expect(modeItems.length).toBe(2)
      for (const item of modeItems) {
        expect(item.h).toBe(32)
        expect(item.radius).toBe('6px')
      }
      const modeBox = await containerStyle(window, '.mode-menu')
      expect(modeBox.radius).toBe('10px')
      expect(modeBox.padding).toBe('6px')
      expect(modeBox.gap).toBe('0px')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('action menus carry icons, a divider and a path header; pickers do not', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      await window.getByRole('button', { name: 'menu E2E Project', exact: true }).click()
      await expect(window.locator('.project-menu-dropdown')).toBeVisible()
      const projectMenu = window.locator('.project-menu-dropdown')
      // Every row renders exactly one icon; it is decorative, so the accessible
      // name stays the label the other suites click.
      await expect(projectMenu.locator('.menu-item')).toHaveCount(6)
      await expect(projectMenu.locator('.menu-item svg')).toHaveCount(6)
      await expect(projectMenu.locator('.menu-item svg').first()).toHaveAttribute('aria-hidden', 'true')
      await expect(projectMenu.locator('.menu-sep')).toHaveCount(1)
      await expect(projectMenu.locator('.menu-head')).toHaveCount(1)
      await expect(projectMenu.locator('.menu-head')).toHaveAttribute('title', project)
      // The icon column is a fixed width, so labels line up across rows.
      const iconWidths = await projectMenu.locator('.menu-item svg').evaluateAll(
        els => els.map(e => Math.round(e.getBoundingClientRect().width))
      )
      expect(new Set(iconWidths).size).toBe(1)
      expect(iconWidths[0]).toBe(16)

      // Session menu: icons + divider, no header.
      await window.keyboard.press('Escape')
      const row = window.locator('.session-list .session-row').first()
      await row.hover()
      await row.getByRole('button', { name: 'Session menu', exact: true }).click()
      const sessionMenu = window.locator('.session-menu-dropdown')
      await expect(sessionMenu).toBeVisible()
      await expect(sessionMenu.locator('.menu-item svg')).toHaveCount(2)
      await expect(sessionMenu.locator('.menu-sep')).toHaveCount(1)

      // A picker stays icon-free and separator-free — the scope split is deliberate.
      await window.keyboard.press('Escape')
      await window.getByRole('button', { name: 'Mode', exact: true }).click()
      const modeMenu = window.locator('.mode-menu')
      await expect(modeMenu).toBeVisible()
      await expect(modeMenu.locator('svg')).toHaveCount(0)
      await expect(modeMenu.locator('.menu-sep')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
