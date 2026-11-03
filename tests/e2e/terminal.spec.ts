import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

test('session terminal dock opens, executes commands, persists across session switch, and closes', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))

  try {
    const workspaces = [
      {
        projectPath: project,
        name: 'E2E Project',
        agents: [
          { id: 'e2e-0', name: 'session-1', templateId: 'meow', cwd: project, kind: 'native' },
          { id: 'e2e-1', name: 'session-2', templateId: 'meow', cwd: project, kind: 'native' }
        ]
      }
    ]
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify(workspaces, null, 2))
    writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))

    const app = await electron.launch({
      args: ['.'],
      env: { ...(process.env as Record<string, string>), MEOW_USER_DATA: userData }
    })

    try {
      const window = await app.firstWindow()
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-toggle').click()
      await expect(window.locator('.session-list')).toBeVisible()
      await expect(window.locator('.session-row')).toHaveCount(2)

      // Ensure session-1 is active
      await window.locator('.session-row').first().click()
      await expect(window.locator('.pane.active')).toBeVisible()

      // Toggle dock via keyboard shortcut
      const toggleShortcut = process.platform === 'darwin' ? 'Meta+Backquote' : 'Control+Backquote'
      await window.keyboard.press(toggleShortcut)

      // Wait for terminal tab and xterm screen to mount
      await expect(window.locator('.terminal-tab')).toHaveCount(1, { timeout: 20_000 })
      await expect(window.locator('.terminal-view-container .xterm-screen')).toBeVisible({ timeout: 20_000 })

      // Wait until initial shell prompt or output appears in the xterm rows
      await expect
        .poll(
          async () => {
            const text = await window.locator('.terminal-view-container .xterm-rows').textContent()
            return (text || '').trim().length > 0
          },
          { timeout: 30_000 }
        )
        .toBe(true)

      // Focus terminal and type command
      await window.locator('.terminal-view-container .xterm-screen').click()
      await window.keyboard.type('echo E2E_TERM')
      await window.keyboard.press('Enter')

      // Assert xterm rows contain a line that is exactly E2E_TERM
      await expect
        .poll(
          async () => {
            return await window.locator('.terminal-view-container .xterm-rows > div').evaluateAll((divs) =>
              divs.map((d) => (d.textContent || '').trim()).filter(Boolean)
            )
          },
          { timeout: 30_000 }
        )
        .toEqual(expect.arrayContaining(['E2E_TERM']))

      // Switch to session-2
      await window.locator('.session-row').nth(1).click()
      await expect(window.locator('.session-row').nth(1)).toHaveClass(/active/)

      // Switch back to session-1
      await window.locator('.session-row').first().click()
      await expect(window.locator('.session-row').first()).toHaveClass(/active/)
      await expect(window.locator('.terminal-view-container .xterm-screen')).toBeVisible({ timeout: 20_000 })

      // Assert E2E_TERM is still present in the dock via re-attach + scrollback
      await expect
        .poll(
          async () => {
            return await window.locator('.terminal-view-container .xterm-rows > div').evaluateAll((divs) =>
              divs.map((d) => (d.textContent || '').trim()).filter(Boolean)
            )
          },
          { timeout: 20_000 }
        )
        .toEqual(expect.arrayContaining(['E2E_TERM']))

      // Close the tab via its close button
      await window.locator('.terminal-tab-close').first().click()
      await expect(window.locator('.terminal-tab')).toHaveCount(0, { timeout: 10_000 })
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
