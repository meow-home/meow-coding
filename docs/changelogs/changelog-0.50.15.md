# Changelog — Meow Coding v0.50.14 → v0.50.15

## 🐛 Bug Fixes
- Chat: the tool-call args line no longer looks oversized next to thought/prose text — mono text now scales by `--fs-mono-scale` (0.9).
- Chat: a loose `Thought N words` row now wears the same chrome-less style as the `Ran a command` group header (no left rule, no leading caret, trailing chevron) instead of its own bordered note.

## 🧹 Internal & Docs
- Document `--fs-mono-scale` and the unified thought row in `docs/reference/09-ui-guide.md`, `src/renderer/AGENTS.md` and the chat module's `AGENTS.md`.
