import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'

// A new session's footer chip is the project picker: the known projects plus
// "Choose folder…". It only exists while the session is a draft — once the first
// message materializes the agent its cwd is fixed, so the footer must fall back to
// plain text. The sidebar's old "Add folder" action is gone; this picker replaced it.

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

interface SeedProject {
  path: string
  name: string
  agents: { id: string; name: string }[]
}

function seedWorkspaces(userData: string, projects: SeedProject[]): void {
  writeFileSync(
    path.join(userData, 'workspaces.json'),
    JSON.stringify(
      projects.map(p => ({
        projectPath: p.path,
        name: p.name,
        agents: p.agents.map(a => ({ id: a.id, name: a.name, templateId: 'meow', cwd: p.path, kind: 'native' }))
      })),
      null,
      2
    )
  )
  // Skip the one-time "single native session" migration, which would rewrite the
  // fixtures into one fresh session per project.
  writeFileSync(path.join(userData, '.sessions-model-reset'), String(Date.now()))
}

async function launch(userData: string): Promise<{ app: Awaited<ReturnType<typeof electron.launch>>; window: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
  })
  const window = await app.firstWindow()
  await expect(window.locator('.project-row')).toHaveCount(2)
  return { app, window }
}

/** The active pane's footer chip (the hidden draft of another project is ignored). */
function activeChip(window: Page) {
  return window.locator('.pane-slot:not([hidden]) .chat-footer-project')
}

test('the new session footer picks the project, and only before the chat starts', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const alpha = mkdtempSync(path.join(tmpdir(), 'meow-alpha-'))
  const beta = mkdtempSync(path.join(tmpdir(), 'meow-beta-'))
  try {
    seedWorkspaces(userData, [
      { path: alpha, name: 'Alpha', agents: [{ id: 'e2e-alpha', name: 'Alpha session' }] },
      { path: beta, name: 'Beta', agents: [{ id: 'e2e-beta', name: 'Beta session' }] }
    ])
    const { app, window } = await launch(userData)
    try {
      // Open Alpha and its real session: a started session has a fixed cwd.
      await window.locator('.project-row', { hasText: 'Alpha' }).locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await expect(window.locator('.session-panes')).toBeVisible()
      await expect(activeChip(window)).toHaveCount(1)
      await expect(activeChip(window).locator('.dropdown-caret')).toHaveCount(0)

      // The sidebar's "Add folder" action is gone.
      await expect(window.getByText('Add folder', { exact: true })).toHaveCount(0)

      // A new session turns the chip into a picker.
      await window.getByRole('button', { name: 'new session Alpha', exact: true }).click()
      // The draft is not a sidebar row; its name sits in the title bar, not in a pane header.
      await expect(window.locator('.title-bar-session-name')).toHaveText('New session')
      const picker = window.locator('.pane-slot:not([hidden]) button.chat-footer-project')
      await expect(picker).toBeVisible()
      await expect(picker).toHaveText(/Alpha/)

      await picker.click()
      const menu = window.locator('.base-dropdown-menu.project-switch-dropdown')
      await expect(menu).toBeVisible()
      // The picker is a menu like every other one: it must carry the shared menu
      // surface. Without it the list renders as a transparent column over the chat
      // (the composer shows through it) instead of a panel above everything.
      const surface = await menu.evaluate(el => {
        const cs = getComputedStyle(el)
        return {
          bg: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          padding: cs.paddingTop,
          border: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          shadow: cs.boxShadow
        }
      })
      const expected = await window.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.background = 'var(--bg-menu)'
        probe.style.borderTop = '1px solid var(--menu-border)'
        document.body.appendChild(probe)
        const cs = getComputedStyle(probe)
        const tokens = { bg: cs.backgroundColor, borderColor: cs.borderTopColor }
        probe.remove()
        return tokens
      })
      const chatBg = await window.locator('.pane-slot:not([hidden]) .chat-panel').evaluate(el => getComputedStyle(el).backgroundColor)
      expect(surface.bg).toBe(expected.bg)
      expect(surface.bg).not.toBe(chatBg)
      expect(surface.radius).not.toBe('0px')
      expect(surface.padding).not.toBe('0px')
      // A rim, not an outline: one faint --menu-border hairline on top of the
      // surface step + shadow. It must stay a hair fainter than --hairline.
      expect(surface.border).toBe('1px')
      expect(surface.borderColor).toBe(expected.borderColor)
      expect(surface.shadow).not.toBe('none')
      // Its bottom edge is on top: the composer must not cover the last row.
      const topmostAtBottom = await menu.evaluate(el => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2)
        return !!hit && el.contains(hit)
      })
      expect(topmostAtBottom).toBe(true)
      await expect(menu).toContainText('Alpha')
      await expect(menu).toContainText('Beta')
      await expect(menu).toContainText('Choose folder…')

      // Picking Beta starts the draft in Beta: the project becomes active and its
      // new session shows, without creating an agent (the list still has one row).
      await menu.getByText('Beta', { exact: true }).click()
      await expect(menu).toHaveCount(0)
      await expect(window.locator('.project-row', { hasText: 'Beta' }).locator('..')).toHaveClass(/active/)
      await expect(picker).toHaveText(/Beta/)
      await expect(window.locator('.session-list .session-row')).toHaveCount(1)

      // The composer "+" menu no longer offers "Add Folder".
      await window.locator('.pane-slot:not([hidden]) .add-dropdown .dropdown-trigger').click()
      await expect(window.locator('.dropdown-menu.add-menu')).toBeVisible()
      await expect(window.locator('.dropdown-menu.add-menu')).not.toContainText('Add Folder')
      await window.keyboard.press('Escape')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(alpha)
    cleanupDir(beta)
  }
})
