# Sidebar Icon-Button Geometry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar's icon-only buttons (`+`, project `...`, session `...`) fixed 24 × 24 squares with a 3px corner radius instead of 34 × 25 / 19 × 20 rectangles with a 6px radius.

**Architecture:** One dedicated CSS class (`.sidebar-icon-btn`) owns the geometry of every icon-only button in the sidebar, instead of composing `.btn ghost small` and then trying to override it from a container rule. The buttons stop competing with `.btn.small` in the cascade, so their box no longer depends on source order.

**Tech Stack:** Electron 41 + electron-vite 5 + React 19 + TypeScript (strict), plain CSS in `src/renderer/src/styles.css`, Vitest (unit), Playwright (`_electron`) for e2e.

**Spec:** `docs/superpowers/specs/2026-09-12-sidebar-icon-button-geometry-design.md`

## Global Constraints

- Source, UI labels, and all docs are **English**.
- Commit messages must **NOT** include a `Co-Authored-By` trailer.
- `styles.css` is the single stylesheet; colors/sizes go through the CSS variables in `:root`. No new color literals.
- Do not touch `.btn` / `.btn.small` — other screens ("Add Project", "Check update") depend on them.
- Out of scope, leave unchanged: the expand chevron (`.project-expand`), the sidebar collapse toggle (`.sidebar-toggle`), the footer `Menu` button, `PaneHeader`'s `...` button and its `.btn-icon` wrapper, the title bar.
- `npm run typecheck` and `npm test` must pass before the commit; e2e requires `npm run build` first.
- Update `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md`, and `docs/reference/09-ui-guide.md` in the same commit as the code change.

---

## File Structure

**Modify:**

- `src/renderer/src/styles.css` — add the `--radius-xs` token (line 64-67 block), add `.sidebar-icon-btn` after the `.btn-icon` rule (line 362-366), rewire `.project-actions .btn` (line 325-326) and `.session-menu .btn` (line 1456-1458).
- `src/renderer/src/components/Sidebar.tsx` — three `className="btn ghost small"` → `"sidebar-icon-btn"` (lines 208, 216, 410); drop the now-redundant `<span className="btn-icon">` wrapper at line 229.
- `docs/reference/09-ui-guide.md` — §9.5 Styling: the radius scale + the icon-button pattern and the specificity trap that caused this bug.
- `src/renderer/AGENTS.md` — CSS section: the `.sidebar-icon-btn` rule and the `.btn.small` tie trap.
- `tests/e2e/AGENTS.md` — `sidebar-sessions.spec.ts` row: note the geometry assertion.

**Test:**

- `tests/e2e/sidebar-sessions.spec.ts` — new geometry test appended at the end (reuses the existing `seedWorkspaces` / `launch` / `openProject` / `cleanupDir` helpers).

---

### Task 1: Square 24 × 24 sidebar icon buttons

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `tests/e2e/sidebar-sessions.spec.ts` (append)
- Docs: `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md`, `tests/e2e/AGENTS.md`

**Interfaces:**
- Consumes: the existing e2e helpers in `tests/e2e/sidebar-sessions.spec.ts` — `seedWorkspaces(userData, project, sessionNames)`, `launch(userData): Promise<{ app, window }>`, `openProject(window)`, `cleanupDir(dir)`. The project row's buttons are addressable by their `aria-label`: `new session E2E Project` and `menu E2E Project`; the session row's by `Session menu`.
- Produces: the CSS class `.sidebar-icon-btn` (24 × 24, `padding: 0`, `border-radius: var(--radius-xs)`) and the token `--radius-xs: 3px`. No other task consumes them.

- [ ] **Step 1: Write the failing geometry test**

Append to the end of `tests/e2e/sidebar-sessions.spec.ts`:

```ts
test('sidebar icon buttons are 24x24 squares with a 3px radius', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // Project row: the "+" (new session) and the "..." (project menu). Both are
      // revealed on hover; boundingBox() ignores opacity, but hovering keeps the
      // measurement on the state the user actually sees.
      await window.locator('.project-row').hover()
      for (const name of ['new session E2E Project', 'menu E2E Project']) {
        const btn = window.getByRole('button', { name, exact: true })
        const box = await btn.boundingBox()
        expect(box).not.toBeNull()
        expect(Math.round(box!.width)).toBe(24)
        expect(Math.round(box!.height)).toBe(24)
        await expect(btn).toHaveCSS('border-radius', '3px')
      }

      // Session row: the per-row "..." menu button.
      const row = window.locator('.session-list .session-row').first()
      await row.hover()
      const sessionMenu = row.getByRole('button', { name: 'Session menu', exact: true })
      const box = await sessionMenu.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.round(box!.width)).toBe(24)
      expect(Math.round(box!.height)).toBe(24)
      await expect(sessionMenu).toHaveCSS('border-radius', '3px')
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

Run: `npm run build && npx playwright test tests/e2e/sidebar-sessions.spec.ts -g "24x24 squares"`
Expected: FAIL — the project buttons measure `34 × 25` (`Received: 34`) and the computed radius is `6px`, not `3px`.

- [ ] **Step 3: Add the `--radius-xs` token**

In `src/renderer/src/styles.css`, replace:

```css
  /* misc */
  --radius-sm: 4px;
```

with:

```css
  /* misc */
  --radius-xs: 3px;
  --radius-sm: 4px;
```

- [ ] **Step 4: Add the `.sidebar-icon-btn` class**

In `src/renderer/src/styles.css`, insert this rule directly after the `.btn-icon { … }` rule (line 362-366) and before `.sidebar-action`:

```css
/* Icon-only button in the sidebar (project +/…, session-row …). A standalone
   class, NOT `.btn small` + a container padding override: `.btn.small` and
   `.project-actions .btn` are both (0,2,0), so source order decided and the
   override silently lost — the buttons rendered 34x25 with the .btn 6px radius. */
.sidebar-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; flex: 0 0 auto;
  line-height: 0; /* icon-only: the svg is a flex item, so no baseline descender gap */
  border: none; background: transparent; color: var(--text-faint);
  border-radius: var(--radius-xs); cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
```

- [ ] **Step 5: Rewire the project-row action buttons**

In `src/renderer/src/styles.css`, replace:

```css
.project-actions .btn { border: none; background: transparent; padding: 2px 4px; color: var(--text-faint); }
.project-actions .btn:hover { background: var(--bg-hover); color: var(--text); }
```

with:

```css
/* Border/background/padding/color come from .sidebar-icon-btn now — only the
   hover lift stays container-specific. */
.project-actions .sidebar-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
```

- [ ] **Step 6: Rewire the session-row menu button**

In `src/renderer/src/styles.css`, replace:

```css
.session-menu .btn { opacity: 0; border: none; background: transparent; padding: 2px 3px; color: var(--text-faint); transition: opacity 120ms ease; }
.session-row:hover .session-menu .btn, .session-row.active .session-menu .btn, .session-menu:focus-within .btn { opacity: 1; }
.session-menu .btn:hover { background: var(--bg-active); color: var(--text); }
```

with:

```css
/* `transition` replaces the whole property, so all three are listed — dropping
   background/color here would make the hover background snap in with no fade. */
.session-menu .sidebar-icon-btn { opacity: 0; transition: opacity 120ms ease, background 120ms ease, color 120ms ease; }
.session-row:hover .session-menu .sidebar-icon-btn, .session-row.active .session-menu .sidebar-icon-btn, .session-menu:focus-within .sidebar-icon-btn { opacity: 1; }
.session-menu .sidebar-icon-btn:hover { background: var(--bg-active); color: var(--text); }
```

- [ ] **Step 7: Swap the class on the three buttons**

In `src/renderer/src/components/Sidebar.tsx`, the project row's `+` button — replace:

```tsx
                <button
                  className="btn ghost small"
                  title="New session"
```

with:

```tsx
                <button
                  className="sidebar-icon-btn"
                  title="New session"
```

The project row's `...` button — replace:

```tsx
                <button
                  className="btn ghost small"
                  title="Project menu"
```

with:

```tsx
                <button
                  className="sidebar-icon-btn"
                  title="Project menu"
```

and drop its wrapper span, replacing:

```tsx
                  <span className="btn-icon"><MoreIcon /></span>
```

with:

```tsx
                  <MoreIcon />
```

In `SessionRowMenu`, replace:

```tsx
      <button
        className="btn ghost small"
        title="Session menu"
```

with:

```tsx
      <button
        className="sidebar-icon-btn"
        title="Session menu"
```

(`PaneHeader.tsx` keeps its `.btn-icon` wrapper — out of scope.)

- [ ] **Step 8: Run the geometry test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/sidebar-sessions.spec.ts -g "24x24 squares"`
Expected: PASS — 3 assertions of 24 × 24 plus `border-radius: 3px`.

- [ ] **Step 9: Run the full sidebar suite and the static checks**

Run: `npx playwright test tests/e2e/sidebar-sessions.spec.ts`
Expected: PASS (all tests — the `+` and `Session menu` aria-labels the other tests click are unchanged).

Run: `npm run typecheck && npm test`
Expected: both pass. `typecheck` catches a mistyped `className`; `npm test` is untouched by CSS but must stay green.

- [ ] **Step 10: Sync the docs**

`docs/reference/09-ui-guide.md` — in §9.5 Styling, after the bullet `- Spacing on a 4px scale; controls use Tailwind default sizes.`, add:

```markdown
- Radii: `--radius-xs` 3px (sidebar icon buttons), `--radius-sm` 4px, `--radius` 6px (the global
  `*` default), `--radius-lg` 8px.
```

and at the end of the `### The \`border-radius\` trap` section, after the `grep "border-radius"` sentence, add:

```markdown
**Icon-only buttons.** `.sidebar-icon-btn` (fixed 24 × 24, `--radius-xs`) is the one class for the
sidebar's icon-only buttons (project `+` / `...`, session-row `...`; `Sidebar.tsx`). Its geometry must
live on that class: composing `.btn small` and overriding the padding from a container rule does not
work — `.project-actions .btn` and `.btn.small` are both `(0,2,0)`, so source order decides, and the
override lost. The buttons rendered 34 × 25 with the `.btn` 6px radius until `.sidebar-icon-btn`
replaced them.
```

`src/renderer/AGENTS.md` — in `## CSS — border-radius & style scope`, after the "Before editing: check whether the element is being rounded by the `*` rule…" bullet, add:

```markdown
- **Icon-only buttons use `.sidebar-icon-btn`** (fixed 24 × 24, `border-radius: var(--radius-xs)` = 3px) —
  never `.btn small` with a container padding override. `.project-actions .btn` and `.btn.small` are both
  `(0,2,0)`, so source order decides and the override is silently ignored (the project `+`/`...` rendered
  34 × 25 with the `.btn` 6px radius before the dedicated class existed).
```

`tests/e2e/AGENTS.md` — extend the `sidebar-sessions.spec.ts` row with:

```markdown
also sidebar icon-button geometry (24 × 24, 3px radius).
```

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/Sidebar.tsx tests/e2e/sidebar-sessions.spec.ts docs/reference/09-ui-guide.md src/renderer/AGENTS.md tests/e2e/AGENTS.md
git commit -m "fix(sidebar): square 24x24 icon buttons with a 3px radius"
```

---

## Self-Review

**Spec coverage:** Goals 1-4 → Step 4 (square, one source of truth, no specificity guessing) and Step 3
(proportional radius). "Non-goals" → Steps 5-7 touch only `.project-actions`, `.session-menu`, and the
three icon buttons; the chevron, toggle, footer button, and `PaneHeader` are untouched. "Testing" →
Steps 1, 2, 8, 9. "Documentation" → Step 10.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to" — every step carries its literal
before/after text.

**Type consistency:** `.sidebar-icon-btn` (not `.icon-btn`, which would collide with the existing
`.btn-icon` helper and read as a typo), `--radius-xs`, and the three `aria-label`s (`new session E2E
Project`, `menu E2E Project`, `Session menu`) match the labels already used in `Sidebar.tsx` and in the
other tests of this spec file.
