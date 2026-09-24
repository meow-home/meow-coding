# Changelog — Meow Coding v0.44.1 → v0.44.2

## 🚀 New Features

### Todo pill moved into the pane header
- The todo pill now sits inline in the pane title bar, immediately left of the `⋮` action button, instead of floating over the chat feed.
- Dropped the neon-blue outline/glow: the pill is now a compact chip (orange `TODO` tag, progress ring + count, pulsing status dot) that matches the header's quiet styling.
- The dropdown now opens below-right of the pill (`bottom-end`), consistent with the header's action menu.

## 🧹 Internal & Docs
- Lifted the todo list state up from `ChatPanel` to `Pane` so the header pill (a sibling of the panel) can render it.
- Updated the chat-component and UI-guide reference pages for the pill's new location and styling.
