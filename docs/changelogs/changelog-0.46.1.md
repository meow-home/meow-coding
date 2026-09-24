# Changelog — Meow Coding v0.46.0 → v0.46.1

## 🚀 Improvements

### Todo pill progress ring & sizing
- Replaced the conic-gradient progress indicator with an SVG progress ring matching the context readout style.
- Increased button height to `2rem` (32px) for improved hit target and alignment.
- Removed the darker border on hover for consistent quiet styling.

## 🐛 Bug Fixes
- Chat: removed the Tab keyboard shortcut that toggled between Build and Plan mode, avoiding accidental mode switching during input and navigation.

## 🧹 Internal & Docs
- Fixed test line-ending assertions for external API Claude skill tests on Windows.
- Updated component documentation in `src/renderer/src/components/chat/AGENTS.md`.
