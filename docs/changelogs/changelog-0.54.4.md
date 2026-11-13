# Changelog — Meow Coding v0.54.3 → v0.54.4

## 🚀 New Features

### Collapsible long user messages in chat
- Long user messages (over 6 lines or 350 characters) are now automatically collapsed with a "Xem thêm" (Show more) toggle and a gradient fade, keeping the chat feed clean and readable. Clicking the toggle expands the message and allows collapsing it back with "Thu gọn" (Show less).

## 🐛 Bug Fixes
- UI: fixed mention text rendering inside collapsed user messages.

## 🧹 Internal & Docs
- Added collapsible message state in `FeedMessage` inside `ChatPanel.tsx` along with corresponding CSS styling.
