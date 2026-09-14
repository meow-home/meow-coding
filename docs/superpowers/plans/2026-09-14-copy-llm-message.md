# LLM Message Copy Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a copy button at the bottom of assistant messages in the chat feed to copy raw markdown text to clipboard.

**Architecture:** Update `FeedMessage` component in `ChatPanel.tsx` to include state management for clipboard copying with feedback. Add CSS styles in `styles.css` for hover-based action row.

**Tech Stack:** React 19, TypeScript, Lucide React (`Copy`, `Check`), CSS modules/tokens.

---

### Task 1: Add Copy Action to FeedMessage in ChatPanel.tsx and CSS in styles.css

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Update ChatPanel.tsx to include copy button and state**

In `src/renderer/src/components/chat/ChatPanel.tsx`:
Import `Copy` and `Check` from `lucide-react` at the top of the file:
```tsx
import { Check, Copy } from 'lucide-react'
```

In `FeedMessage` component:
```tsx
const FeedMessage = memo(function FeedMessage({ role, text, reasoning, images, commands, messageId, onOpenImage, onOpenFile }: {
  role: ChatMessage['role']
  text: string
  reasoning?: string
  images?: ImageAttachment[]
  commands: Command[]
  messageId: string
  onOpenImage?: (dataUrl: string) => void
  onOpenFile?: (path: string) => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <div className={`chat-msg ${role}`} data-chat-message-id={messageId}>
      {role === 'assistant' ? (
        <>
          {reasoning ? (
            <details className="chat-reasoning">
              <summary>Thinking</summary>
              <div className="chat-reasoning-text">{reasoning}</div>
            </details>
          ) : null}
          {text.trim() !== '' && <MarkdownText text={text} onOpenFile={onOpenFile} />}
          {text.trim() !== '' && (
            <div className="chat-msg-actions">
              <button
                className="chat-action-btn"
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy message'}
                aria-label={copied ? 'Copied!' : 'Copy message'}
              >
                {copied ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
...
```

- [ ] **Step 2: Add CSS styles in styles.css**

In `src/renderer/src/styles.css`, add:
```css
.chat-msg.assistant {
  position: relative;
}

.chat-msg-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.35rem;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
}

.chat-msg.assistant:hover .chat-msg-actions,
.chat-msg-actions:focus-within {
  opacity: 1;
}

.chat-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.chat-action-btn:hover {
  color: var(--text-strong);
  background: var(--menu-hover);
}
```

- [ ] **Step 3: Update documentation**

Update `src/renderer/src/components/chat/AGENTS.md` and `docs/reference/09-ui-guide.md` to reflect the copy message action feature.

- [ ] **Step 4: Verify typecheck & tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css src/renderer/src/components/chat/AGENTS.md docs/reference/09-ui-guide.md
git commit -m "feat(chat): add copy message button for assistant responses"
```
