import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
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

const LONG_NAME = 'this-is-a-very-long-file-name-that-gets-truncated-in-the-tree.ts'

// A real repository: one commit, then one modified tracked file, one modified
// file in a directory, one untracked file, one ignored file and one long name.
function seedGitRepo(project: string): void {
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, '.gitignore'), 'ignored.txt\n')
  writeFileSync(path.join(project, 'src', 'index.ts'), 'export const answer = 42\n')
  writeFileSync(path.join(project, 'committed.txt'), 'one\n')
  writeFileSync(path.join(project, LONG_NAME), 'export const long = 1\n')
  execFileSync('git', ['init', '-q'], { cwd: project })
  execFileSync('git', ['add', '-A'], { cwd: project })
  // An isolated identity, never the machine's global git config.
  execFileSync('git', [
    '-c', 'user.email=e2e@test', '-c', 'user.name=e2e',
    'commit', '-q', '-m', 'init'
  ], { cwd: project })
  writeFileSync(path.join(project, 'committed.txt'), 'two\n')
  writeFileSync(path.join(project, 'src', 'index.ts'), 'export const answer = 43\n')
  writeFileSync(path.join(project, LONG_NAME), 'export const long = 2\n')
  writeFileSync(path.join(project, 'untracked.txt'), 'new\n')
  writeFileSync(path.join(project, 'ignored.txt'), 'ignored\n')
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
      await expect(window.locator('.files-bar .viewer-path')).toHaveText('src/index.ts')

      // The bar spans the whole panel: its right edge is the panel's inner right
      // edge (inside the 1px border), and both columns start below it.
      const barGap = await window.evaluate(() => {
        const panel = document.querySelector('.files-overlay') as HTMLElement
        const bar = document.querySelector('.files-bar') as HTMLElement
        const border = parseFloat(getComputedStyle(panel).borderRightWidth)
        return panel.getBoundingClientRect().right - border - bar.getBoundingClientRect().right
      })
      expect(Math.abs(barGap)).toBeLessThanOrEqual(1)

      const bar = (await window.locator('.files-bar').boundingBox())!
      expect(tree.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
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
      await expect(window.locator('.files-side')).toBeVisible()

      // The tree is hidden, not unmounted, so an expanded folder survives.
      await window.locator('.files-tree-row', { hasText: 'src' }).click()
      await expect(window.locator('.files-tree-row', { hasText: 'index.ts' })).toBeVisible()

      const toggle = window.getByRole('button', { name: 'Toggle file tree', exact: true })
      await toggle.click()
      await expect(window.locator('.files-side')).toBeHidden()
      await expect.poll(() => window.evaluate(() => localStorage.getItem('meow.files.treeHidden')))
        .toBe('1')

      await toggle.click()
      await expect(window.locator('.files-side')).toBeVisible()
      await expect(window.locator('.files-tree-row', { hasText: 'index.ts' })).toBeVisible()

      // Closing the panel unmounts it; reopening mounts a fresh instance that
      // must read the stored choice. With no open file the empty bar keeps the
      // toggle reachable.
      await toggle.click()
      await expect(window.locator('.files-side')).toBeHidden()
      await window.getByRole('button', { name: 'Close Files', exact: true }).click()
      await expect(window.locator('.files-overlay')).toHaveCount(0)
      await openFilesPanel(window)
      await expect(window.locator('.files-side')).toBeHidden()
      await expect(window.getByRole('button', { name: 'Toggle file tree', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

test('the tree shows file type icons and git state', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedGitRepo(project)
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      await openFilesPanel(window)

      // A modified tracked file: the letter sits at the row's right edge.
      const committed = window.locator('.files-tree-row', { hasText: 'committed.txt' })
      await expect(committed.locator('.files-git-letter')).toHaveText('M')
      // An untracked file.
      await expect(window.locator('.files-tree-row', { hasText: 'untracked.txt' })
        .locator('.files-git-letter')).toHaveText('U')
      // A directory holding a change shows a dot instead of a letter.
      const srcRow = window.locator('.files-tree-row', { hasText: 'src' })
      await expect(srcRow.locator('.files-git-dot')).toBeVisible()
      // `.git` and ignored files stay clean (porcelain never lists them).
      await expect(window.locator('.files-tree-row', { hasText: /^\.git$/ })
        .locator('.files-git-dot')).toHaveCount(0)
      await expect(window.locator('.files-tree-row', { hasText: 'ignored.txt' })
        .locator('.files-git-letter')).toHaveCount(0)

      // A long name still ellipsizes and keeps its letter on screen.
      const longRow = window.locator('.files-tree-row', { hasText: 'this-is-a-very-long-file-name' })
      await expect(longRow.locator('.files-git-letter')).toHaveText('M')
      expect(await longRow.locator('.tree-name').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
      const letter = (await longRow.locator('.files-git-letter').boundingBox())!
      const row = (await longRow.boundingBox())!
      expect(letter.x + letter.width).toBeLessThanOrEqual(row.x + row.width)

      // File type icons: a code file in the tree and the same icon on its tab.
      await srcRow.click()
      const codeRow = window.locator('.files-tree-row', { hasText: 'index.ts' })
      await expect(codeRow.locator('.file-icon-code')).toHaveCount(1)
      await codeRow.click()
      await expect(window.locator('.files-bar .viewer-path')).toHaveText('src/index.ts')
      await expect(window.locator('.files-open-tab .file-icon-code')).toHaveCount(1)

      // Content-search hits keep their own layout with the typed icon in front.
      const filter = window.locator('.files-filter-input')
      await filter.fill('?answer')
      const hit = window.locator('.files-tree-row', { hasText: 'answer' })
      await expect(hit.locator('.file-icon-code')).toHaveCount(1)
      await expect(hit.locator('.files-hit-line')).toHaveText('1')
      await expect(hit.locator('.files-hit-text')).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
