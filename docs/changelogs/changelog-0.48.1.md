# Changelog — Meow Coding v0.48.0 → v0.48.1

## 🚀 Improvements

### Taller todo list dropdown
- The todo pill dropdown now grows up to `min(60vh, 28rem)` instead of a flat `16rem`, so a long todo list shows roughly twice as many items before it starts scrolling.
- On short windows the dropdown shrinks with the viewport, and it still clamps itself when the pill sits near a screen edge.

## 📱 Mobile Remote Control — Coming Soon
- Developing WS relay, pairing code, and mobile chat sync.
- Stay tuned — mobile companion app is in active development 🚧.

## 🧹 Internal & Docs
- Updated the `TodoPill.tsx` entry in `src/renderer/src/components/chat/AGENTS.md` with the new height cap.
