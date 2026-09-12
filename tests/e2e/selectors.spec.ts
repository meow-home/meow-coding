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
  // The name+chevron group now only expands the session list; opening a
  // project's panes happens by selecting one of its sessions.
  await window.locator('.project-toggle').click()
  await window.locator('.session-list .session-row').first().click()
  await expect(window.locator('.chat-panel')).toBeVisible()
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
      expect(await rotationDeg(window, '[aria-label="Mode"].dropdown-trigger .dropdown-caret')).toBe(0)
      await modeTrigger.click()
      await expect(window.locator('.mode-menu')).toBeVisible()
      await expect(modeTrigger).toHaveAttribute('aria-expanded', 'true')
      // Poll: the caret animates over 120ms, so the final angle is what matters.
      await expect.poll(() => rotationDeg(window, '[aria-label="Mode"].dropdown-trigger .dropdown-caret')).toBe(180)
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

/** Resolves a CSS variable to a concrete rgb() string for comparison. */
function resolveVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n: string) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, name)
}

test('a selected row is bg-active with a trailing tick in a reserved column', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    initRepo(project)
    seedWorkspaces(userData, project)
    const { app, window } = await launch(userData)
    try {
      await openProject(window)
      const bgActive = await resolveVar(window, '--bg-active')

      await window.getByRole('button', { name: 'Mode', exact: true }).click()
      await expect(window.locator('.mode-menu')).toBeVisible()

      // No blue left bar anywhere in this menu.
      const borderWidths = await window.locator('.mode-item').evaluateAll(
        els => els.map(e => getComputedStyle(e).borderLeftWidth)
      )
      expect(borderWidths.every(w => w === '0px')).toBe(true)

      const activeMode = window.locator('.mode-item.active')
      await expect(activeMode).toHaveCount(1)
      const activeBg = await activeMode.evaluate(e => getComputedStyle(e).backgroundColor)
      expect(activeBg).toBe(bgActive)

      // The tick is the row's LAST child (not a leading marker) and carries an icon.
      const tickIsLast = await activeMode.evaluate(
        e => e.lastElementChild?.classList.contains('menu-item-check') ?? false
      )
      expect(tickIsLast).toBe(true)
      await expect(activeMode.locator('.menu-item-check svg')).toHaveCount(1)

      // Right-aligned: the tick's right edge sits at the row's padding edge.
      const { tickRight, rowRight } = await activeMode.evaluate(e => ({
        tickRight: e.lastElementChild!.getBoundingClientRect().right,
        rowRight: e.getBoundingClientRect().right
      }))
      expect(Math.round(rowRight - tickRight)).toBe(10)

      // Reserved column: an UNSELECTED row still has a 16px check slot, so labels
      // do not shift when selection moves.
      const inactiveTick = await window.locator('.mode-item:not(.active) .menu-item-check')
        .evaluate(e => Math.round(e.getBoundingClientRect().width))
      expect(inactiveTick).toBe(16)
      await expect(window.locator('.mode-item:not(.active) .menu-item-check svg')).toHaveCount(0)

      // The label is the FIRST child — pickers have no leading action icon.
      const labelFirst = await window.locator('.mode-item').evaluateAll(
        els => els.every(e => e.firstElementChild?.classList.contains('menu-item-label'))
      )
      expect(labelFirst).toBe(true)

      // NOT COVERED HERE: the VariantPicker and the ModelPicker's rows. Both are
      // unreachable with a bare userData — the variant picker only renders when
      // availableVariants is non-empty (needs a resolved provider+model AND a
      // populated model catalog), and an unconfigured model menu renders
      // "No providers configured". Both components were changed to the exact same
      // two shared classes asserted above, in the same commit.

      // GitBranchSwitcher: popup window; its active row previously had NO background.
      const popup = app.waitForEvent('window', { timeout: 20000 })
      await window.getByRole('button', { name: 'menu E2E Project', exact: true }).click()
      await window.getByRole('button', { name: 'Git', exact: true }).click()
      const gitWindow = await popup
      await gitWindow.waitForLoadState('domcontentloaded')
      await gitWindow.locator('.git-branch-current').click()
      await expect(gitWindow.locator('.git-branch-dropdown')).toBeVisible()
      const activeBranch = gitWindow.locator('.git-branch-item.active')
      await expect(activeBranch).toHaveCount(1)
      const branchBg = await activeBranch.evaluate(e => getComputedStyle(e).backgroundColor)
      const gitBgActive = await resolveVar(gitWindow, '--bg-active')
      expect(branchBg).toBe(gitBgActive)
      await expect(activeBranch.locator('.menu-item-check svg')).toHaveCount(1)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})

/**
 * The ModelPicker's rows are reachable only with a configured provider; the
 * MEOW_E2E_MOCK_CONNECTIONS flag + connectCodex() gives it real rows to assert.
 * `.model-item` differs from the other three selector rows: it was a plain block
 * (no flex), so the shared flex-based label/check classes need it to be flex too.
 */
test('model picker ticks sit at the right edge like the other selectors', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    writeFileSync(path.join(userData, 'workspaces.json'), JSON.stringify([{
      projectPath: project,
      name: 'E2E Project',
      agents: [{ id: 'e2e-meow', name: 'meow', templateId: 'meow', cwd: project, kind: 'native' }]
    }]))

    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env as Record<string, string>,
        MEOW_USER_DATA: userData,
        MEOW_E2E_MOCK_CONNECTIONS: '1'
      }
    })
    const window = await app.firstWindow()
    try {
      await window.evaluate(() => window.api.connectCodex())
      await window.locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      // Pick a model so a row is selected, then reopen to inspect the tick.
      await window.locator('.model-trigger').click()
      await expect(window.locator('.model-group-head', { hasText: 'E2E Account' })).toBeVisible()
      await window.getByRole('button', { name: /gpt-5\.3-codex/ }).first().click()
      await window.locator('.model-trigger').click()

      const activeRow = window.locator('.model-item.active').first()
      await expect(activeRow).toHaveCount(1)

      // Same idiom as the other selectors: [label][tick], tick flush right.
      const labelFirst = await activeRow.evaluate(
        e => e.firstElementChild?.classList.contains('menu-item-label') ?? false
      )
      expect(labelFirst).toBe(true)
      const { tickRight, rowRight } = await activeRow.evaluate(e => ({
        tickRight: e.lastElementChild!.getBoundingClientRect().right,
        rowRight: e.getBoundingClientRect().right
      }))
      expect(Math.round(rowRight - tickRight)).toBe(10)
      await expect(activeRow.locator('.menu-item-check svg')).toHaveCount(1)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
  }
})
