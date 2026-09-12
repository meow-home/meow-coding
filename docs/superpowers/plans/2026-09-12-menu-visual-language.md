# Menu Visual Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dropdown in the app shares one metric set — 32px contiguous rows, 6px item radius, 10px container radius, 6px container padding, 14px labels — while the 5 action menus additionally gain a 16px icon column, hairline group dividers and (for the project menu) a muted path header.

**Architecture:** Five CSS variables (`--menu-radius`, `--menu-pad`, `--menu-item-h`, `--menu-item-pad-x`, `--menu-icon`) are declared once in `:root` and consumed by the container rules and the four-class item family. The icon column is markup, added per item in the 5 action-menu components. The pickers get metrics only.

**Tech Stack:** Electron 41 + electron-vite 5 + React 19 + TypeScript (strict), plain CSS in `src/renderer/src/styles.css`, Vitest (unit), Playwright (`_electron`) for e2e. Icons: `lucide-react@1.33.0` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-12-menu-visual-language-design.md`

## Global Constraints

- Source, UI labels and all docs are **English**.
- Commit messages must **NOT** include a `Co-Authored-By` trailer.
- `styles.css` is the single stylesheet; use CSS variables from `:root`. No new color literals.
- **Do not touch `.command-item`** — it stacks a name + description and would clip at 32px.
- **Do not add icons or separators to the pickers** (mode, variant, model, git branch). That split is deliberate and is pinned by a test in Task 4.
- Menu item icons must carry `aria-hidden="true"` and must not introduce an accessible name — existing tests locate items by role + name.
- `npm run typecheck` and `npm test` must pass; e2e requires `npm run build` first.
- `styles.css` is CRLF; edit it with python if the edit tool fails to match (see `src/renderer/AGENTS.md`).

---

## File Structure

**Modify:**

- `src/renderer/src/styles.css` — `--menu-*` tokens in the `:root` misc block (line 63-68); container rules `.dropdown-menu` (1299), `.model-menu` (1323), `.sidebar-menu-dropdown` (1422), `.right-panel-menu` (1602), `.git-branch-dropdown` (1699), `.command-menu`; item family `.menu-item` (1429), `.variant-item` (1310), `.model-item` (1348), `.mode-item`, `.git-branch-item`; new `.menu-sep` / `.menu-head`; width bumps.
- `src/renderer/src/components/Sidebar.tsx` — project menu header + icons + sep; session menu icons + sep; footer icons (already present); `MENU_WIDTH` constant replacing two `const width = 160` literals.
- `src/renderer/src/components/PaneHeader.tsx` — pane menu icons + sep.
- `src/renderer/src/components/FileContextMenu.tsx` — 2 icons.
- `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md` — docs sync.

**Create:**

- `tests/e2e/menus.spec.ts` — the geometry/structure assertions.

**Two tasks**, because a reviewer could accept the shared metric set while rejecting the icon/dividers markup: Task 1 is the metric unification (all 9 surfaces, no markup), Task 2 is the action-menu structure.

---

### Task 1: Unify the menu metrics

**Files:**
- Modify: `src/renderer/src/styles.css`
- Test: `tests/e2e/menus.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `--menu-radius` 10px, `--menu-pad` 6px, `--menu-item-h` 32px, `--menu-item-pad-x` 10px, `--menu-icon` 16px; and the `.menu-sep` / `.menu-head` classes that Task 2 renders.

- [ ] **Step 1: Write the failing metrics test**

Create `tests/e2e/menus.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/menus.spec.ts`
Expected: FAIL — rows measure 35 and 32 (`Expected: 32, Received: 35`), padding is `8px 12px`, container radius is `6px`.

- [ ] **Step 3: Add the tokens**

In `src/renderer/src/styles.css`, replace:

```css
  /* misc */
  --radius-xs: 3px;
```

with:

```css
  /* misc */
  --radius-xs: 3px;
```

and extend the same block (after `--radius-lg: 8px;`) with:

```css
  /* menu metrics — one set for every dropdown in the app; see docs/reference/09-ui-guide.md */
  --menu-radius: 10px;
  --menu-pad: 6px;
  --menu-item-h: 32px;
  --menu-item-pad-x: 10px;
  --menu-icon: 16px;
```

- [ ] **Step 4: Add the separator + header classes**

In `src/renderer/src/styles.css`, insert directly after the `.menu-item:hover` rule:

```css
/* Inset hairline between menu groups (inset like the reference, not edge to edge). */
.menu-sep { height: 1px; background: var(--hairline); margin: 4px 6px; flex: 0 0 auto; }
/* Non-interactive muted context row (e.g. the project's path). */
.menu-head {
  padding: 4px 10px 6px; color: var(--text-faint); font-size: var(--fs-base);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 auto;
}
```

- [ ] **Step 5: Unify the item family**

In `src/renderer/src/styles.css`, replace the `.menu-item` rule with:

```css
/* One metric set for every menu row — see --menu-* tokens. */
.menu-item {
  text-align: left; display: flex; align-items: center; gap: 8px;
  min-height: var(--menu-item-h); padding: 0 var(--menu-item-pad-x);
  border: none; background: transparent; color: var(--text);
  cursor: pointer; font-size: var(--fs-md); border-radius: var(--radius);
}
```

Then apply the same height/padding/radius/alignment to `.variant-item` and
`.model-item` (currently `padding: 7px 12px; border-radius: var(--radius-sm)`)
and to `.mode-item` and `.git-branch-item` (`padding: 7px 12px` / `5px 8px`).
Replace each `padding: 7px 12px;` / `padding: 5px 8px;` with
`min-height: var(--menu-item-h); padding: 0 var(--menu-item-pad-x);`, and each
`border-radius: var(--radius-sm);` on those four rules with
`border-radius: var(--radius);`. Keep `font-family: var(--font-mono)` on
`.variant-item`, `.model-item` and `.git-branch-item` — that is content-driven,
not a metric.

- [ ] **Step 6: Unify the containers**

For each of `.dropdown-menu`, `.model-menu`, `.sidebar-menu-dropdown`,
`.right-panel-menu`, `.git-branch-dropdown` and `.command-menu`: replace
`border-radius: var(--radius);` with `border-radius: var(--menu-radius);`,
replace `padding: 4px;` / `padding: 6px;` with `padding: var(--menu-pad);`, and
replace `gap: 2px;` / `gap: 4px;` with `gap: 0;`.

Also set `gap: 0` on the inner lists `.variant-list`, `.mode-list`,
`.model-list`, `.model-group` so contiguity holds inside the pickers.

- [ ] **Step 7: Widen the menus**

In `src/renderer/src/styles.css`: `.project-menu-dropdown` `150px` → `200px`;
`.sidebar-menu-dropdown` base `min-width: 120px` → `170px`; add
`min-width: 200px;` to `.sidebar-footer-dropdown`; `.pane-menu-dropdown`
`130px` → `180px`; `.right-panel-menu` `170px` → `210px`.

- [ ] **Step 8: Keep the positioned menus aligned**

In `src/renderer/src/components/Sidebar.tsx`, add above the component:

```ts
// Must match the .project-menu-dropdown / .sidebar-footer-dropdown CSS min-width;
// these menus are positioned from the trigger's rect and clamp to this width.
const MENU_WIDTH = 200
```

and replace **both** occurrences of:

```ts
            const width = 160
```

with:

```ts
            const width = MENU_WIDTH
```

- [ ] **Step 9: Run the metrics test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/menus.spec.ts`
Expected: PASS.

- [ ] **Step 10: Run the existing suites**

Run: `npx playwright test tests/e2e/sidebar-sessions.spec.ts` then `npm run typecheck && npm test`
Expected: all pass. The sidebar suite clicks `Rename`/`Delete` by role + name — metrics changes must not affect names (no icons added yet in this task).

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/Sidebar.tsx tests/e2e/menus.spec.ts
git commit -m "feat(ui): unify dropdown metrics (32px rows, 10px container radius)"
```

---

### Task 2: Action-menu structure — icons, dividers, path header

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/PaneHeader.tsx`, `src/renderer/src/components/FileContextMenu.tsx`
- Test: `tests/e2e/menus.spec.ts` (extend)
- Docs: `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md`

**Interfaces:**
- Consumes: `.menu-sep`, `.menu-head`, `--menu-icon` from Task 1.
- Produces: nothing that later tasks consume.

- [ ] **Step 1: Extend the test with the structure assertions**

Append to `tests/e2e/menus.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/menus.spec.ts -g "action menus carry"`
Expected: FAIL — `Expected: 6, Received: 0` on `.menu-item svg` (only the Git row has an icon today), and no `.menu-sep` / `.menu-head`.

- [ ] **Step 3: Extend the Sidebar icon imports**

In `src/renderer/src/components/Sidebar.tsx`, replace the lucide import with:

```tsx
import {
  ChevronDown, ChevronRight, Code, FolderOpen, FolderSymlink, GitBranch, Moon, MoreVertical,
  PanelLeft, Pencil, Play, Plus, RefreshCw, Server, Settings, Square, Sun, Terminal, Trash2, X
} from 'lucide-react'
```

- [ ] **Step 4: Project menu — header, icons, divider**

In `src/renderer/src/components/Sidebar.tsx`, replace the project menu's six
`<button className="menu-item" …>` bodies so the container opens with the header
and each item leads with a 16px icon. The full replacement block:

```tsx
                  <div
                    className="sidebar-menu-dropdown project-menu-dropdown"
                    style={{ position: 'fixed', left: projectMenuPos.x, top: projectMenuPos.y, right: 'auto', bottom: 'auto' }}
                  >
                    <span className="menu-head" title={ws.projectPath}>{ws.projectPath}</span>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpen(ws.projectPath) }}
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                      Open
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openInEditor(ws.projectPath) }}
                    >
                      <Code size={16} aria-hidden="true" />
                      Open in VS Code
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); onOpenGit(ws.projectPath) }}
                    >
                      <GitBranch size={16} aria-hidden="true" />
                      Git
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openFolder(ws.projectPath) }}
                    >
                      <FolderSymlink size={16} aria-hidden="true" />
                      Open Folder
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => { setOpenProjectMenu(null); void window.api.openSystemTerminal(ws.projectPath) }}
                    >
                      <Terminal size={16} aria-hidden="true" />
                      Open Terminal
                    </button>
                    <div className="menu-sep" aria-hidden="true" />
                    <button
                      className="menu-item danger"
                      onClick={() => { setOpenProjectMenu(null); onRemove(ws.projectPath) }}
                    >
                      <X size={16} aria-hidden="true" />
                      Remove
                    </button>
                  </div>,
```

- [ ] **Step 5: Session row menu — icons + divider**

In `SessionRowMenu`, replace its three buttons with (the session menu has **no**
`.menu-head` — a session's context is already its own row, per the spec table):

```tsx
          <button className="menu-item" onClick={() => { setOpen(false); setRenaming(true) }}>
            <Pencil size={16} aria-hidden="true" />
            Rename
          </button>
          {running && (
            <button className="menu-item" onClick={() => { setOpen(false); onStop() }}>
              <Square size={16} aria-hidden="true" />
              Stop
            </button>
          )}
          <div className="menu-sep" aria-hidden="true" />
          <button className="menu-item danger" onClick={() => { setOpen(false); onDelete() }}>
            <Trash2 size={16} aria-hidden="true" />
            Delete
          </button>
```

- [ ] **Step 6: Footer menu — resize the existing icons**

In `src/renderer/src/components/Sidebar.tsx`, change the three footer menu icons
from `size={14}` to `size={16}` (the `Settings`, `Server` and `Sun`/`Moon` icons).
They already exist; only the size changes, for a consistent icon column.

- [ ] **Step 7: Pane header menu — icons + divider**

In `src/renderer/src/components/PaneHeader.tsx`, extend the lucide import with
`FileText`, `Layers`, `Play`, `RotateCw`, `Square`, `Trash2`, then add a 16px icon
to each menu item and a `<div className="menu-sep" aria-hidden="true" />` before
the `Delete session` item, matching the table:

| item | icon |
|---|---|
| Inject | `Play` |
| Log | `FileText` |
| Stop | `Square` |
| Restart | `RotateCw` |
| Run in background / Open pane | `Layers` |
| Delete session | `Trash2` |

- [ ] **Step 8: File context menu — icons**

In `src/renderer/src/components/FileContextMenu.tsx`, import
`{ ArrowUpRight, Code }` from `lucide-react` and add `<Code size={16} aria-hidden="true" />`
to `Open in VS Code` and `<ArrowUpRight size={16} aria-hidden="true" />` to
`Reveal in Folder`.

- [ ] **Step 9: Run the structure test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/menus.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 10: Run the full e2e suite and the static checks**

Run: `npm run e2e`
Expected: PASS — this is the real regression gate for the added icons: the other
suites click menu items by accessible name (`Rename`, `Delete`, `Stop`), which
must be unchanged because the icons are `aria-hidden`.

Run: `npm run typecheck && npm test`
Expected: both pass.

- [ ] **Step 11: Sync the docs**

`docs/reference/09-ui-guide.md` §9.5 Styling — after the radii bullet, add:

```markdown
- Menus share one metric set (tokens in `:root`): `--menu-radius` 10px (container corner),
  `--menu-pad` 6px (container padding), `--menu-item-h` 32px, `--menu-item-pad-x` 10px,
  `--menu-icon` 16px. Rows are **contiguous** (`gap: 0`) and each is `min-height: 32px` with
  `padding: 0 10px`. `.menu-sep` is an inset hairline between groups; `.menu-head` is a muted
  non-interactive context row.
- **Action menus get icons and dividers; pickers get metrics only.** The action menus (project,
  session row, sidebar footer, pane header, right-panel file context) lead every item with a 16px
  lucide icon and separate groups with `.menu-sep`. The pickers (mode, variant, model, git branch)
  take the shared metrics but deliberately have no icons or dividers: the model picker is a
  searchable, sectioned list where an icon column is noise. `.command-item` is excluded from the
  family — it stacks a name + description and would clip at 32px.
```

`src/renderer/AGENTS.md` — in `## CSS — border-radius & style scope`, after the
`.sidebar-icon-btn` bullet, add:

```markdown
- **Dropdowns share the `--menu-*` metric tokens** (`--menu-radius`, `--menu-pad`, `--menu-item-h`,
  `--menu-item-pad-x`, `--menu-icon`). New menu surfaces must consume them, not hardcode padding.
  Action menus (project / session / footer / pane / file context) carry a 16px `aria-hidden` icon per
  item plus `.menu-sep` dividers; pickers stay icon-free by design. `Sidebar.tsx`'s `MENU_WIDTH`
  constant must stay in sync with the `.project-menu-dropdown` / `.sidebar-footer-dropdown` CSS
  `min-width` — those menus are positioned from the trigger rect and clamp to it.
```

`tests/e2e/AGENTS.md` — add a row to the key-files table:

```markdown
| `menus.spec.ts` | Dropdown menu visual language: shared metric set (32px rows, 10px container radius, `gap: 0`) across a sidebar menu and a picker; action menus carry 16px icons, `.menu-sep` dividers and the project path header; pickers are asserted icon-free and separator-free. |
```

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/Sidebar.tsx src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/FileContextMenu.tsx tests/e2e/menus.spec.ts docs/reference/09-ui-guide.md src/renderer/AGENTS.md tests/e2e/AGENTS.md
git commit -m "feat(ui): give action menus an icon column, group dividers and a path header"
```

---

## Self-Review

**Spec coverage:** Goals 1-2 → Task 1 (tokens, contiguous rows, widths). Goal 3 → Task 2 (icons, dividers, header). Goal 4 → Task 1 Step 5's `min-height: 32px` (2.29× at 14px, below the reference's ~2.4×). Non-goals → `.command-item` excluded in the Global Constraints and asserted indirectly by the mode-picker icon-free check; picker selection affordances untouched; no `.menu-hint` anywhere (spec drops it as unused). Every spec table row has a step: the 5 action menus → Task 2 Steps 4-8; the 4 pickers → Task 1 Step 5.

**Placeholder scan:** no `TBD` / `handle edge cases` / `similar to Task N`. Every
step carries its literal before/after text or the exact selector set to change.
Task 2 Step 5's session-menu block is a single unambiguous code snippet.

**Type consistency:** `MENU_WIDTH` (module scope, `Sidebar.tsx`) is introduced in
Task 1 Step 8 and referenced in the docs step; `--menu-icon` is declared in Task 1
Step 3 and consumed by Task 2's `size={16}` icons — the CSS variable documents the
column width, the `size` prop is the actual render size, and both are 16.
