# Slash Command Menu UI Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the slash command suggestion popup (`.command-menu`) and command names (`.command-name`) to use the UI font family (`var(--font-ui)`).

**Architecture:** Modify CSS rule declarations in `src/renderer/src/styles.css` for `.command-menu` and `.command-name`.

**Tech Stack:** CSS / Electron React frontend.

## Global Constraints

- `.command-menu` must declare `font-family: var(--font-ui)`.
- `.command-name` must declare `font-family: var(--font-ui)` and `font-weight: var(--fw-semibold)`.
- All automated tests (`npm run typecheck` and `npm test`) must pass.

---

### Task 1: Update CSS for Command Menu Popup Font

**Files:**
- Modify: `src/renderer/src/styles.css:1477-1498`

**Interfaces:**
- Consumes: CSS CSS custom properties `--font-ui` and `--fw-semibold` defined in `src/renderer/src/styles.css`.
- Produces: Updated `.command-menu` and `.command-name` font-family rules.

- [ ] **Step 1: Edit `src/renderer/src/styles.css`**

Update `.command-menu` to set `font-family: var(--font-ui)` and `.command-name` to set `font-family: var(--font-ui)` and `font-weight: var(--fw-semibold)`:

```css
/* Command menu */
.command-menu {
  position: absolute; bottom: calc(100% + 0.333333rem); left: 0; z-index: 40;
  min-width: 26.666667rem; max-width: 40rem; max-height: 23.333333rem; overflow-y: auto;
  background: var(--bg-chat);
  border: 0.083333rem solid var(--hairline);
  border-radius: var(--menu-radius);
  box-shadow: var(--shadow-3);
  padding: var(--menu-pad); display: flex; flex-direction: column; gap: 0;
  contain: layout paint; will-change: transform;
  font-family: var(--font-ui);
}
.chat-input { position: relative; }
.command-item {
  text-align: left; display: flex; flex-direction: column; gap: 0.166667rem;
  padding: 0.5rem 0.833333rem; border: none; background: transparent; color: var(--text); cursor: pointer;
  border-radius: var(--radius-sm);
  border-left: 0.166667rem solid transparent;
}
.command-item.selected { background: var(--menu-active); border-left-color: var(--accent); }
.command-name { font-family: var(--font-ui); font-weight: var(--fw-semibold); color: var(--accent); font-size: var(--fs-md); }
.command-desc { color: var(--text-dim); font-size: var(--fs-base); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.command-more { padding: 0.333333rem 0.833333rem; color: var(--text-faint); font-size: var(--fs-base); font-style: italic; }
```

- [ ] **Step 2: Run typecheck to verify build integrity**

Run: `npm run typecheck`
Expected: PASS with 0 errors

- [ ] **Step 3: Run unit tests to verify test suite health**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(chat): use UI font for slash command suggestion popup"
```
