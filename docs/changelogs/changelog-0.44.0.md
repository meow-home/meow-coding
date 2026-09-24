# Changelog — Meow Coding v0.43.0 → v0.44.0

## 🚀 New Features

### Redesigned mission-badge todo pill in the chat
- The floating todo pill is now a high-visibility "mission badge": an orange `TODO` tag, a progress ring + `done/total` count, and a pulsing cyan status dot while work remains — so the current progress is readable at a glance.
- The dropdown is wider, gets a stronger border and backdrop blur, and highlights the in-progress row so the active step stands out.
- Removed the small active-task text line next to the count to keep the pill compact.

## 🧹 Internal & Docs
- Added an interactive HTML mockup set exploring five prominent todo-pill layouts (`docs/design/todo-popup-mockups/`).
- Added an implementation plan for external delegation from Claude to Meow (`docs/superpowers/plans/`).
- Updated the chat-component and UI-guide reference pages for the redesigned todo pill.
