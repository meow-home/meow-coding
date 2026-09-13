# Modal and Settings Page Background Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update background colors of all popup modals (`.dialog`) and the settings page (`.settings-screen`, `.settings-sidebar`, `.settings-screen-back`, `.settings-row`, `.settings-section`, `.settings-save-pill`) in `src/renderer/src/styles.css` to use `var(--bg-chat)` so they match the dropdown menu background (pure white in Light theme).

**Architecture:** Update CSS variables/rules in `src/renderer/src/styles.css` for modal dialogs and settings page elements. Update AGENTS.md / reference documentation if needed. Run typecheck and tests to verify build integrity.

**Tech Stack:** React 19, TypeScript, CSS (Theme variables in Electron app).

## Global Constraints
- Source code, comments, UI labels, documentation are in English.
- No `Co-Authored-By` trailer in git commit messages.
- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Update Modal and Settings Page background styles in `styles.css`

**Files:**
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Theme token `var(--bg-chat)` (white `#ffffff` in Light theme, `#0a0a0b` in Dark theme).

- [ ] **Step 1: Edit `src/renderer/src/styles.css` to update background rules**

In `src/renderer/src/styles.css`:
1. Change `.dialog`:
```css
.dialog {
  background: var(--bg-chat);
  border: 0.083333rem solid var(--hairline);
  box-shadow: var(--shadow-3);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  width: 35rem;
  display: flex; flex-direction: column; gap: 0.833333rem;
}
```

2. Change `.settings-screen`:
```css
.settings-screen {
  position: fixed; inset: 2.833333rem 0 0; z-index: 100;
  display: flex; flex-direction: column;
  background: var(--bg-chat); color: var(--text);
}
```

3. Change `.settings-sidebar`:
```css
.settings-sidebar {
  flex: 0 0 22.333333rem; /* same width as the project sidebar */
  display: flex; flex-direction: column; min-height: 0;
  border-right: 0.083333rem solid var(--hairline);
  background: var(--bg-chat);
}
```

4. Change `.settings-screen-back`:
```css
.settings-screen-back {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: flex-start; gap: 0.5rem;
  margin: 0.333333rem 0.333333rem 0.666667rem;
  width: calc(100% - 0.666667rem);
  min-height: 3.333333rem;
  padding: 0.333333rem 1.166667rem;
  font-size: var(--fs-md);
  background: var(--bg-chat);
  border-color: var(--bg-chat);
  color: var(--text-strong);
}
```

5. Change `.settings-row`:
```css
.settings-row { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.833333rem 1rem; background: var(--bg-chat); border: 0.083333rem solid var(--hairline); border-radius: var(--radius); }
```

6. Change `.settings-section`:
```css
.settings-section { display: flex; flex-direction: column; gap: 0.666667rem; padding: 0.833333rem 1rem; background: var(--bg-chat); border: 0.083333rem solid var(--hairline); border-radius: var(--radius); }
```

7. Change `.settings-save-pill`:
```css
.settings-save-pill {
  position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 110;
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 1rem; border-radius: var(--radius-lg);
  background: var(--bg-chat); border: 0.083333rem solid var(--hairline);
  box-shadow: var(--shadow-2);
  font-size: var(--fs-sm); color: var(--text-dim);
}
```

- [ ] **Step 2: Run typecheck and tests to verify**

Run: `npm run typecheck`
Expected: PASS

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): update popup modals and settings page background to match dropdown menus"
```
