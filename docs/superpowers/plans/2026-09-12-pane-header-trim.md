# Pane Header Trim + One Shared Icon Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the pane header to the status dot and the session name, and give its `...` button the same `24 × 24` / 3px geometry as the sidebar's project-row `...` by sharing one CSS class.

**Architecture:** The button geometry moves onto a single class, `.sidebar-icon-btn` renamed to `.icon-btn` (it is no longer sidebar-scoped), and every rule that referenced the old name is retargeted in the same step so nothing is left unstyled. The header drops its two text spans, and the status the deleted word carried moves onto the status dot's accessible name so screen readers do not lose it. The `git` prop existed only to render one of those spans, so it and its data path are deleted.

**Tech Stack:** Electron 41, electron-vite 5, React 19, TypeScript (strict), plain CSS in `src/renderer/src/styles.css`, Playwright `_electron` for e2e.

**Spec:** `docs/superpowers/specs/2026-09-12-pane-header-trim-design.md`

## Global Constraints

- **One class, not two lookalikes.** The pane header button and the sidebar's `+` / `...` must carry the *same* class name. That is the requirement; matching geometry is the consequence.
- **Button geometry is fixed at `2rem × 2rem` (24 × 24 at the default 12px root font-size) with `border-radius: var(--radius-xs)` (3px)**, `border: none`, `padding: 0`, `display: inline-flex` with `justify-content: center` + `align-items: center`, `line-height: 0`.
- **Never compose `.btn small` + a container override** for an icon-only button. `.btn.small` and container `.btn` rules are both specificity `(0,2,0)`, so source order decides and the override silently loses — that is the bug being fixed, and it is documented in `styles.css:379-382`.
- **`styles.css` is CRLF.** The `edit` tool will not match multi-line strings in it; use a Python one-liner with `io.open(..., newline='')` to preserve line endings.
- **Language: English** for source, UI labels and docs. Commits must **not** carry a `Co-Authored-By` trailer.
- **A parallel session is editing this checkout.** `src/renderer/src/styles.css`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/chat/ChatInput.tsx`, `src/renderer/src/components/chat/ChatPanel.tsx` and the untracked `src/renderer/src/components/chat/AddMenu.tsx` carry uncommitted foreign work at plan-writing time. Before every commit: `git status --short`, then read `git diff` on any dirty file you did not touch. Stage only the paths and hunks you changed — never `git add -A`. If foreign edits overlap a hunk you need, stage by splitting hunks or stop and ask.
- **Verification before claiming done:** `npm run typecheck`, `npm test`, and `npm run build && npx playwright test` for the affected specs.

---

### Task 1: The failing e2e test

The test locks the actual requirement — not "two buttons that look alike" but "one class" — plus every element the change removes. It is written first and observed failing.

**Files:**
- Test: `tests/e2e/sidebar-sessions.spec.ts` (append a test at end of file)

**Interfaces:**
- Consumes: the file's existing helpers `cleanupDir(dir)`, `seedWorkspaces(userData, project, sessionNames)`, `launch(userData)`, `openProject(window)`. Seeded session name is `'Alpha'`, project name is `'E2E Project'`.
- Produces: nothing importable. The test's selectors are the contract later tasks must satisfy: `.pane-status` and `.pane-git` absent, `.pane-header .status-dot[aria-label="idle"]`, a `menu Alpha` button carrying `lucide-more-vertical` in a `24 × 24` / `3px` box, whose `class` attribute equals the project-row `menu E2E Project` button's.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/sidebar-sessions.spec.ts`:

```ts
test('the pane header is the dot and the name, sharing the sidebar icon button', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'meow-ud-'))
  const project = mkdtempSync(path.join(tmpdir(), 'meow-e2e-'))
  try {
    seedWorkspaces(userData, project, ['Alpha'])
    const { app, window } = await launch(userData)
    try {
      await openProject(window)

      // The header is the dot and the name. The status word repeated the dot
      // beside it, and the git readout rendered "--" whenever git was
      // unavailable while the status bar already shows branch + dirty count.
      await expect(window.locator('.pane-status')).toHaveCount(0)
      await expect(window.locator('.pane-git')).toHaveCount(0)
      await expect(window.locator('.pane-title')).toHaveText('Alpha')

      // Dropping the visible status word must not drop the status: the dot
      // carries it as an accessible name.
      await expect(window.locator('.pane-header .status-dot')).toHaveAttribute('aria-label', 'idle')

      // One action button, in the sidebar icon-button box.
      const paneMenu = window.getByRole('button', { name: 'menu Alpha', exact: true })
      await expect(paneMenu).toHaveCount(1)
      await expect(paneMenu.locator('svg')).toHaveClass(/lucide-more-vertical/)
      const paneBox = (await paneMenu.boundingBox())!
      expect(Math.round(paneBox.width)).toBe(24)
      expect(Math.round(paneBox.height)).toBe(24)
      await expect(paneMenu).toHaveCSS('border-radius', '3px')

      // Not "a button that looks the same as the project row's" — the same
      // class, so the two cannot drift apart again.
      await window.locator('.project-row').hover()
      const projectMenu = window.getByRole('button', { name: 'menu E2E Project', exact: true })
      expect(await paneMenu.getAttribute('class')).toBe(await projectMenu.getAttribute('class'))
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

Run: `npx playwright test tests/e2e/sidebar-sessions.spec.ts -g "sharing the sidebar icon button"`
Expected: FAIL at line 1 of the assertions — `Expected: 0, Received: 1` for `.pane-status` (the header still renders it).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/e2e/sidebar-sessions.spec.ts
git commit -m "test(e2e): lock the pane header trim and its shared icon button"
```

---

### Task 2: Rename `.sidebar-icon-btn` → `.icon-btn`

Pure rename, no behaviour change: 7 occurrences in `styles.css`, 3 in `Sidebar.tsx`. Doing it in one step keeps the sidebar styled at every commit. The test from Task 1 stays red — the pane header still uses `.btn ghost small`.

**Files:**
- Modify: `src/renderer/src/styles.css` (lines 336, 338, 383, 1344, 1495, 1496, 1497)
- Modify: `src/renderer/src/components/Sidebar.tsx` (lines 217, 225, 423)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the class name `.icon-btn`, defined once at `styles.css` (~line 383) and consumed by Task 3's `PaneHeader` button. Its rule stays exactly: `display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; padding: 0; flex: 0 0 auto; line-height: 0; border: none; background: transparent; color: var(--text-faint); border-radius: var(--radius-xs); cursor: pointer; transition: background 120ms ease, color 120ms ease`.

- [ ] **Step 1: Rename in styles.css**

Rename every occurrence in the file (a script in `tmp-rename.py`, because the
nested heredoc/quotes in a one-liner are easy to get wrong):

```python
import io
p = 'src/renderer/src/styles.css'
s = io.open(p, encoding='utf-8', newline='').read()
n = s.count('sidebar-icon-btn')
assert n > 0, 'nothing to rename — wrong file?'
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace('sidebar-icon-btn', 'icon-btn'))
print(f'renamed {n} occurrences in styles.css')
```

At plan-writing time the working tree held **7** occurrences: 6 in committed code
plus one in the PARALLEL SESSION's uncommitted `.add-dropdown` comment
(`the project/session row ... menu (.sidebar-icon-btn), caret hidden.`). That
comment sits inside a 16-line added block that git cannot split, so staging it
would drag their half-finished composer button change into this commit. It is
text in their hunk, so it renames along with the rest of the file in the working
tree — but it must NOT be staged here. See Step 6, which stages by path and
leaves any `.add-dropdown` hunk unstaged.

- [ ] **Step 2: Update the class comment**

The comment above the class still scopes it to the sidebar. Replace the first line in `styles.css` so it reads:

```css
/* Icon-only button (sidebar project +/…, session-row …, pane header …). A standalone
   class, NOT `.btn small` + a container padding override: `.btn.small` and
   `.project-actions .btn` are both (0,2,0), so source order decided and the
   override silently lost — the buttons rendered 34x25 with the .btn 0.5rem radius. */
```

(This replaces the old first two lines "Icon-only button in the sidebar (project +/…, session-row …). A standalone / class, NOT `.btn small` + a container padding override: `.btn.small` and". Keep the `(0,2,0)` rationale — it is why the class must stay standalone.)

- [ ] **Step 3: Rename in Sidebar.tsx**

Run:

```bash
cd /e/Git/GitHub/meow-coding && python - <<'PYEOF'
import io
p = 'src/renderer/src/components/Sidebar.tsx'
s = io.open(p, encoding='utf-8', newline='').read()
n = s.count('className="sidebar-icon-btn"')
assert n == 3, f'expected 3 occurrences, found {n}'
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace('className="sidebar-icon-btn"', 'className="icon-btn"'))
print(f'renamed {n} occurrences in Sidebar.tsx')
PYEOF
```

- [ ] **Step 4: Verify no stale reference remains**

Run: `grep -rn "sidebar-icon-btn" src/ ; echo "exit=$?"`
Expected: **no output** (grep exits 1). Any hit is a missed occurrence — fix it
before continuing. Note `docs/reference/09-ui-guide.md` and
`src/renderer/AGENTS.md` still name the old class; Task 5 owns those.

- [ ] **Step 5: Verify typecheck, build, and that the sidebar still renders**

Run: `npm run typecheck && npm run build`
Expected: both exit 0.

Run: `npx playwright test tests/e2e/sidebar-sessions.spec.ts`
Expected: the pre-existing tests pass — in particular `sidebar icon buttons are 24x24 squares with a 3px radius`. The new test from Task 1 still FAILS (the pane header is unchanged so far); that is expected here.

- [ ] **Step 6: Commit**

Stage only these two paths, and only the hunks that are yours — both files carry
foreign edits elsewhere (see the plan's Global Constraints):

```bash
git add src/renderer/src/components/Sidebar.tsx
git add -p src/renderer/src/styles.css   # take only the .sidebar-icon-btn -> .icon-btn hunks
git diff --cached --stat
git commit -m "refactor(css): rename .sidebar-icon-btn to .icon-btn

It is no longer sidebar-scoped: the pane header's ... button shares it next.
Pure rename, no behaviour change."
```

**Watch for the foreign hunk.** The parallel session's `.add-dropdown` block
contains a `.sidebar-icon-btn` mention in its comment. Because the rename runs
over the whole file, that comment now also says `.icon-btn` in the working tree
— and its containing hunk is one added block that `git add -p` cannot split. If
a foreign hunk is the ONLY thing carrying a rename, drop it: the working tree
stays renamed regardless, and their commit will agree with the new name. Verify
afterwards that no renamed line was left behind in the committed tree:

```bash
git show HEAD:src/renderer/src/styles.css | grep -n "sidebar-icon-btn"
```

Expected: no output for the 6 committed lines. A hit means a hunk was dropped
that should have been taken.

---

### Task 3: Trim the pane header and give it the shared button

**Files:**
- Modify: `src/renderer/src/components/PaneHeader.tsx`
- Modify: `src/renderer/src/styles.css` (delete `.pane-status`, `.pane-git`, `.pane-git::before`, `.pane-actions .btn`, `.pane-actions .btn:hover`, and the now-orphaned `.btn-icon`)

**Interfaces:**
- Consumes: the class `.icon-btn` from Task 2.
- Produces: a `PaneHeader` whose header markup is the status dot (with `role="img"` + status `aria-label`) and `.pane-title`, and whose single action button is `.icon-btn` with `lucide-more-vertical`. Task 4 relies on `git` no longer being a prop.

- [ ] **Step 1: Swap the icon import**

In `src/renderer/src/components/PaneHeader.tsx`, change the lucide import from:

```tsx
import { Ellipsis, FileText, Layers, Play, RotateCw, Square, Trash2 } from 'lucide-react'
```

to:

```tsx
import { FileText, Layers, MoreVertical, Play, RotateCw, Square, Trash2 } from 'lucide-react'
```

- [ ] **Step 2: Delete the `MoreIcon` helper**

Remove this block entirely (lines ~26-28):

```tsx
function MoreIcon() {
  return <Ellipsis size={14} aria-hidden="true" />
}
```

- [ ] **Step 3: Replace the header markup**

Replace lines ~66-73 — the `status-dot`, `pane-title`, `pane-status` and `pane-git` spans — with:

```tsx
      <span
        className={`status-dot status-${state.status}`}
        role="img"
        aria-label={state.exitCode !== null
          ? `${STATUS_LABEL[state.status]} (${state.exitCode})`
          : STATUS_LABEL[state.status]}
      />
      <span className="pane-title">{name}</span>
```

`role="img"` is required for the label to be exposed — a bare `aria-label` on a roleless `<span>` is not reliable. Folding `exitCode` into the label preserves the one fact the deleted text carried that the dot alone cannot express (`idle (1)`), and keeps `STATUS_LABEL` in use.

- [ ] **Step 4: Point the action button at the shared class**

Replace the button at lines ~91-98:

```tsx
          <button
            className="btn ghost small"
            title="Pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="btn-icon"><MoreIcon /></span>
          </button>
```

with:

```tsx
          <button
            className="icon-btn"
            title="Pane menu"
            aria-label={`menu ${name}`}
            onClick={() => setMenuOpen(v => !v)}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </button>
```

The `btn-icon` wrapper is dropped: `.icon-btn` is itself the centring flex container, so the wrapper is redundant (as it already is in `Sidebar.tsx`).

- [ ] **Step 5: Delete the dead CSS**

In `src/renderer/src/styles.css` delete these rules:

```css
.pane-status {
  color: var(--text-dim); white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
}
```

```css
.pane-git {
  color: var(--text-dim); white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
}
.pane-git::before { content: '⎇ '; color: var(--text-faint); }
```

and replace the two `.pane-actions` overrides:

```css
.pane-actions .btn { background: transparent; padding: 0.166667rem 0.666667rem; border-color: transparent; }
.pane-actions .btn:hover { background: var(--bg-hover); border-color: var(--accent-dim); }
```

with:

```css
.pane-actions .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
```

Keep the `.pane-actions` rule itself (`margin-left: auto; display: flex; gap: 0.333333rem; align-items: center;`) unchanged.

Also delete the now-orphaned `.btn-icon` rule (nothing else uses it — verify with `grep -rn "btn-icon" src/`):

```css
.btn-icon {
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 0; /* icon-only buttons: collapse text line box so the svg is vertically centered, not baseline-shifted */
  vertical-align: middle;
}
```

**Deliberate visual loss, not a regression:** hovering the pane menu previously revealed a 1px `--accent-dim` border (`.btn`'s `solid` border with its colour swapped). `.icon-btn` is `border: none` and cannot reproduce it; hover becomes a `--bg-hover` background, matching the sidebar buttons. This is the point of the change.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/sidebar-sessions.spec.ts -g "sharing the sidebar icon button"`
Expected: PASS.

- [ ] **Step 7: Verify no regression in the other header-consuming specs**

Run: `npx playwright test tests/e2e/sidebar-sessions.spec.ts tests/e2e/smoke.spec.ts`
Expected: all pass. `smoke.spec.ts` sends a message through the pane, so it guards the header change breaking the chat pane.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/PaneHeader.tsx src/renderer/src/styles.css
git commit -m "feat(ui): trim the pane header to the dot and the name

The status word repeated the dot beside it, and the git readout rendered \"--\"
whenever git was unavailable while the status bar already shows branch + dirty
count. The status moves onto the dot's accessible name (role=img + aria-label,
with exitCode folded in) so screen readers keep it.

The ... button becomes the sidebar's .icon-btn with a vertical ellipsis, so it
is the same button as the project row's rather than a lookalike built from
.btn ghost small + a container override."
```

---

### Task 4: Delete the dead `git` data path

`git` existed on the header only to render `.pane-git`, which Task 3 removed. Nothing else reads it.

**Files:**
- Modify: `src/renderer/src/components/PaneHeader.tsx` (props)
- Modify: `src/renderer/src/App.tsx` (`PaneModel` + its builder)
- Modify: `src/renderer/src/components/Pane.tsx` (the prop pass-through)

**Interfaces:**
- Consumes: Task 3's header, which no longer renders `git`.
- Produces: `PaneModel` = `{ agent: AgentConfig; state: AgentState }`. `PaneHeader`'s props lose `git`. `Runtime.git` is untouched — `StatusBar` and the git viewer still use it.

- [ ] **Step 1: Remove the prop from PaneHeader**

In `src/renderer/src/components/PaneHeader.tsx`, change the type import from:

```tsx
import type { AgentState, GitStatus } from '@shared/types'
```

to:

```tsx
import type { AgentState } from '@shared/types'
```

Then delete the `git: GitStatus | null` line from `interface Props` and the `git,` entry from the destructured parameter list.

- [ ] **Step 2: Remove it from Pane's pass-through**

In `src/renderer/src/components/Pane.tsx`, delete the line:

```tsx
        git={pane.git}
```

- [ ] **Step 3: Remove it from PaneModel and its builder**

In `src/renderer/src/App.tsx`, delete `git: GitStatus | null` from the `PaneModel` interface and `git: runtime.git` from the `panes` builder, so they read:

```tsx
export interface PaneModel {
  agent: AgentConfig
  state: AgentState
}
```

```tsx
  const panes: PaneModel[] = useMemo(() =>
    runtime.workspace.agents.map(agent => ({
      agent,
      state: runtime.agents.find(s => s.agentId === agent.id) ?? {
        agentId: agent.id, status: 'idle', exitCode: null, lastOutputAt: null, alert: 'normal'
      }
    })), [runtime])
```

`GitStatus` is then referenced nowhere in `App.tsx` — its only type-level use was that `PaneModel` line (line 190's `onGitStatus` callback destructures a value, it is not a type reference). Delete it from the type import on line 5, so the import reads:

```tsx
  AgentConfig, AgentState, ArtifactEntry, UpdaterStatusEvent, WorkspaceRuntime, WorkspaceSummary
```

Do this by hand and verify with grep — **neither typecheck nor lint will catch it**: this repo sets no `noUnusedLocals` and has no ESLint config, so an unused type import compiles clean. Leave the unrelated `git: rt.git` merges in `WorkspaceRuntime` state alone — those feed `StatusBar`, a different path.

- [ ] **Step 4: Verify typecheck proves no reader was missed**

Run: `npm run typecheck`
Expected: exit 0. A leftover `pane.git` or `git={...}` *reader* does fail here (`TS2339: Property 'git' does not exist on type 'PaneModel'`) — that is the point of doing this as its own step. It will **not** catch a leftover `GitStatus` import, hence:

Run: `grep -n "GitStatus" src/renderer/src/App.tsx; echo "exit=$?"`
Expected: no output (exit 1).

- [ ] **Step 5: Verify the status bar still shows git**

Run: `npm run build && npx playwright test tests/e2e/smoke.spec.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/Pane.tsx src/renderer/src/App.tsx
git commit -m "refactor: drop the pane header's unused git prop

It existed only to render the header's .pane-git span, which is gone. Runtime.git
is untouched: the status bar and the git viewer still read it."
```

---

### Task 5: Sync the docs

The rename and the trim make five places in the reference docs state something untrue — one of them (`09-ui-guide.md:184`) asserts the old class *is* sidebar-scoped, which the rename directly contradicts.

**Files:**
- Modify: `docs/reference/09-ui-guide.md`
- Modify: `src/renderer/AGENTS.md`

**Interfaces:**
- Consumes: the final class name `.icon-btn` and the header's new contents.
- Produces: nothing importable.

- [ ] **Step 1: Fix the PaneHeader row and the action-menu list**

In `docs/reference/09-ui-guide.md`, update the `PaneHeader.tsx` row — it currently reads "Status dot, git info, menu (inject / log / stop / restart / background / delete — ...)". Replace "Status dot, git info, menu" with a description of the trimmed header: the status dot (which carries the status as its accessible name), the session name, and the menu. Include that a native session's lifecycle lives in its sidebar row (keep that existing clause verbatim).

Then in the "Action menus get icons and dividers" bullet (~line 176), the list names "pane header"; that stays accurate — no change needed there.

- [ ] **Step 2: Fix the radii line**

`docs/reference/09-ui-guide.md` ~line 153 contains this fragment (the surrounding line continues with the other radius tokens after "readout)" — change only the parenthetical, leave the rest of the line as it is):

```
- Radii: `--radius-xs` 3px (sidebar icon buttons, chat context readout), <other tokens unchanged>
```

So the parenthetical becomes:

```
- Radii: `--radius-xs` 3px (`.icon-btn` — sidebar `+`/`...` and the pane header `...` — and the chat context readout), <other tokens unchanged>
```

- [ ] **Step 3: Fix the context-readout bullet's now-false claim**

`docs/reference/09-ui-guide.md` ~lines 181-185 currently says the readout "shares the sidebar icon buttons' *look*, not their class: `.sidebar-icon-btn` is sidebar-scoped and its hover lives in container rules". Both the class name and the "sidebar-scoped" reason are now wrong. Rewrite that sentence so it says the readout shares the icon buttons' *look* but not their class — retaining the accurate reason that its hover lives in a container rule (`.context-footer-wrap`) and it is deliberately not clickable (`cursor: default`, no tabindex).

- [ ] **Step 4: Fix the "Icon-only buttons" paragraph**

`docs/reference/09-ui-guide.md` ~line 208 opens "**Icon-only buttons.** `.sidebar-icon-btn` (fixed 24 × 24, `--radius-xs`) is the one class for the sidebar's icon-only buttons (project `+` / `...`, session-row `...`; `Sidebar.tsx`)." Rename the class and widen the scope to include the pane header's `...` button. Keep the `(0,2,0)` source-order explanation and the measured "34 × 25 with the `.btn` 6px radius" history verbatim — that is why the class is standalone.

- [ ] **Step 5: Fix the renderer conventions bullet**

`src/renderer/AGENTS.md` line 70 reads "**Icon-only buttons use `.sidebar-icon-btn`** (fixed 24 × 24, `border-radius: var(--radius-xs)` = 3px) — never `.btn small` with a container padding override. ..." Rename the class and state its real scope (sidebar rows + pane header). Leave the `(0,2,0)` rationale and the "34 × 25 with the `.btn` 6px radius" history unchanged — only the entries this change actually affects, per the repo's documentation-sync rule.

- [ ] **Step 6: Verify no stale class name survives anywhere**

Run: `grep -rn "sidebar-icon-btn" docs/reference/ src/ ; echo "exit=$?"`
Expected: **no output** (grep exits 1).

Scope the gate to the live reference and the source. `docs/superpowers/specs|plans`
are historical records of decisions taken when the old name was current — rewriting
them would turn accurate history into false history. That includes
`2026-09-12-sidebar-icon-button-geometry-design.md`, which introduced the class.
(That spec also warned off the name `.icon-btn` for colliding with the `.btn-icon`
helper's spelling; Task 3 deletes `.btn-icon`, so the confusion it feared is gone —
and no `.icon-btn` rule pre-existed, so this rename introduces no collision.)

- [ ] **Step 7: Commit**

```bash
git add docs/reference/09-ui-guide.md src/renderer/AGENTS.md
git commit -m "docs: sync the icon-button class rename and the pane header trim"
```

---

### Task 6: Full verification

**Files:** none modified.

**Interfaces:**
- Consumes: every prior task.
- Produces: nothing.

- [ ] **Step 1: Full typecheck and unit suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; Vitest reports all tests passing.

- [ ] **Step 2: Full e2e suite**

Run: `npm run build && npx playwright test`
Expected: pass. If `menus.spec.ts` fails on `expect(item.h).toBe(32)`, that is the known uncommitted foreign change to `--menu-item-h` (`2.25rem` → 27px) in `styles.css`, not this work — confirm with `git diff src/renderer/src/styles.css | grep -- --menu-item-h` before attributing it.

- [ ] **Step 3: Confirm the new test is not flaky**

Run: `for i in 1 2 3 4 5; do npx playwright test tests/e2e/sidebar-sessions.spec.ts -g "sharing the sidebar icon button" 2>&1 | grep -E "passed|failed"; done`
Expected: 5 × `1 passed`.

- [ ] **Step 4: Confirm only intended paths are committed**

Run: `git status --short && git log --oneline -6`
Expected: the only remaining dirty paths are the parallel session's own files (`chat/ChatInput.tsx`, `chat/ChatPanel.tsx`, `chat/AddMenu.tsx`, plus any of their `styles.css`/`Sidebar.tsx` hunks left unstaged). No file this plan touched is still dirty.
