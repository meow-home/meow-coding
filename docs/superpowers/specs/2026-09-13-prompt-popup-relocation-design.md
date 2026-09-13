# Prompt Popup Relocation & Background Theme Alignment Design

**Date:** 2026-09-13

## Overview

Currently, when the agent requests permission or asks a question via the `question` tool, the prompt popup box (`.chat-prompt`) is passed into `ChatInput` via the `promptSlot` prop and rendered inside the `.chat-input` card. This embeds the popup inside the border box of the chat text field and uses a different background color (`var(--bg-raised)`).

This design moves the prompt popup out of `.chat-input` and places it directly inside `.chat-composer` as an independent card positioned immediately above `<ChatInput>`. It also aligns `.chat-prompt`'s background color with `.chat-input` (`var(--bg-chat)`).

## Target Layout Structure

Inside `ChatPanel.tsx`, the composer container `.chat-composer` will have the following child order:

```html
<div className="chat-composer">
  <!-- 1. Prompt popup card (Permission / Question) -->
  {pendingPrompt && (
    <div className="chat-prompt" ...>
      ...
    </div>
  )}

  <!-- 2. Chat Input field card -->
  <ChatInput
    ref={chatInputRef}
    agentId={agentId}
    running={running}
    mode={currentMode}
    commands={commands}
    editTarget={editTarget}
    onSubmit={send}
    onEditSubmit={...}
    onEditCancel={...}
    onStop={handleStop}
  />

  <!-- 3. Bottom controls footer -->
  <div className="chat-footer">
    ...
  </div>
</div>
```

## Detailed Changes

### 1. `ChatPanel.tsx`
- Remove `promptSlot` from `<ChatInput ... />`.
- Move the `{pendingPrompt && (...)}` prompt container JSX up so it renders as the first element inside `<div className="chat-composer">`.

### 2. `ChatInput.tsx`
- Remove `promptSlot?: React.ReactNode` from the `Props` interface.
- Remove `{promptSlot}` from the returned JSX inside `div.chat-input`.

### 3. `styles.css`
- Update `.chat-prompt` background property from `background: var(--bg-raised)` to `background: var(--bg-chat)` so it matches the background tone of `.chat-input`.

## Verification Strategy
- Run `npm run typecheck` to verify TypeScript types after prop changes.
- Run `npm test` to ensure existing unit and integration tests pass.
