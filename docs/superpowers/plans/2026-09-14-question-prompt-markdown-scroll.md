# Question Prompt Markdown & Scroll Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance `ChatPanel.tsx` question prompt to render Markdown and add scroll containment to prevent prompt cards from overflowing off-screen.

---

### Task 1: Render Markdown in Question Prompt in `ChatPanel.tsx`

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Replace raw text with `<MarkdownText>` for question prompt text**

In `ChatPanel.tsx`:
```tsx
<div className="chat-prompt-text">
  <MarkdownText text={pendingPrompt.question} />
  {pendingPrompt.multiple && <span className="chat-prompt-multi-hint"> (select all that apply)</span>}
</div>
```

- [ ] **Step 2: Update collapsed prompt view**

In collapsed mode:
```tsx
<div className="chat-prompt-collapsed-text">
  <MarkdownText text={pendingPrompt.question} />
</div>
```

- [ ] **Step 3: Verify typecheck passes**

Run `npm run typecheck`

- [ ] **Step 4: Commit changes**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx
git commit -m "feat(chat): render MarkdownText in agent question prompt"
```

---

### Task 2: Add Max-Height Scroll Containment and Sticky Header in `styles.css`

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update `.chat-prompt` and `.chat-prompt-head` CSS**

Add `max-height: 50vh`, `overflow-y: auto`, sticky header, and reset `.chat-prompt-text .chat-text` background/padding.

- [ ] **Step 2: Verify typecheck & test pass**

Run `npm run typecheck && npm test`

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/styles.css
git commit -m "style(chat): add scroll containment and sticky header to question prompt card"
```
