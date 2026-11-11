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
  // without this flag main rewrites every seeded workspace to one fresh session.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

// One commit, then a modified tracked file, a staged file and an untracked file.
function seedGitRepo(project: string): void {
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'src', 'index.ts'), 'export const answer = 42\n')
  writeFileSync(path.join(project, 'committed.txt'), 'one\n')
  execFileSync('git', ['init', '-q'], { cwd: project })
  execFileSync('git', ['add', '-A'], { cwd: project })
  // An isolated identity, never the machine's global git config.
  execFileSync('git', [
    '-c', 'user.email=e2e@test', '-c', 'user.name=e2e',
    'commit', '-q', '-m', 'init commit'
  ], { cwd: project })
  writeFileSync(path.join(project, 'committed.txt'), 'two\n')
  writeFileSync(path.join(project, 'src', 'index.ts'), 'export const answer = 43\n')
  execFileSync('git', ['add', 'src/index.ts'], { cwd: project })
  writeFileSync(path.join(project, 'untracked.txt'), 'new\n')
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

test('the Git panel expands a changed file and a commit in place', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-proj-'))
  seedWorkspaces(userData, project)
  seedGitRepo(project)

  const { app, window } = await launch(userData)
  try {
    await openProject(window)

    await window.getByRole('button', { name: 'Toggle Git panel', exact: true }).click()
    const panel = window.locator('.git-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.git-branch-chip')).toBeVisible()

    // The header fits the docked column: tabs, branch chip and the three icon buttons.
    const fits = await panel.locator('.panel-head').evaluate(el => el.scrollWidth <= el.clientWidth + 1)
    expect(fits, 'the Git panel header overflows its column').toBe(true)
    const panelWidth = await panel.evaluate(el => el.getBoundingClientRect().width)
    expect(panelWidth).toBeGreaterThan(300)

    // Working tree: the staged file and the unstaged files are two flat groups.
    await expect(panel.locator('.git-group-label')).toContainText(['Staged', 'Changes'])
    await expect(panel.locator('.git-file-row', { hasText: 'committed.txt' })).toBeVisible()
    await expect(panel.locator('.git-file-row', { hasText: 'untracked.txt' })).toBeVisible()
    const rowOverflow = await panel.locator('.git-file-row').first().evaluate(el => el.scrollWidth - el.clientWidth)
    expect(rowOverflow).toBeLessThanOrEqual(1)

    // Rows are flat lines, never a stack of UA <button> boxes (grey fill + outset border).
    const rowStyle = await panel.locator('.git-file-row').first().evaluate(el => {
      const s = getComputedStyle(el)
      return { border: s.borderTopWidth, bg: s.backgroundColor, align: s.textAlign }
    })
    expect(rowStyle).toEqual({ border: '0px', bg: 'rgba(0, 0, 0, 0)', align: 'left' })

    // A file row expands to its diff right under itself.
    await panel.locator('.git-file-row', { hasText: 'committed.txt' }).click()
    await expect(panel.locator('.git-file-row.open')).toHaveCount(1)
    await expect(panel.locator('.git-inline-diff .git-diff-line.add .git-diff-text')).toContainText('two')

    // History: one commit, expanding to its message and changed files.
    await panel.getByRole('tab', { name: 'History' }).click()
    const commit = panel.locator('.git-commit-row', { hasText: 'init commit' })
    await expect(commit).toBeVisible()
    await commit.click()
    await expect(panel.locator('.git-commit-files-head')).toContainText('2 files')
    const fileRow = panel.locator('.git-commit-file', { hasText: 'committed.txt' })
    await expect(fileRow).toBeVisible()

    // A file inside the commit swaps the list for that file's diff.
    await fileRow.click()
    await expect(panel.locator('.git-back-row')).toContainText('2 files')
    await expect(panel.locator('.git-inline-diff .git-diff-line.add .git-diff-text')).toContainText('one')
    await expect(panel.locator('.git-commit-files')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupDir(userData)
    cleanupDir(project)
  }
})
