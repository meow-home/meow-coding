# Todo List and Question Prompt Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Todo List and Question / Permission Prompt components to align with the Ultra-Clean Micro-Bar & System design tokens.

**Architecture:** Update `ChatPanel.tsx` component to use Lucide status icons (`CheckCircle2`, `Clock`, `Circle`, `XCircle`) and hairline progress bar for Todo items, and update Question prompt structure. Refine CSS in `styles.css`.

**Tech Stack:** React 19, TypeScript, Lucide React, CSS variables.

---

### Task 1: Redesign Todo List in ChatPanel.tsx & styles.css

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update ChatPanel.tsx imports and Todo rendering**

In `src/renderer/src/components/chat/ChatPanel.tsx`:
Add imports:
```tsx
import { CheckCircle2, ChevronDown, Circle, Clock, XCircle } from 'lucide-react'
```

Update Todo status icon renderer function:
```tsx
const renderTodoStatusIcon = (status: TodoStatus) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} style={{ color: 'var(--green)' }} aria-hidden="true" />
    case 'in_progress':
      return <Clock size={13} style={{ color: 'var(--blue)' }} aria-hidden="true" />
    case 'pending':
      return <Circle size={13} style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
    case 'cancelled':
      return <XCircle size={13} style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
  }
}
```

Update `.chat-todos` render block to include progress bar:
```tsx
{todos.length > 0 && (
  <div className="chat-todos">
    <div className="chat-todos-progress" style={{ width: `${(doneCount / todos.length) * 100}%` }} />
    <div className="chat-todos-head">
      <span className="chat-todos-title">TODO LIST</span>
      <span className="chat-todos-count">{doneCount}/{todos.length}</span>
      <button
        className={`chat-todos-toggle ${todosCollapsed ? 'collapsed' : ''}`}
        title={todosCollapsed ? 'Expand' : 'Collapse'}
        aria-label={todosCollapsed ? 'Expand todo list' : 'Collapse todo list'}
        onClick={() => setTodosCollapsed(v => !v)}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </div>
    {!todosCollapsed && (
      <ul className="chat-todos-list">
        {todos.map((t, i) => (
          <li key={i} className={`chat-todo status-${t.status}`}>
            <span className="chat-todo-mark">{renderTodoStatusIcon(t.status)}</span>
            <span className="chat-todo-content">{t.content}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

- [ ] **Step 2: Update Question Prompt header rendering in ChatPanel.tsx**

Update `.chat-prompt-head` to include badge:
```tsx
<div className="chat-prompt-head">
  <span className={`chat-prompt-badge ${pendingPrompt.promptType}`}>
    {pendingPrompt.promptType.toUpperCase()}
  </span>
  <div className="chat-prompt-head-label">
    {pendingPrompt.promptType === 'permission' ? 'Permission Request' : 'Agent Question'}
  </div>
  ...
```

- [ ] **Step 3: Update CSS styles for Todo list and Question prompt in styles.css**

In `src/renderer/src/styles.css`:
```css
/* Todo List Redesign */
.chat-todos {
  position: relative;
  background: var(--bg-raised);
  border: 0.083333rem solid var(--hairline);
  border-radius: var(--radius-lg);
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  overflow: hidden;
  box-shadow: var(--shadow-1);
}

.chat-todos-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 0.166667rem;
  background: var(--accent);
  transition: width 0.25s ease-in-out;
}

.chat-todos-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.chat-todos-title {
  font-family: var(--font-display);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.08em;
  color: var(--orange);
  flex: 1;
}

.chat-todos-count {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  background: var(--bg-code);
  padding: 0.083333rem 0.4rem;
  border-radius: var(--radius-sm);
}

.chat-todo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: var(--fs-sm);
  color: var(--text);
  border-bottom: 0.083333rem solid var(--menu-hover);
}

.chat-todo:last-child {
  border-bottom: none;
}

.chat-todo.status-cancelled .chat-todo-content {
  text-decoration: line-through;
  color: var(--text-faint);
}

/* Question Prompt Redesign */
.chat-prompt-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.083333rem 0.35rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: var(--fw-bold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.chat-prompt-badge.permission {
  background: rgba(255, 180, 84, 0.15);
  color: var(--yellow);
  border: 0.083333rem solid rgba(255, 180, 84, 0.3);
}

.chat-prompt-badge.question {
  background: var(--accent-dim);
  color: var(--accent-strong);
  border: 0.083333rem solid var(--accent-border);
}
```

- [ ] **Step 4: Update docs**

Update `src/renderer/src/components/chat/AGENTS.md` and `docs/reference/09-ui-guide.md`.

- [ ] **Step 5: Verify typecheck & test suite**

Run `npm run typecheck && npm test`.

- [ ] **Step 6: Commit changes**

Commit with message `feat(chat): redesign todo list and question prompt UI`.
