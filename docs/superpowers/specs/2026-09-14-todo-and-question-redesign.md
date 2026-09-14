# Todo List and Question Prompt UI Redesign Spec

## Executive Summary
This spec outlines the design for updating the **Todo List** component and the **Question / Permission Prompt** overlay in Meow Coding. The redesign aligns with the Ultra-Clean Micro-Bar & Interactive System design tokens (`--bg-raised`, `--hairline`, `--accent`, Lucide icons, tabular numbers) ensuring visual harmony across the entire app.

## Requirements & Scope

### 1. Todo List (`.chat-todos`)
- Rendered above the chat feed in `ChatPanel.tsx`.
- Hairline progress bar on top indicating progress (`doneCount / totalCount * 100%`).
- Micro-eyebrow header: `TODO LIST` in uppercase `var(--font-display)` display text, count badge (`N/M`) in tabular numbers, collapse toggle.
- Task items:
  - Status icons:
    - `completed`: `CheckCircle2` (color: `var(--green)`)
    - `in_progress`: `Clock` / `Loader2` (color: `var(--blue)`)
    - `pending`: `Circle` (color: `var(--text-faint)`)
    - `cancelled`: `XCircle` (color: `var(--text-faint)`, line-through text style)
  - Micro item layout (~28px height per item) with subtle hover state (`var(--menu-hover)`).

### 2. Question & Permission Prompt (`.chat-prompt`)
- Embedded in-flow at the top of the composer card.
- Badge: `QUESTION` or `PERMISSION` badge tag using system color tokens.
- Interactive Option Items (`.chat-option`):
  - Badge mark showing option number (`1.`, `2.`) or check mark indicator.
  - Distinct title (`.chat-option-label`) and description (`.chat-option-desc`) styling.
  - Interactive keyboard focus highlight using `var(--accent)` focus ring.
  - Selected state with left accent border indicator (`box-shadow: inset 0.166667rem 0 0 var(--accent)`).
- Custom answer input matching `--bg-input` theme style.

## Component & CSS Changes

### Files to Modify
- `src/renderer/src/components/chat/ChatPanel.tsx`:
  - Replace raw ASCII marks in todo list with Lucide icons (`CheckCircle2`, `Clock`, `Circle`, `XCircle`).
  - Add inline CSS style or structure for progress bar in todo header.
- `src/renderer/src/styles.css`:
  - Update `.chat-todos`, `.chat-todos-head`, `.chat-todos-list`, `.chat-todo`.
  - Update `.chat-prompt`, `.chat-prompt-head`, `.chat-options`, `.chat-option`.
