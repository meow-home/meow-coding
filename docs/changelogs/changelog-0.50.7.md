# Changelog — Meow Coding v0.50.6 → v0.50.7

## 🚀 New Features

### The prompt popup is part of the conversation
- The permission/question prompt is now the last row of the chat feed instead of being pinned above the composer, so it scrolls with the transcript it interrupts (the meow-chatui `PromptCard` placement).
- A prompt that arrives while you are reading history is scrolled into view, since the agent stays blocked until it is answered.

### Answers land in the feed
- Answering a `question` prompt appends your answer to the feed as a real user message, right after the question's tool card, so the transcript reads as a conversation.
- The model receives it as a user turn as well, which means it sees the answer as context and not only as a tool result.

### Skip a question
- A question prompt now offers **Skip**: it declines to answer and ends the turn, so you no longer have to reach for the composer's Stop button.
- The tool reports the question as unanswered, so the next turn still sees it. Permission prompts are unchanged — Deny already covers them.

## 🐛 Bug Fixes
- Chat: a long question prompt no longer scrolls inside its own card; the card grows and the feed scrolls, instead of nesting a second scrollbar inside the already-scrolling transcript.
- Chat: the prompt header is no longer sticky — with no inner scroll container it would have pinned itself to the feed's top edge while the card was in view.

## 🧹 Internal & Docs
- Added `tests/e2e/question-echo.spec.ts`, whose mock LLM streams a real `tool_calls` turn so the `question` tool runs end to end.
- Added tests in `tests/unit/agent-tools.test.ts`, `tests/unit/agent-loop.test.ts`, `tests/unit/chat-panel-events.test.ts` and `tests/e2e/prompt.spec.ts`.
- Updated `src/main/agent/AGENTS.md`, `src/main/agent/tools/AGENTS.md`, `src/renderer/src/components/chat/AGENTS.md`, `tests/e2e/AGENTS.md`, `docs/reference/03-agent-runtime.md`, `docs/reference/04-tool-catalog.md`, `docs/reference/05-ipc-contract.md` and `docs/reference/09-ui-guide.md`.
