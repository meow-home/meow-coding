# Chat Feed & Tool Call UI Font Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize chat feed, tool call header, subagent state, and prompt option fonts to use UI font (`var(--font-ui)`), keeping mono font (`var(--font-mono)`) exclusively for code, scripts, outputs, logs, and diffs.

**Architecture:** Update CSS font-family definitions in `src/renderer/src/styles.css` for Chat UI components and run typecheck/tests to ensure visual and code integrity.

**Tech Stack:** React 19, TypeScript, CSS Variables.

## Global Constraints
- UI font: `var(--font-ui)`
- Mono font: `var(--font-mono)`
- Numbers in UI font metadata (such as counts and tokens): `font-variant-numeric: tabular-nums`
- Do not touch inline code, code blocks, tool inputs/outputs, diffs, or log viewer fonts.

---

### Task 1: Update CSS font rules in `src/renderer/src/styles.css`

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Inspect and update Tool Call card headers in `src/renderer/src/styles.css`**

Change `.tool-call-summary` and `.tool-call-name` font-family from `var(--font-mono)` to `var(--font-ui)`:

```css
.tool-call-summary { color: var(--text-dim); font-family: var(--font-ui); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.tool-call-name { font-weight: var(--fw-semibold); color: var(--accent); font-family: var(--font-ui); font-size: var(--fs-md); flex: 0 0 auto; }
```

- [ ] **Step 2: Update Chat Feed dividers and retry indicators in `src/renderer/src/styles.css`**

Change `.chat-compacted` and `.chat-retry` font-family from `var(--font-mono)` to `var(--font-ui)`:

```css
.chat-compacted { font-family: var(--font-ui); font-size: var(--fs-xs); ... }
.chat-retry { font-family: var(--font-ui); font-size: var(--fs-xs); ... }
```

- [ ] **Step 3: Update Chat Todos and Subagent states in `src/renderer/src/styles.css`**

Change `.chat-todos-count`, `.chat-todo-mark`, `.subagent-state`, `.chat-option-mark`, `.agent-tag`, `.pane-background-status`, `.background-status` font-family to `var(--font-ui)`:

```css
.chat-todos-count { font-size: var(--fs-sm); color: var(--text-dim); font-family: var(--font-ui); font-variant-numeric: tabular-nums; background: var(--bg-code); border-radius: 83.25rem; padding: 0.083333rem 0.666667rem; border: 0.083333rem solid var(--hairline); }
.chat-todo-mark { flex: 0 0 auto; font-family: var(--font-ui); color: var(--text-dim); }
.subagent-state { font-size: var(--fs-sm); font-family: var(--font-ui); color: var(--text-faint); }
.chat-option-mark { flex: 0 0 auto; color: var(--text-dim); font-family: var(--font-ui); }
.agent-tag { color: var(--text); font-family: var(--font-ui); font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.pane-background-status { color: var(--text-dim); font-size: var(--fs-sm); font-family: var(--font-ui); }
.background-status { color: var(--text-dim); font-size: var(--fs-sm); font-family: var(--font-ui); }
.session-tokens { font-family: var(--font-ui); font-variant-numeric: tabular-nums; font-size: var(--fs-sm); }
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: All typechecks and tests pass.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style: standardize chat feed and tool call UI fonts to font-ui"
```
