# Prompt Popup Relocation & Background Theme Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the question / permission prompt popup outside of the `.chat-input` element to the top of `.chat-composer` directly above `<ChatInput>`, and match its background color with `.chat-input` (`var(--bg-chat)`).

**Architecture:** Render `pendingPrompt` as a sibling card before `<ChatInput>` inside `<div className="chat-composer">`. Remove the `promptSlot` prop from `ChatInput`. Update CSS rules for `.chat-prompt` in `styles.css`.

**Tech Stack:** React 19, TypeScript, CSS Variables.

## Global Constraints

- Do not change any PTY or IPC contract.
- Preserve keyboard navigation (arrows, Enter, Tab) for permission and question prompts.
- All code/labels must remain English.

---

### Task 1: Move Prompt Popup in ChatPanel, Remove Prop from ChatInput, and Update CSS

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx:980-1115`
- Modify: `src/renderer/src/components/chat/ChatInput.tsx:16,263`
- Modify: `src/renderer/src/styles.css:888-895`

**Interfaces:**
- `ChatInput`: remove `promptSlot` prop from `Props`.

- [ ] **Step 1: Update `ChatInput.tsx` to remove `promptSlot` prop and element**

In `src/renderer/src/components/chat/ChatInput.tsx`:
Remove `promptSlot?: ReactNode` from `interface Props`.
Remove `{promptSlot}` from `div.chat-input`.

- [ ] **Step 2: Update `ChatPanel.tsx` to render prompt directly in `chat-composer`**

In `src/renderer/src/components/chat/ChatPanel.tsx`:
Move the `pendingPrompt && (...)` JSX block out of `<ChatInput promptSlot={...}>` and place it directly inside `<div className="chat-composer">` before `<ChatInput ... />`. Remove `promptSlot` from `<ChatInput>`.

- [ ] **Step 3: Update `styles.css` background color for `.chat-prompt`**

In `src/renderer/src/styles.css`:
Change `background: var(--bg-raised);` in `.chat-prompt` to `background: var(--bg-chat);`.

- [ ] **Step 4: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/components/chat/ChatInput.tsx src/renderer/src/styles.css
git commit -m "feat(ui): relocate prompt popup above chat input and match background color"
```
