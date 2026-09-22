# Changelog — Meow Coding v0.39.0 → v0.39.1

## 🐛 Bug Fixes
- **Chat**: The Todo List no longer crashes the chat view ("TypeError: todos.filter is not a function") when a session's stored `todos` value is corrupted (a string instead of an array). The `todowrite` tool now sanitizes malformed input before persisting, `parseSessionJsonl` heals an already-damaged record to an empty list, and the chat pane guards against a non-array defensively.

## 🧹 Internal & Docs
- Added validation on the todo write path, a coercion guard on the JSONL read path, and a render guard in `ChatPanel`, all defended with new unit tests.
- Updated `src/main/agent/tools/AGENTS.md`, `src/main/agent/AGENTS.md` and the `docs/reference/` storage/tool-catalog pages to document the sanitization behavior.
