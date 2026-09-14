# LLM Message Copy Feature Design Spec

## Executive Summary
This spec defines the design for copying assistant (LLM) message content directly to the clipboard in the Meow Coding chat feed. A hover action bar appears at the bottom-right of assistant messages, featuring a single-click Copy button with visual feedback.

## Requirements & Scope

### In Scope
- Hover action bar placed at the bottom-right of each assistant message (`.chat-msg.assistant`).
- Copy button utilizing `lucide-react` `Copy` and `Check` icons.
- Visual state change on click: converts icon to `Check` (green `#22c55e`), updates title to "Copied!", and reverts after 2 seconds.
- Dark & Light theme support consistent with design tokens in `src/renderer/src/styles.css`.

### Out of Scope
- Copying user prompt messages (assistant messages only).
- Copying intermediate tool execution outputs (tool cards already have independent diff viewing).

## User Interface & Styling

### Markup & Component Structure (`ChatPanel.tsx`)
In `FeedMessage` inside `ChatPanel.tsx`, assistant messages render a bottom action container (`chat-msg-actions`) containing the copy button:

```tsx
const [copied, setCopied] = useState(false)

const handleCopy = useCallback(() => {
  if (!text) return
  void navigator.clipboard.writeText(text)
  setCopied(true)
  setTimeout(() => setCopied(false), 2000)
}, [text])
```

### CSS Styling (`src/renderer/src/styles.css`)
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

## State & Verification
- State is managed locally within each `FeedMessage` component instance (`copied` boolean timer).
- Unit tests to verify copy handler invocation and state toggle.
