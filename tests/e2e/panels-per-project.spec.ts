import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Electron leaves cache file handles open briefly after app.close() on Windows;
// retry so a transient EPERM/EBUSY never masks a real assertion failure.
function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function seedWorkspaces(userData: string, projects: { path: string; name: string }[]): void {
  const workspaces = projects.map(p => ({
    projectPath: p.path,
    name: p.name,
    agents: [{ id: `e2e-${p.name.toLowerCase()}`, name: `${p.name} session`, templateId: 'meow', cwd: p.path, kind: 'native' }]
  }))
  writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
  // Mark the one-time v0.37 "single native session" migration as already done:
  // without this flag main rewrites every seeded workspace to one fresh session
  // with a new random id (src/main/fresh-start.ts), discarding the fixtures.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

function seedProject(project: string, file: string): void {
  mkdirSync(project, { recursive: true })
  writeFileSync(path.join(project, file), '# E2E project\n')
}

async function launch(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toHaveCount(2)
  return { app, window }
}

/** The project's sidebar block: its header row plus the session list under it. */
function projectBlock(window: Page, name: string) {
  return window.locator('.project-row', { hasText: name }).locator('..')
}

async function openProject(window: Page, name: string): Promise<void> {
  const block = projectBlock(window, name)
  const toggle = block.locator('.project-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await block.locator('.session-list .session-row').first().click()
  await expect(window.locator('.session-panes')).toBeVisible()
}

const filesPanel = (window: Page) => window.locator('.files-overlay')
const gitPanel = (window: Page) => window.locator('.git-panel')

test('right-hand panels are remembered per project folder', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const alpha = mkdtempSync(path.join(tmpdir(), 'meow-alpha-'))
  const beta = mkdtempSync(path.join(tmpdir(), 'meow-beta-'))
  try {
    seedWorkspaces(userData, [{ path: alpha, name: 'Alpha' }, { path: beta, name: 'Beta' }])
    seedProject(alpha, 'alpha.md')
    seedProject(beta, 'beta.md')
    const { app, window } = await launch(userData)
    try {
      await openProject(window, 'Alpha')
      await window.getByRole('button', { name: 'Toggle files', exact: true }).click()
      await expect(filesPanel(window)).toBeVisible()

      // Another folder shows its own (closed) panes, not Alpha's.
      await openProject(window, 'Beta')
      await expect(filesPanel(window)).toHaveCount(0)

      // Beta's own Files panel is independent, and Alpha's state survives the round trip.
      await window.getByRole('button', { name: 'Toggle files', exact: true }).click()
      await expect(filesPanel(window)).toBeVisible()
      await expect(window.locator('.files-tree-row', { hasText: 'beta.md' })).toBeVisible()

      await openProject(window, 'Alpha')
      await expect(filesPanel(window)).toBeVisible()
      await expect(window.locator('.files-tree-row', { hasText: 'alpha.md' })).toBeVisible()

      // Closing in one folder leaves the other folder's panel alone.
      await window.getByRole('button', { name: 'Toggle files', exact: true }).click()
      await expect(filesPanel(window)).toHaveCount(0)
      await openProject(window, 'Beta')
      await expect(filesPanel(window)).toBeVisible()
      await window.getByRole('button', { name: 'Toggle files', exact: true }).click()
      await expect(filesPanel(window)).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(alpha)
    cleanupDir(beta)
  }
})

test('the Git panel opens per project, and the sidebar Git item activates that project', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const alpha = mkdtempSync(path.join(tmpdir(), 'meow-alpha-'))
  const beta = mkdtempSync(path.join(tmpdir(), 'meow-beta-'))
  try {
    seedWorkspaces(userData, [{ path: alpha, name: 'Alpha' }, { path: beta, name: 'Beta' }])
    seedProject(alpha, 'alpha.md')
    seedProject(beta, 'beta.md')
    const { app, window } = await launch(userData)
    try {
      await openProject(window, 'Alpha')
      await window.getByRole('button', { name: 'Toggle Git panel', exact: true }).click()
      await expect(gitPanel(window)).toBeVisible()

      // Beta has no Git panel of its own yet.
      await openProject(window, 'Beta')
      await expect(gitPanel(window)).toHaveCount(0)

      // The project menu's Git item shows that project's panel, activating it first.
      await window.getByRole('button', { name: 'menu Alpha', exact: true }).click()
      await window.locator('.menu-item', { hasText: 'Git' }).first().click()
      await expect(window.locator('.project-row', { hasText: 'Alpha' }).locator('..')).toHaveClass(/active/)
      await expect(gitPanel(window)).toBeVisible()

      // Alpha's panel stays open while Beta keeps its own (closed) state.
      await openProject(window, 'Beta')
      await expect(gitPanel(window)).toHaveCount(0)
      await openProject(window, 'Alpha')
      await expect(gitPanel(window)).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(alpha)
    cleanupDir(beta)
  }
})
