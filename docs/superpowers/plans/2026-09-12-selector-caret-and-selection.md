# Selector Caret & Selection Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four selectors' `▾` text glyph with one shared lucide `ChevronDown` that rotates 180° while its menu is open, and move the selected-row marker from a blue 2px left border to a lucide `Check` pinned right in a reserved 16px column.

**Architecture:** `Dropdown.tsx` — the shared base `ModePicker` and `VariantPicker` are built on — renders the caret itself and already exposes `aria-expanded`, so rotation is pure CSS off that attribute and no component holds open-state for the caret. `ModelPicker` and `GitBranchSwitcher` render their own triggers and gain `aria-expanded`/`aria-haspopup` to join the same mechanism. Selection is marked by two shared classes, `.menu-item-label` (grows, ellipsizes) and `.menu-item-check` (fixed 16px, trailing), rendered on every row so labels never shift.

**Tech Stack:** Electron 41 + electron-vite 5 + React 19 + TypeScript (strict), plain CSS in `src/renderer/src/styles.css`, Vitest (unit), Playwright (`_electron`) for e2e. Icons: `lucide-react@1.33.0` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-12-selector-caret-and-selection-design.md`

## Global Constraints

- Source, UI labels and all docs are **English**.
- Commit messages must **NOT** include a `Co-Authored-By` trailer.
- `styles.css` is the single stylesheet; use the `:root` CSS variables. No new color literals.
- **Do not touch `--menu-icon`'s meaning** — it stays the icon column width; this plan *reuses* it as the trailing tick width.
- **Do not restyle the menu containers** (`.dropdown-menu`, `.mode-menu`, `.model-menu`, `.git-branch-dropdown`) — their metrics were settled in `docs/superpowers/specs/2026-09-12-menu-visual-language-design.md`.
- **Out of scope:** `.command-item.selected` and `.settings-nav-item` keep their blue left bar; the settings `<select>` elements stay native.
- Item icons/ticks must be `aria-hidden="true"`; existing suites locate items by role + name.
- `npm run typecheck` and `npm test` must pass; e2e requires `npm run build` first.
- `styles.css` is CRLF; edit it with python if the edit tool fails to match (see `src/renderer/AGENTS.md`).

---

## File Structure

**Modify:**

- `src/renderer/src/components/chat/Dropdown.tsx` — render the shared caret as the trigger's last child; import `ChevronDown`.
- `src/renderer/src/components/chat/ModePicker.tsx` — delete its `▾` span; put the tick in a trailing `.menu-item-check`.
- `src/renderer/src/components/chat/VariantPicker.tsx` — same.
- `src/renderer/src/components/chat/ModelPicker.tsx` — replace the `▾` span with the shared caret; add `aria-expanded`/`aria-haspopup`; add label + tick to its items.
- `src/renderer/src/components/git/GitBranchSwitcher.tsx` — caret to `size={14} className="dropdown-caret"`; `aria-expanded`/`aria-haspopup`; rows restructured to label + shared tick.
- `src/renderer/src/styles.css` — add `.dropdown-caret` (+ rotation), `.menu-item-label`, `.menu-item-check`; remove `border-left` from the selector items and their `.active` rules; delete `.mode-caret`/`.variant-caret`/`.model-caret`/`.mode-check`/`.variant-check`/`.git-branch-check`; give `.git-branch-item.active` a background.
- `tests/e2e/menus.spec.ts` — narrow the "pickers are icon-free" assertion (see Task 2 Step 6).
- `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md` — docs sync.

**Create:**

- `tests/e2e/selectors.spec.ts` — caret rotation, tick position, reserved column.

**Two tasks**, split where a reviewer could accept the caret while rejecting the selection change: Task 1 is the trigger caret (all four selectors), Task 2 is the selected-row marker.

**Known harness note (affects Task 2 only):** `GitBranchSwitcher` lives in a separate popup `BrowserWindow` (`http://localhost:1305/?git=<projectPath>`). It **is** reachable — verified: `app.waitForEvent('window')` after clicking the project menu's `Git` item yields the window, where `.git-branch-current` exists and `.git-branch-dropdown` / `.git-branch-item` render. The seed project must be a real git repo with a commit, or the switcher renders no local branch.

---

### Task 1: One shared caret that rotates while open

**Files:**
- Modify: `src/renderer/src/components/chat/Dropdown.tsx`, `ModePicker.tsx`, `VariantPicker.tsx`, `ModelPicker.tsx`, `src/renderer/src/components/git/GitBranchSwitcher.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/e2e/selectors.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS class `.dropdown-caret` and the convention that a selector trigger sets `aria-expanded={open}` and contains an element with that class. Task 2 does not depend on this.

- [ ] **Step 1: Write the failing caret test**

Create `tests/e2e/selectors.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/selectors.spec.ts`
Expected: FAIL on the first assertion — no `svg.dropdown-caret` exists yet (the triggers render a `▾` text glyph; GitBranchSwitcher's `<ChevronDown>` has no `dropdown-caret` class).

- [ ] **Step 3: Add the caret CSS**

In `src/renderer/src/styles.css`, insert directly before the `.variant-menu { min-width: 140px; }` line:

```css
/* The one trigger caret for every selector. Rotation is driven by aria-expanded
   (set by Dropdown.tsx and by the standalone ModelPicker / GitBranchSwitcher
   triggers) so no component tracks open-state for the caret. */
.dropdown-caret {
  color: var(--text-dim); flex: 0 0 auto;
  transition: transform 120ms ease;
}
[aria-expanded="true"] .dropdown-caret { transform: rotate(180deg); }
```

- [ ] **Step 4: Render the caret in the shared base**

In `src/renderer/src/components/chat/Dropdown.tsx`, add the import:

```tsx
import { ChevronDown } from 'lucide-react'
```

and replace:

```tsx
        aria-expanded={open}
        onClick={onToggle}
      >
        {trigger}
      </button>
```

with:

```tsx
        aria-expanded={open}
        onClick={onToggle}
      >
        {trigger}
        <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
      </button>
```

- [ ] **Step 5: Delete the duplicated glyphs**

In `ModePicker.tsx`, replace:

```tsx
      trigger={
        <>
          <span className={`mode-label mode-${active.value}`}>{active.label}</span>
          <span className="mode-caret">▾</span>
        </>
      }
```

with:

```tsx
      trigger={
        <span className={`mode-label mode-${active.value}`}>{active.label}</span>
      }
```

In `VariantPicker.tsx`, replace:

```tsx
      trigger={
        <>
          <span className="variant-label">{value || 'Default'}</span>
          <span className="variant-caret">▾</span>
        </>
      }
```

with:

```tsx
      trigger={
        <span className="variant-label">{value || 'Default'}</span>
      }
```

- [ ] **Step 6: Bring ModelPicker's trigger in line**

In `src/renderer/src/components/chat/ModelPicker.tsx`, add the import:

```tsx
import { ChevronDown } from 'lucide-react'
```

and replace:

```tsx
      <button
        className="model-trigger"
        title="Switch model"
        onClick={() => { refresh(); setSearch(''); setOpen(v => !v) }}
      >
        <span className="model-label">{label}</span>
        <span className="model-caret">▾</span>
      </button>
```

with:

```tsx
      <button
        className="model-trigger"
        title="Switch model"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { refresh(); setSearch(''); setOpen(v => !v) }}
      >
        <span className="model-label">{label}</span>
        <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
      </button>
```

- [ ] **Step 7: Bring GitBranchSwitcher's trigger in line**

In `src/renderer/src/components/git/GitBranchSwitcher.tsx`, replace:

```tsx
      <button
        className="git-branch-current"
        disabled={busy}
        onClick={() => setOpen(v => !v)}
        title="Switch branch"
      >
        <GitBranch size={14} aria-hidden="true" />
        <span>{current ?? '(detached)'}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
```

with:

```tsx
      <button
        className="git-branch-current"
        disabled={busy}
        onClick={() => setOpen(v => !v)}
        title="Switch branch"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <GitBranch size={14} aria-hidden="true" />
        <span>{current ?? '(detached)'}</span>
        <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
      </button>
```

- [ ] **Step 8: Delete the three caret classes**

In `src/renderer/src/styles.css`, delete these three rules entirely (they are now unused):

```css
.variant-caret { color: var(--text-dim); font-size: var(--fs-sm); }
```
```css
.model-caret { color: var(--text-dim); font-size: var(--fs-sm); }
```
```css
.mode-caret { color: var(--text-dim); font-size: var(--fs-sm); }
```

- [ ] **Step 9: Run the caret test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/selectors.spec.ts`
Expected: PASS.

- [ ] **Step 10: Run the affected suites and static checks**

Run: `npx playwright test tests/e2e/menus.spec.ts tests/e2e/sidebar-sessions.spec.ts tests/e2e/prompt.spec.ts`
then `npm run typecheck && npm test`
Expected: all pass. `prompt.spec.ts` exercises the composer footer (mode/model pickers) and is the regression gate for the trigger changes.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/chat/Dropdown.tsx src/renderer/src/components/chat/ModePicker.tsx src/renderer/src/components/chat/VariantPicker.tsx src/renderer/src/components/chat/ModelPicker.tsx src/renderer/src/components/git/GitBranchSwitcher.tsx tests/e2e/selectors.spec.ts
git commit -m "feat(ui): one shared selector caret that rotates while open"
```

---

### Task 2: Selection tick on the right, no blue left border

**Files:**
- Modify: `src/renderer/src/styles.css`, `ModePicker.tsx`, `VariantPicker.tsx`, `ModelPicker.tsx`, `src/renderer/src/components/git/GitBranchSwitcher.tsx`
- Modify: `tests/e2e/menus.spec.ts` (narrow the icon-free assertion)
- Test: `tests/e2e/selectors.spec.ts` (extend)
- Docs: `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md`

**Interfaces:**
- Consumes: `.dropdown-caret` from Task 1 (its test file gains cases here).
- Produces: `.menu-item-label` (grow + ellipsize) and `.menu-item-check` (fixed `var(--menu-icon)` wide, trailing, accent) — the shared selected-row idiom.

- [ ] **Step 1: Extend the test with the selection assertions**

Append to `tests/e2e/selectors.spec.ts`:

```ts
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

      // VariantPicker: same idiom.
      await window.keyboard.press('Escape')
      await window.getByRole('button', { name: 'Model effort', exact: true }).click()
      await expect(window.locator('.variant-menu')).toBeVisible()
      const activeVariant = window.locator('.variant-item.active')
      expect(await activeVariant.evaluate(e => getComputedStyle(e).borderLeftWidth)).toBe('0px')
      expect(await activeVariant.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(bgActive)
      await expect(activeVariant.locator('.menu-item-check svg')).toHaveCount(1)
      await window.keyboard.press('Escape')

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
```

**Execution deviation (discovered while running this step):** the `VariantPicker` block below is
**removed** from the test. The variant picker only renders when `availableVariants.length > 0`, which
`meow-agent-manager.allowedVariantsFor` derives from a resolved provider+model *and* a populated model
catalog — not seedable from a bare `userData`. (The original step also used the wrong trigger name; the
real accessible name is `Model effort` via `Dropdown`'s `aria-label={ariaLabel ?? title}`.) The
`ModelPicker` is likewise unasserted: a fresh `userData` has no providers, so its menu renders `No
providers configured` with no rows. Both were changed to the identical two shared classes in the same
commit; the test file carries an explicit "NOT COVERED HERE" note so the gap is visible rather than
silently assumed covered.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/selectors.spec.ts -g "trailing tick"`
Expected: FAIL — `.mode-item` still has `border-left-width: 2px`, and no `.menu-item-check` exists (`toHaveCount(1)` receives 0).

- [ ] **Step 3: Add the two shared classes**

In `src/renderer/src/styles.css`, insert directly after the `.menu-head` rule (in the menu section):

```css
/* Selector rows: label grows and ellipsizes, the check column is fixed-width and
   reserved on EVERY row so labels never shift when selection moves. */
.menu-item-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.menu-item-check {
  flex: 0 0 var(--menu-icon); display: inline-flex; align-items: center;
  justify-content: center; color: var(--accent);
}
```

- [ ] **Step 4: Remove the left borders and retire the old check/caret classes**

In `src/renderer/src/styles.css`:

a. Delete the trailing `border-left: 2px solid transparent;` line from `.variant-item`, `.model-item` and `.mode-item`. `.mode-item`'s becomes the new last declaration, so also remove the now-trailing `;` handling by leaving `border-radius: var(--radius);` as the final line.

b. Change the three `.active` rules to drop the border colour:

```css
.variant-item.active { background: var(--bg-active); color: var(--accent); }
```
```css
.model-item.active { background: var(--bg-active); color: var(--accent); }
```
```css
.mode-item.active { background: var(--bg-active); }
```

(Keep `.mode-item.mode-build.active` and `.mode-item.mode-plan.active` unchanged — they supply the accent/orange label colour.)

c. Move ellipsis to the label: in `.variant-item` and `.model-item`, delete
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`, and in
`.mode-item` delete `white-space: nowrap;`. `.menu-item-label` (Step 3) owns those now.

d. Delete these three now-unused rules:

```css
.variant-check { color: var(--accent); flex: 0 0 auto; }
```
```css
.mode-check { color: var(--accent); flex: 0 0 auto; }
```
```css
.git-branch-check { width: 14px; flex: 0 0 auto; display: inline-flex; }
```

e. Give the git branch's active row the same background as the other selectors:

```css
.git-branch-item.active { background: var(--bg-active); color: var(--accent); }
```

- [ ] **Step 5: Restructure the four components' rows**

**`ModePicker.tsx`** — replace the item body:

```tsx
            <span className="mode-check">{m.value === value ? '✓' : ''}</span>
            {m.label}
```

with:

```tsx
            <span className="menu-item-label">{m.label}</span>
            <span className="menu-item-check">
              {m.value === value && <Check size={16} aria-hidden="true" />}
            </span>
```

and add to its imports:

```tsx
import { Check } from 'lucide-react'
```

**`VariantPicker.tsx`** — for the Default row, replace:

```tsx
          <span className="variant-check">{value === '' ? '✓' : ''}</span>
          Default
```

with:

```tsx
          <span className="menu-item-label">Default</span>
          <span className="menu-item-check">
            {value === '' && <Check size={16} aria-hidden="true" />}
          </span>
```

and for the mapped rows, replace:

```tsx
            <span className="variant-check">{value === v ? '✓' : ''}</span>
            {v}
```

with:

```tsx
            <span className="menu-item-label">{v}</span>
            <span className="menu-item-check">
              {value === v && <Check size={16} aria-hidden="true" />}
            </span>
```

and add its import:

```tsx
import { Check } from 'lucide-react'
```

**`ModelPicker.tsx`** — replace the item body:

```tsx
                    {m.model}
```

with:

```tsx
                    <span className="menu-item-label">{m.model}</span>
                    <span className="menu-item-check">
                      {current?.provider === m.provider &&
                        current?.model === m.model &&
                        current?.accountId === m.accountId && <Check size={16} aria-hidden="true" />}
                    </span>
```

and extend its lucide import in the same line as the caret:

```tsx
import { Check, ChevronDown } from 'lucide-react'
```

**`GitBranchSwitcher.tsx`** — for the local rows, replace:

```tsx
              <span className="git-branch-check">{b.name === current ? <Check size={13} /> : null}</span>
              {b.name}
```

with:

```tsx
              <span className="menu-item-label">{b.name}</span>
              <span className="menu-item-check">
                {b.name === current && <Check size={16} aria-hidden="true" />}
              </span>
```

and for the remote rows, replace:

```tsx
              <span className="git-branch-check" />
              {b.name}
```

with:

```tsx
              <span className="menu-item-label">{b.name}</span>
              <span className="menu-item-check" />
```

`Check` is already imported in this file.

- [ ] **Step 6: Narrow the icon-free assertion in `menus.spec.ts`**

The active mode row now legitimately contains a `Check`, so this existing
assertion in `tests/e2e/menus.spec.ts` (in the test "action menus carry icons, a
divider and a path header; pickers do not") must be **narrowed, not deleted** —
the split it guards is about *leading* action icons:

```ts
      await expect(modeMenu.locator('svg')).toHaveCount(0)
```

replace with:

```ts
      // The split this guards is about LEADING action icons: a picker row is
      // [label][trailing selection tick], never [icon][label].
      const labelFirst = await modeMenu.locator('.mode-item').evaluateAll(
        els => els.every(e => e.firstElementChild?.classList.contains('menu-item-label'))
      )
      expect(labelFirst).toBe(true)
      await expect(modeMenu.locator('.menu-sep')).toHaveCount(0)
```

(The `.menu-sep` count is 0 in this menu already; it is kept as the separator half of the original intent.)

- [ ] **Step 7: Run the selector tests to verify they pass**

Run: `npm run build && npx playwright test tests/e2e/selectors.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Run the full e2e suite and the static checks**

Run: `npm run e2e`
Expected: PASS except the four **pre-existing** failures unrelated to this work
(`chat-scrollbar.spec.ts`, both `context-footer.spec.ts` tests, and `smoke.spec.ts`
"settings opens below the title bar"). Confirm the count is 4 and that the names
match that list; a fifth failure is a regression from this change.

Run: `npm run typecheck && npm test`
Expected: both pass.

- [ ] **Step 9: Sync the docs**

`docs/reference/09-ui-guide.md` §9.5 Styling — after the menu metrics bullet, add:

```markdown
- **Selector triggers** carry one shared caret, `.dropdown-caret` (lucide `ChevronDown`, 14px), which
  rotates 180° while its menu is open. Rotation is driven purely by the trigger's
  `[aria-expanded="true"]`, so any new select trigger gets it by setting that attribute (`Dropdown.tsx`
  sets it; `ModelPicker` and `GitBranchSwitcher` set it on their own buttons).
- **A selected selector row** is `background: var(--bg-active)` + accent label + a trailing tick, never a
  left accent bar. Rows are `[.menu-item-label][.menu-item-check]`: the label grows and ellipsizes, the
  check column is a fixed `var(--menu-icon)` (16px) and is rendered on **every** row (empty when
  unselected) so labels do not shift when selection moves. The slash-command palette
  (`.command-item.selected`) and the settings nav (`.settings-nav-item`) are not selectors and still use
  the left-bar idiom.
```

`src/renderer/AGENTS.md` — in `## CSS — border-radius & style scope`, after the `--menu-*` bullet, add:

```markdown
- **Selector rows use `.menu-item-label` + `.menu-item-check`**, and triggers use `.dropdown-caret`.
  A selector trigger must set `aria-expanded={open}` (the caret's rotation is CSS off that attribute;
  `Dropdown.tsx` does it for `ModePicker`/`VariantPicker`, the other two set it themselves). The check
  column is fixed-width and present on unselected rows too — dropping it there makes labels shift.
```

`tests/e2e/AGENTS.md` — add a row to the key-files table:

```markdown
| `selectors.spec.ts` | Selector triggers and rows: the shared `.dropdown-caret` and its `aria-expanded`-driven rotation (`matrix(-1, 0, 0, -1, 0, 0)` while open); a selected row is `--bg-active` with `border-left-width: 0` and a right-aligned `.menu-item-check` (10px from the row edge, 16px wide, reserved on unselected rows). Also covers `GitBranchSwitcher` in its popup window, which needs a real git repo seeded. |
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/chat/ModePicker.tsx src/renderer/src/components/chat/VariantPicker.tsx src/renderer/src/components/chat/ModelPicker.tsx src/renderer/src/components/git/GitBranchSwitcher.tsx tests/e2e/selectors.spec.ts tests/e2e/menus.spec.ts docs/reference/09-ui-guide.md src/renderer/AGENTS.md tests/e2e/AGENTS.md
git commit -m "feat(ui): move selector selection to a trailing tick"
```

---

## Self-Review

**Spec coverage:** Goal 1 (one caret, lucide, rotating) → Task 1 Steps 3-8. Goal 2 (tick not left bar) → Task 2 Steps 3-5. Goal 3 (all four identical) → Task 2 Step 5 touches all four components, including ModelPicker's missing tick and GitBranchSwitcher's missing background. Goal 4 (labels never shift) → Task 2 Step 3's `flex: 0 0 var(--menu-icon)` + Step 1's unselected-row-width assertion. Goal 5 (10px inset) → Task 2 Step 4a/4c (border removed, ellipsis moved) and the `rowRight - tickRight === 10` assertion. Non-goals → Global Constraints name `.command-item`, `.settings-nav-item` and the native selects as untouched. The spec's "Testing" list maps 1:1 onto Task 1 Step 1 and Task 2 Step 1, including the deliberate narrowing of `menus.spec.ts` (Task 2 Step 6).

**Placeholder scan:** no `TBD` / `handle edge cases` / `similar to Task N`; every step carries literal before/after code or the exact rule to delete. Task 2 Step 4 is the one step that describes edits rather than quoting whole rules (the four item rules are long and mostly unchanged); it names each rule, the exact declarations to delete, and the replacement text for every rule it rewrites.

**Type consistency:** `.dropdown-caret` (Task 1 Step 3) is asserted in both test files; `.menu-item-label` / `.menu-item-check` (Task 2 Step 3) are the only two names used in Task 2's components and assertions; `--menu-icon` is reused, never redefined, and the test's hardcoded `16` matches its value (declared in the menu plan). `resolveVar` and `initRepo` are defined in Task 1's spec file and reused by Task 2's appended test — same file, so no cross-file import.
