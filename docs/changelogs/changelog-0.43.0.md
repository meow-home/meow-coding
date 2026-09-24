# Changelog — Meow Coding v0.42.0 → v0.43.0

## 🚀 New Features

### Compact floating todo pill in the chat
- The todo list no longer occupies a full-width card above the feed — it's now a compact floating pill over the chat's top-right with a progress ring and `done/total` count, so the feed keeps its full height (zero layout shift).
- Hovering (or clicking) the pill opens a dropdown with the full list; the dropdown is capped in height and scrolls internally, so a long todo list never grows beyond the viewport.
- The dropdown is wider and wraps text at word boundaries, so long todo items read cleanly instead of breaking mid-word.

## 🧹 Internal & Docs
- Added an interactive HTML mockup set exploring four todo-list layouts (`docs/design/todo-popup-mockups/`).
- Updated the chat-component and UI-guide reference pages for the new todo pill.
