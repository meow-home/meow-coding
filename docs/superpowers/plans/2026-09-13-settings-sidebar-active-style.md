# Settings Sidebar Active Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Settings sidebar item active background style from blue accent to subtle gray (`var(--bg-active)`), matching project and session items.

**Architecture:** Modify CSS rule `.settings-nav-item.active` in `src/renderer/src/styles.css` and verify typecheck & unit test suite pass.

**Tech Stack:** React 19, TypeScript, CSS (custom properties).

## Global Constraints

- `.settings-nav-item.active { background: var(--bg-active); color: var(--text-strong); }`
- Edit CSS with Python or exact string replacements handling CRLF line endings.

---

### Task 1: Update Settings Nav Item Active CSS Style

**Files:**
- Modify: `src/renderer/src/styles.css:1171`

**Interfaces:**
- Consumes: CSS custom properties `--bg-active`, `--text-strong`
- Produces: Updated `.settings-nav-item.active` style class

- [ ] **Step 1: Check current CSS rule in `src/renderer/src/styles.css`**

Run: `grep -n "\.settings-nav-item\.active" src/renderer/src/styles.css`
Expected output: `.settings-nav-item.active { background: var(--accent); color: #ffffff; border-left-color: var(--accent); }`

- [ ] **Step 2: Modify `src/renderer/src/styles.css`**

Update `.settings-nav-item.active` from:
```css
.settings-nav-item.active { background: var(--accent); color: #ffffff; border-left-color: var(--accent); }
```
to:
```css
.settings-nav-item.active { background: var(--bg-active); color: var(--text-strong); }
```

- [ ] **Step 3: Verify the CSS rule change**

Run: `grep -n "\.settings-nav-item\.active" src/renderer/src/styles.css`
Expected output: `.settings-nav-item.active { background: var(--bg-active); color: var(--text-strong); }`

- [ ] **Step 4: Run typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: ALL pass with zero errors.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(settings): use gray background for active sidebar item"
```
