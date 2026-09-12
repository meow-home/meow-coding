import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Electron leaves cache file handles open briefly after app.close() on Windows;
// retry so a transient EPERM/EBUSY never masks a real assertion failure.
function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

/** A real git repo with one commit — without it GitBranchSwitcher renders no local branch. */
function initRepo(project: string): void {
  execFileSync('git', ['init', '-q'], { cwd: project })
  execFileSync('git', [
    '-c', 'user.email=e2e@test', '-c', 'user.name=e2e',
    'commit', '-q', '--allow-empty', '-m', 'init'
  ], { cwd: project })
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

async function openProject(window: Page): Promise<void> {
  await expect(window.locator('.project-row')).toBeVisible()
  await window.locator('.project-row').click()
}

/**
 * An element's rotation in degrees, derived from its computed transform matrix.
 * Reading the angle (rather than comparing matrix strings) is robust to both the
 * 120ms transition and Chrome's float serialization of rotate(180deg).
 * No transform resolves to identity, i.e. 0 degrees.
 */
function rotationDeg(page: Page, sel: string): Promise<number> {
  return page.locator(sel).evaluate(e => {
    const m = new DOMMatrixReadOnly(getComputedStyle(e).transform)
    return Math.round(Math.abs(Math.atan2(m.b, m.a) * 180 / Math.PI))
  })
}

test('selector triggers carry one shared caret that rotates while open', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    initRepo(project)
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // ModePicker (built on the shared Dropdown base)
      const modeTrigger = window.getByRole('button', { name: 'Mode', exact: true })
      await expect(modeTrigger.locator('svg.dropdown-caret')).toHaveCount(1)
      await expect(modeTrigger).toHaveAttribute('aria-expanded', 'false')
      expect(await rotationDeg(window, '.dropdown-trigger .dropdown-caret')).toBe(0)
      await modeTrigger.click()
      await expect(window.locator('.mode-menu')).toBeVisible()
      await expect(modeTrigger).toHaveAttribute('aria-expanded', 'true')
      // Poll: the caret animates over 120ms, so the final angle is what matters.
      await expect.poll(() => rotationDeg(window, '.dropdown-trigger .dropdown-caret')).toBe(180)
      await window.keyboard.press('Escape')
      await expect(modeTrigger).toHaveAttribute('aria-expanded', 'false')

      // ModelPicker: own trigger, must join the same mechanism.
      const modelTrigger = window.locator('.model-trigger')
      await expect(modelTrigger.locator('svg.dropdown-caret')).toHaveCount(1)
      await expect(modelTrigger).toHaveAttribute('aria-expanded', 'false')
      await modelTrigger.click()
      await expect(modelTrigger).toHaveAttribute('aria-expanded', 'true')
      await window.keyboard.press('Escape')

      // GitBranchSwitcher lives in its own popup window.
      const popup = app.waitForEvent('window', { timeout: 20000 })
      await window.getByRole('button', { name: 'menu E2E Project', exact: true }).click()
      await window.getByRole('button', { name: 'Git', exact: true }).click()
      const gitWindow = await popup
      await gitWindow.waitForLoadState('domcontentloaded')
      await gitWindow.locator('.git-branch-current').click()
      await expect(gitWindow.locator('.git-branch-dropdown')).toBeVisible()
      await expect(gitWindow.locator('.git-branch-current svg.dropdown-caret')).toHaveCount(1)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
