# Changelog — Meow Coding v0.40.0 → v0.41.0

## 🚀 New Features

### Agent loop robustness
- The agent stays productive on open models behind OpenAI-compatible endpoints (Ollama, local `meow-gateway`): a per-response guard now cuts tool-call floods, character-level repetition, and interleaved text/reasoning, and a rewritten loop detector reports poll/repeat verdicts per call instead of firing accusatory nudges.
- `bash_output` now waits for new output with a `wait_s` option (default 15s), replacing the busy-poll pattern and its "you keep repeating…" recovery nudges.
- Added per-model sampling presets (`meow.json` overrides) and invalid tool-call marking.
- Reasoning is replayed only for the current turn instead of leaking into past assistant messages; the stub `execute` on tool definitions was dropped.
- Tool calls are scheduled in order-preserving batches (concurrency-safe tools run in parallel, others serial), and `Stop` is honored between batches with looped output trimmed on cuts.
- `max_tokens` is now always sent, capped by a 32k default reserve (or your `maxOutputTokens` override) and adjusted with the context reserve.

## 🐛 Bug Fixes
- **Chat**: fixed duplicated assistant bubbles so a retried thought no longer visibly "repeats" — one bubble per model step, with discarded repeating output dropped.
- **Chat**: centered the feed and composer in one shared lane.

## 🧹 Internal & Docs
- Added a response guard, tool scheduler, harness notes, and a character-level tandem-repeat detector as separate, tested modules.
- Added design spec and implementation plan for the agent-loop robustness work, and updated the agent-runtime, tool-catalog, providers and UI-guide reference pages.
