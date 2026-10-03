# Changelog — Meow Coding v0.50.3 → v0.50.4

## 🐛 Bug Fixes
- DeepSeek: requests failed with `The reasoning_content in the thinking mode must be passed back to the API` when using DeepSeek models over the OpenAI-compatible connection. DeepSeek's thinking mode requires every previous `reasoning_content` to be passed back on requests that carry tools, but Meow replayed reasoning only for the current tool loop, and an assistant message with no reasoning (such as a `[background bash …] exited` notice) was sent without the field at all.
- DeepSeek models (the DeepSeek API, or any model id containing `deepseek` served through another OpenAI-compatible gateway) now get the reasoning of every assistant message replayed, and an empty `reasoning_content` for messages that have none. Other providers and models are unchanged.

## 🧹 Internal & Docs
- Added `LlmClient.echoAllReasoning(model)` in `src/main/agent/llm.ts` and `ToLlmOptions.echoAllReasoning` in `src/main/agent/message.ts`; `SessionRunner` sets the option per run.
- Added tests in `tests/unit/agent-message.test.ts` and `tests/unit/agent-llm.test.ts`.
- Updated `docs/reference/07-providers-and-connections.md` and `src/main/agent/AGENTS.md`.
