# Context Readout as an Icon Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the chat composer's context readout from a bare 30 × 30 ring into a 24 × 24 icon button (3px radius, `--bg-hover` on hover) holding a 20px ring, and make its hover popover content-width so no row wraps.

**Architecture:** Geometry concerns stay where they already live: the box and hover background are CSS on `.context-ring` / `.context-footer-wrap:hover`, and only the ring's `SIZE`/`STROKE` constants move in `ContextFooter.tsx` (`R`/`C` and the SVG attributes are all derived from them, so nothing else in that file changes). The popover's wrapping is a positioning bug, not a content problem: it is an absolutely positioned box inside `.context-footer-wrap`, which is only as wide as the 24px trigger, so its `auto` width is shrink-to-fit and `min-width` decides the layout — fixed with `width: max-content` plus nowrap rows.

**Tech Stack:** Electron 41 + electron-vite 5 + React 19 + TypeScript (strict), plain CSS in `src/renderer/src/styles.css` (CSS variables only), Vitest (unit), Playwright (`_electron`) for e2e.

**Spec:** `docs/superpowers/specs/2026-09-12-context-button-design.md`

## Global Constraints

- Source, UI labels and all docs are **English**.
- Commit messages must **NOT** include a `Co-Authored-By` trailer.
- `styles.css` is the single stylesheet; colors/sizes go through the `:root` variables. **No new color literals** and **no new token**: `--radius-xs: 3px` and `--bg-hover` already exist.
- **No new dependency.** The ring stays hand-rolled SVG; do not switch to lucide for it.
- **The readout stays non-interactive.** No `onClick`, no `tabIndex`, no `aria-expanded`, no menu component. `cursor: default`, not `pointer`. The popover keeps opening on `:hover` (user decision).
- **Do not touch** `.sidebar-icon-btn`, `.btn` / `.btn.small`, the picker triggers (`ModePicker` / `ModelPicker` / `VariantPicker`), the `.chat-footer` / `.chat-footer-context` / `.chat-footer-controls` layout, or the popover's information design (`context`, `% left`, `compacting soon`, `tokens in/out`, `cost`).
- Neither task adds `max-width` to the popover: a clamp would re-wrap nowrap text or clip it.
- `src/renderer/AGENTS.md` claims `styles.css` is CRLF. Re-check before editing (`grep -c $'\r' src/renderer/src/styles.css`); if it is CRLF, edit it with python as that file instructs. Currently **LF** (verified: 0 CRLF lines), so the `edit` tool matches normally.
- `npm run typecheck` and `npm test` must pass; e2e requires `npm run build` first.
- Tasks 1 and 2 touch the same 25-line region of `styles.css` and the same e2e file. Run them **sequentially**, never as parallel subagents.

---

## Pre-flight (do not skip — this is where the work will fail)

This branch is a **shared working tree**, and it is currently mid-refactor by a parallel session. Before touching anything:

1. `git status --short` — expect **clean**.
2. `git stash list` — you will see `stash@{0}: WIP on feat/sessions-in-sidebar: 40cf048 …`. That is **someone else's in-progress work**. Do **not** `stash pop`, `stash drop`, `checkout -- .` or `clean` while it exists.
3. **A parallel session owns the sidebar refactor — never touch it.** `Sidebar.tsx`, `styles.css`,
   `prompt.spec.ts`, `smoke.spec.ts`, `selectors.spec.ts`, `sidebar-sessions.spec.ts`,
   `chat-scrollbar.spec.ts` and `menus.spec.ts` are dirty with that session's work, and it has already
   stashed and re-applied it once. Those same files carry the committed e2e specs that open a session
   with `window.locator('.project-toggle').click()` — so:
   - Before any e2e run, confirm the marker exists: `grep -c project-toggle src/renderer/src/components/Sidebar.tsx` must be ≥ 1. If it is `0`, that session has stashed its refactor again and `tests/e2e/context-footer.spec.ts` will fail **at launch, in both the new and the existing tests**, for a reason that has nothing to do with this plan.
   - If it is `0`, **do not** reimplement the sidebar, and **do not** rewrite the specs back to `.project-row` — that fights in-flight work. Write the code and tests, commit them, and report e2e verification as blocked.
   - **Commit by explicit path only** (every commit below lists its files). Never `git add -A` / `git add .` on this tree, and never `git stash`, `git checkout -- .` or `git clean` — you would destroy someone else's half-finished work.
4. `out/` may have been rebuilt by that other process (observed `out/main/index.js` at a mtime this session never produced). Always `npm run build` yourself immediately before an e2e run.

---

## File Structure

**Modify:**

- `src/renderer/src/components/chat/ContextFooter.tsx` — `SIZE` 30 → 20, `STROKE` 3 → 2.5 (lines 13-14). Nothing else.
- `src/renderer/src/styles.css` — `.context-ring` box (lines 1010-1013) + a new hover rule; `.context-footer-popover` width (lines 1022-1028) + `.context-popover-row` nowrap (line 1030).
- `tests/e2e/context-footer.spec.ts` — add a `Page` type import and the `resolveVar` helper; append two tests.
- `src/renderer/src/components/chat/AGENTS.md` — the `ContextFooter.tsx` row (line 18).
- `docs/reference/09-ui-guide.md` — component rows (lines 93, 102) and §9.5 Styling.
- `tests/e2e/AGENTS.md` — the `context-footer.spec.ts` row.

**No files are created.** Both tasks extend existing files.

---

### Task 1: The ring becomes a 24 × 24 icon button

**Files:**
- Modify: `src/renderer/src/components/chat/ContextFooter.tsx:13-14`
- Modify: `src/renderer/src/styles.css:1010-1013` (and insert a hover rule after line 1018)
- Test: `tests/e2e/context-footer.spec.ts` (append)
- Docs: `src/renderer/src/components/chat/AGENTS.md:18`, `docs/reference/09-ui-guide.md:93,102`, `docs/reference/09-ui-guide.md` §9.5

**Interfaces:**
- Consumes: nothing.
- Produces: `.context-ring` is a 24 × 24 box with `border-radius: var(--radius-xs)` (3px), transparent at rest, `var(--bg-hover)` while `.context-footer-wrap` is hovered, and its `<svg>` is 20 × 20. Also produces the e2e helper `resolveVar(page: Page, name: string): Promise<string>` (resolves a CSS variable to a computed `rgb()` string). Task 2 does not depend on either.

- [ ] **Step 1: Write the failing geometry test**

In `tests/e2e/context-footer.spec.ts`, extend the import on line 1 to bring in the `Page` type:

```ts
import { test, expect, _electron as electron, type Page } from '@playwright/test'
```

Add this helper next to the existing `seedUserData` helper:

```ts
/** Resolves a CSS variable to a concrete rgb() string, for comparing computed colours. */
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
```

Append this test at the end of the file:

```ts
test('the context readout is a 24x24 icon button with a hover background', async () => {
  const { server, port } = await startMockLlm([
    { content: 'unused', usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
    })

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      const ring = window.locator('.context-ring')
      await expect(ring).toBeVisible()

      // The box is the icon-button square (was 30x30), matching the sidebar buttons.
      const box = await ring.boundingBox()
      expect(Math.round(box!.width)).toBe(24)
      expect(Math.round(box!.height)).toBe(24)
      expect(await ring.evaluate(e => getComputedStyle(e).borderRadius)).toBe('3px')

      // The ring shrank with the box so the arc keeps its clearance inside it.
      const svg = await ring.locator('svg').boundingBox()
      expect(Math.round(svg!.width)).toBe(20)
      expect(Math.round(svg!.height)).toBe(20)

      // A readout, not a button: transparent at rest, hover lifts it, cursor stays default.
      // Move the pointer onto the ring explicitly: `locator.hover()` retargets to the
      // element's own centre and raced the pane mount, making this flaky under
      // `--repeat-each`.
      expect(await ring.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      const bgHover = await resolveVar(window, '--bg-hover')
      await window.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await expect.poll(() => ring.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(bgHover)
      await expect(ring).toHaveCSS('cursor', 'default')
      await expect(ring).toHaveCSS('cursor', 'default')
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/context-footer.spec.ts -g "24x24"`

Expected: FAIL — `expect(Math.round(box!.width)).toBe(24)` receives `30`. (If it fails earlier at `.project-toggle`, that is the pre-flight blocker, not this task: see Pre-flight step 3.)

- [ ] **Step 3: Give `.context-ring` the icon-button box**

In `src/renderer/src/styles.css`, replace:

```css
.context-ring {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; cursor: default; color: var(--accent-strong);
}
```

with:

```css
.context-ring {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; cursor: default; color: var(--accent-strong);
  border-radius: var(--radius-xs); background: transparent;
  transition: background 120ms ease;
}
```

- [ ] **Step 4: Add the hover background**

In the same file, directly after the line

```css
.context-ring.danger { color: var(--red); }
```

insert:

```css
/* Same silhouette as the sidebar icon buttons — but a readout, not a button:
   hover lifts the box, `cursor: default` and no click handler. */
.context-footer-wrap:hover .context-ring { background: var(--bg-hover); }
```

- [ ] **Step 5: Shrink the ring SVG**

In `src/renderer/src/components/chat/ContextFooter.tsx`, replace lines 13-14:

```ts
const SIZE = 30
const STROKE = 3
```

with:

```ts
const SIZE = 20
const STROKE = 2.5
```

`R`, `C`, `viewBox`, `cx`/`cy` and the `rotate()` transform all derive from `SIZE`/`STROKE`, so no other line changes. The comment above the constants ("Ring geometry — kept in sync with .context-ring in styles.css") stays true.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/context-footer.spec.ts -g "24x24"`

Expected: PASS.

- [ ] **Step 7: Run the full file and static checks**

Run: `npx playwright test tests/e2e/context-footer.spec.ts` then `npm run typecheck && npm test`

Expected: green, except the pre-flight blocker — if the other three tests fail at `.project-toggle`, record it and continue (this task's test cannot be green in that case either, so in that situation treat Step 6 as "code reviewed, e2e blocked" and say so in the commit body).

- [ ] **Step 8: Sync the docs**

`src/renderer/src/components/chat/AGENTS.md` line 18 — replace:

```
| `ContextFooter.tsx` | Context readout (only context by default); hovering shows a popover with session tokens in/out + cost. |
```

with:

```
| `ContextFooter.tsx` | Context readout — a 24 × 24 icon-button ring (20px, 2.5px stroke, `--radius-xs`, `--bg-hover` on hover). Hover-only: no click handler. Hovering shows a popover with session tokens in/out + cost. |
```

`docs/reference/09-ui-guide.md` line 102 — same wording change:

```
| `ContextFooter.tsx` | Context readout — a 24 × 24 icon-button ring; hovering shows a popover with session tokens in/out + cost. Hover-only, not clickable. |
```

`docs/reference/09-ui-guide.md` line 93 — its tail is stale (it says the readout is on the left; `ChatPanel` puts the mode on the left and the readout on the right). Replace:

```
The composer's bottom row (`chat-footer`) puts the context readout on the left and the mode/model/variant selectors on the right.
```

with:

```
The composer's bottom row (`chat-footer`) puts the mode on the left (`chat-footer-context`) and the model/variant selectors plus the context readout on the right (`chat-footer-controls`).
```

`docs/reference/09-ui-guide.md` §9.5, the radii bullet — replace:

```
- Radii: `--radius-xs` 3px (sidebar icon buttons), `--radius-sm` 4px, `--radius` 6px (the global
```

with:

```
- Radii: `--radius-xs` 3px (sidebar icon buttons, chat context readout), `--radius-sm` 4px, `--radius` 6px (the global
```

Then add this bullet at the end of the §9.5 list (after the "**Action menus get icons and dividers…**" bullet):

```
- **The chat context readout is an icon button.** `ContextFooter`'s ring sits in a 24 × 24 box with
  `--radius-xs`, transparent at rest and `--bg-hover` while `.context-footer-wrap` is hovered, holding
  a 20px SVG with a 2.5px stroke (the ratio of the original 30px / 3px ring). It shares the sidebar
  icon buttons' *look*, not their class: `.sidebar-icon-btn` is sidebar-scoped and its hover lives in
  container rules, and the readout is deliberately not clickable (`cursor: default`, no tabindex).
```

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/chat/ContextFooter.tsx src/renderer/src/styles.css tests/e2e/context-footer.spec.ts src/renderer/src/components/chat/AGENTS.md docs/reference/09-ui-guide.md
git commit -m "feat(ui): context readout as a 24x24 icon button"
```

---

### Task 2: A wider popover whose rows cannot break

**Files:**
- Modify: `src/renderer/src/styles.css:1022-1030`
- Test: `tests/e2e/context-footer.spec.ts` (append)
- Docs: `docs/reference/09-ui-guide.md` §9.5, `tests/e2e/AGENTS.md`

**Interfaces:**
- Consumes: the 24 × 24 ring from Task 1 (the same tests file and CSS region; this task's assertions assume the ring is a hover target, which Task 1 established).
- Produces: nothing other tasks depend on — the popover's final CSS.

- [ ] **Step 1: Write the failing no-wrap test**

Append this test to `tests/e2e/context-footer.spec.ts`:

```ts
test('the context popover is wider than the 200px floor and keeps its rows on one line', async () => {
  // Realistic counts (a real session's ~145k prompt tokens): with short content
  // the popover's width is decided by its min-width floor, not by the text, so
  // this fixture is what makes the 216px assertion meaningful.
  const { server, port } = await startMockLlm([
    { content: 'hi there', usage: { prompt_tokens: 145503, completion_tokens: 431, total_tokens: 145934 } }
  ])
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedUserData(userData, project, {
      provider: { mock: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, models: ['mock-model'] } },
      model: 'mock',
      maxContextTokens: 200000,
      compaction: { auto: true, buffer: 20000, keepTokens: 8000, tailTurns: 2, toolOutputMaxChars: 2000, prune: true }
    })

    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env as Record<string, string>, MEOW_USER_DATA: userData }
    })
    const window = await app.firstWindow()
    try {
      await expect(window.locator('.project-row')).toBeVisible()
      await window.locator('.project-toggle').click()
      await window.locator('.session-list .session-row').first().click()
      await expect(window.locator('.chat-panel')).toBeVisible()

      // A real turn, so the popover carries its longest rows (tokens in/out).
      await window.locator('.chat-input-field').fill('hello meow')
      await window.locator('.chat-input-field').press('Enter')
      await expect(window.locator('.chat-msg.assistant').last()).toContainText('hi there')

      const popover = window.locator('.context-footer-popover')
      const wrapBox = await window.locator('.context-footer-wrap').boundingBox()
      await window.mouse.move(wrapBox!.x + wrapBox!.width / 2, wrapBox!.y + wrapBox!.height / 2)
      await expect(popover).toBeVisible()

      // Wider than the old 200px floor, and nothing is clipped horizontally.
      // (Measured before this change: 200px exactly — the floor, not the text.)
      const metrics = await popover.evaluate(e => ({ w: e.offsetWidth, scroll: e.scrollWidth, client: e.clientWidth }))
      expect(metrics.w).toBeGreaterThanOrEqual(216)
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1)

      // Guard, not a fix: with short values the box is already content-driven and
      // does not wrap, but `width: max-content` alone stops applying the moment an
      // ancestor is clamped — so assert the rows can never break. A range over the
      // row is useless here — the row is a flex container, so each span is
      // blockified and the range reports one rect per span, not per line. Measure
      // the TEXT NODES instead: a range over a text node yields one rect per line
      // fragment, so stacked (wrapped) lines are visible. Fragments whose vertical
      // spans overlap belong to the same line (the label uses the UI font and the
      // value the mono font, so their tops differ even on one line).
      const rowLines = await window.locator('.context-popover-row').evaluateAll(rows =>
        rows.map(row => {
          const rects: DOMRect[] = []
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.nodeValue?.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(node)
            rects.push(...Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0))
          }
          rects.sort((a, b) => a.top - b.top)
          let lines = 0
          let lineBottom = -Infinity
          for (const r of rects) {
            if (r.top >= lineBottom - 1) {
              lines++
              lineBottom = r.bottom
            } else {
              lineBottom = Math.max(lineBottom, r.bottom)
            }
          }
          return lines
        })
      )
      expect(rowLines.length).toBeGreaterThan(0)
      expect(rowLines, `lines per row: ${JSON.stringify(rowLines)}`).toEqual(rowLines.map(() => 1))

      // The mechanism, stated explicitly so a later edit cannot silently undo it.
      const nowrap = await window.locator('.context-popover-row').evaluateAll(rows =>
        rows.map(row => getComputedStyle(row).whiteSpace)
      )
      expect(nowrap.every(v => v === 'nowrap')).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    cleanupDir(userData)
    cleanupDir(project)
    server.close()
  }
})

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/context-footer.spec.ts -g "wider than the 200px"`

Expected: FAIL — `expect(metrics.w).toBeGreaterThanOrEqual(216)` receives `200`. (The mechanism is NOT
the shrink-to-fit story this plan first assumed: instrumenting the built app showed `width: auto`
already resolving to the content's width — 227px for 9-digit counts, 264px for 13-digit ones — and the
`min-width` floor deciding the result only when the text is *shorter* than it. With realistic counts
(`145,503 in / 431 out`) the box is therefore exactly 200px, the old floor, and the global
`* { box-sizing: border-box }` (line 137) makes that 200px the total `offsetWidth`.)

- [ ] **Step 3: Make the popover content-width**

In `src/renderer/src/styles.css`, replace the `.context-footer-popover` rule:

```css
.context-footer-popover {
  position: absolute; bottom: calc(100% + 6px); right: 0; left: auto; z-index: 100;
  display: none; min-width: 200px; padding: 8px 10px; flex-direction: column; gap: 6px;
  background: var(--bg-raised); border: 1px solid var(--hairline); border-radius: var(--radius);
  box-shadow: var(--shadow-3); font-family: var(--font-mono); font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}
```

with:

```css
.context-footer-popover {
  position: absolute; bottom: calc(100% + 6px); right: 0; left: auto; z-index: 100;
  display: none; width: max-content; min-width: 216px; padding: 8px 10px;
  flex-direction: column; gap: 6px;
  background: var(--bg-raised); border: 1px solid var(--hairline); border-radius: var(--radius);
  box-shadow: var(--shadow-3); font-family: var(--font-mono); font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}
```

`min-width: 216px` is the change that is actually visible (the measured pre-change box with realistic counts is 200px). `width: max-content` states the content-driven intent explicitly instead of leaning on how Chromium resolves shrink-to-fit for `position: absolute; right: 0; left: auto`. No `max-width`: growth is leftward (`right: 0`, anchored at the composer's right edge), so long values stay on screen at normal window widths. With the global `* { box-sizing: border-box }` (line 137), `min-width: 216px` is a 216px *total* box, which is exactly what the test asserts.

- [ ] **Step 4: Keep the rows on one line**

In the same file, replace:

```css
.context-popover-row { display: flex; align-items: center; gap: 8px; }
```

with:

```css
.context-popover-row { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
```

`white-space: nowrap` is a **guard, not a fix**: no row wraps today (measured at every value size and window width tried) — it keeps that true if an ancestor ever clamps the box. The popover's own explanatory comment ("Hover popover: token totals, session tokens in/out + cost, shown when the user hovers the context ring…") stays as is; the `.context-popover-label` rule's `min-width: 56px` stays too (it is what keeps the label column aligned).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/context-footer.spec.ts -g "content-width"`

Expected: PASS.

- [ ] **Step 6: Run the whole file and the static checks**

Run: `npx playwright test tests/e2e/context-footer.spec.ts` then `npm run typecheck && npm test`

Expected: green (modulo the pre-flight blocker). Then run the neighbouring suites once, since the popover shares the composer with the pickers: `npx playwright test tests/e2e/prompt.spec.ts tests/e2e/menus.spec.ts`.

- [ ] **Step 7: Sync the docs**

`docs/reference/09-ui-guide.md` §9.5 — extend the "**The chat context readout is an icon button.**" bullet from Task 1 with a final sentence:

```
  Its hover popover is content-width (`width: max-content`, `min-width: 216px`, `white-space: nowrap`
  rows): absolutely positioned inside the 24px-wide `.context-footer-wrap`, an `auto` width would be
  shrink-to-fit against the trigger and wrap every row.
```

`tests/e2e/AGENTS.md` — replace the row:

```
| `context-footer.spec.ts` | Context footer shows real token usage, persists across reload, resets on new session; danger state past auto-compact threshold. |
```

with:

```
| `context-footer.spec.ts` | Context footer shows real token usage, persists across reload, resets on new session; danger state past auto-compact threshold; the readout's geometry (24 × 24 box, 3px radius, `--bg-hover` on hover) and its popover (≥216px, single-line rows). |
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/styles.css tests/e2e/context-footer.spec.ts docs/reference/09-ui-guide.md tests/e2e/AGENTS.md
git commit -m "fix(ui): keep the context popover on one line at content width"
```

---

## Self-Review

**Spec coverage:** icon-button box + 3px radius + hover background → Task 1 (Steps 3-4). Ring 30→20 / stroke 2.5 with clearance ratio → Task 1 Step 5. Popover `max-content` + floor 216 + nowrap rows → Task 2 Steps 3-4. Non-goals (no click/focus, no info-design change, no `.sidebar-icon-btn` reuse, no new token/dependency) → Global Constraints. Testing section of the spec (geometry, hover colour, popover width, single-line rows) → the two new e2e tests. Documentation section (chat `AGENTS.md`, `09-ui-guide.md` §9.5, `tests/e2e/AGENTS.md`) → Task 1 Step 8, Task 2 Step 7. No spec requirement is without a task.

**Placeholder scan:** none — every step carries the exact code, selector, command and expected result.

**Correction recorded during execution (Task 2):** the original brief reported the popover's rows
wrapping, and this plan initially explained that as shrink-to-fit against the 24px trigger, with the
`min-width` floor deciding the layout. Instrumented against the built app, that explanation is wrong —
`width: auto` already resolves to the content's width, and no value size or window width produced a
wrapped row (see the Findings section of the spec, `docs/superpowers/specs/2026-09-12-context-button-design.md`).
The work therefore ships as: a deliberate widening (floor 200px → 216px, the assertion the e2e test
genuinely gates), an explicit `width: max-content`, and `nowrap` as a guard. The reported wrap is
unaccounted for and open with the user.

**Consistency:** `SIZE`/`STROKE` appear only as 20/2.5; the radius token is `--radius-xs`, the hover colour `--bg-hover`, the popover floor `216px` (used in both the CSS and the test) — all named identically across tasks. `resolveVar` is defined in Task 1 and used only there. The e2e helper names (`startMockLlm`, `seedUserData`, `cleanupDir`) match the existing file.
