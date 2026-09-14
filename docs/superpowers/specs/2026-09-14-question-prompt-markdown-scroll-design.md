# Design Spec: Question Prompt Markdown & Scroll Containment

**Date:** 2026-09-14
**Status:** Approved

## Problem
In `ChatPanel`, when an agent asks a question with a long body or many options:
1. Long question text or multiple options cause `.chat-prompt` to overflow past the bottom of the screen, hiding action buttons and composer controls.
2. The question text (`pendingPrompt.question`) is rendered as raw plain text, missing markdown formatting (code blocks, bolding, lists, links).

## Solution
1. Render `pendingPrompt.question` using `<MarkdownText text={pendingPrompt.question} />` in `ChatPanel.tsx`.
2. Apply `max-height: 50vh`, `overflow-y: auto`, sticky header, and custom scrollbar styling to `.chat-prompt` in `src/renderer/src/styles.css`.

## Detailed Changes

### Component (`ChatPanel.tsx`)
- Import `MarkdownText` (already imported in `ChatPanel.tsx`).
- Replace `{pendingPrompt.question}` in `.chat-prompt-text` with `<MarkdownText text={pendingPrompt.question} />`.
- In collapsed view `.chat-prompt-collapsed-text`, replace plain text with concise inline Markdown or `<MarkdownText text={pendingPrompt.question} />`.

### Styling (`styles.css`)
- `.chat-prompt`:
  - `max-height: 50vh`
  - `overflow-y: auto`
  - `position: relative`
- `.chat-prompt-head`:
  - `position: sticky`
  - `top: 0`
  - `z-index: 2`
  - `background: var(--bg-raised)`
  - `padding-bottom: 0.333333rem`
- `.chat-prompt-text .chat-text`:
  - Compact resets (`max-width: none`, `background: transparent`, `border: none`, `padding: 0`, `margin: 0`) so markdown text flows naturally inside the prompt box.

## Verification
- `npm run typecheck`
- `npm test`
