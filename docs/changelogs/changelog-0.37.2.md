# Changelog — Meow Coding v0.37.1 → v0.37.2

## 🐛 Bug Fixes
- **Reasoning models**: Fixed replayed tool-call turns dropping the assistant's `reasoning_content`, which made thinking-mode providers (e.g. DeepSeek) reject the request with _"reasoning_content in the thinking mode must be passed back to the API"_. This surfaced right after a tool ran (Monitor, BashOutput, etc.), because that assistant turn is replayed to attach the tool result.

## 🧹 Internal & Docs
- **Agent messages**: `toLlmMessages` now reads `reasoning` when reconstructing the assistant message and emits the reasoning block before the text and tool-call parts, matching the order the model produced it.
- **Testing**: Added a regression test verifying the assistant reasoning is echoed back ahead of its text and tool calls.
- Bumped application version to `v0.37.2`.
