import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  // without this flag main rewrites every seeded workspace to one fresh session
  // with a new random id (src/main/fresh-start.ts), discarding the fixtures.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

function seedProject(project: string): void {
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'README.md'), '# E2E project\n')
  writeFileSync(path.join(project, 'src', 'index.ts'), 'export const answer = 42\n')
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

// Expands the seeded project's session list and opens its pane.
async function openProject(window: Page): Promise<void> {
  await window.locator('.project-toggle').click()
  await expect(window.locator('.session-list')).toBeVisible()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.session-panes')).toBeVisible()
}

async function openFilesPanel(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Toggle files', exact: true }).click()
  await expect(window.locator('.files-overlay')).toBeVisible()
}

test('the file tree sits right of the editor and the bar names the open file', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedProject(project)
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      await openFilesPanel(window)

      await expect(window.locator('.files-filter-input'))
        .toHaveAttribute('placeholder', 'Filter, or ? to search in files')

      // The tree is the right-hand column: its left edge starts where the editor
      // column ends. A pixel of tolerance absorbs sub-pixel layout rounding.
      const editor = (await window.locator('.files-main').boundingBox())!
      const tree = (await window.locator('.files-side').boundingBox())!
      expect(tree.x).toBeGreaterThanOrEqual(editor.x + editor.width - 1)

      // Open a nested file so the bar must show the project-relative path, not
      // the absolute one.
      await window.locator('.files-tree-row', { hasText: 'src' }).click()
      await window.locator('.files-tree-row', { hasText: 'index.ts' }).click()
      await expect(window.locator('.files-tab-pane:not([hidden]) .viewer-path'))
        .toHaveText('src/index.ts')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('the tree toggle hides the tree and the choice survives closing the panel', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedProject(project)
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      await openFilesPanel(window)
      await expect(window.locator('.files-side')).toHaveCount(1)

      await window.getByRole('button', { name: 'Toggle file tree', exact: true }).click()
      await expect(window.locator('.files-side')).toHaveCount(0)
      await expect.poll(() => window.evaluate(() => localStorage.getItem('meow.files.treeHidden')))
        .toBe('1')

      // Closing the panel unmounts it; reopening mounts a fresh instance that
      // must read the stored choice. With no open file the empty bar keeps the
      // toggle reachable.
      await window.getByRole('button', { name: 'Close Files', exact: true }).click()
      await expect(window.locator('.files-overlay')).toHaveCount(0)
      await openFilesPanel(window)
      await expect(window.locator('.files-side')).toHaveCount(0)
      await expect(window.getByRole('button', { name: 'Toggle file tree', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
