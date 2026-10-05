# Changelog — Meow Coding v0.50.4 → v0.50.5

## 🐛 Bug Fixes
- MCP: a second call to the same MCP tool overwrote the full-output file named in the first call's preview, so the path the model had been given pointed at the wrong result. Truncated MCP output is now keyed by the tool call id instead of the tool name.
- MCP: verbose JSON results are pretty-printed before being written to disk, so the line-based `read` tool can page past its per-call character cap instead of hitting one minified line.

## 🧹 Internal & Docs
- `ToolContext` gained `callId` (`src/main/agent/tools/types.ts`), set by `SessionRunner` in `src/main/agent/loop.ts`; `McpManager` uses it as the truncation file key.
- Added `prettyJson` in `src/main/agent/truncation.ts`; non-JSON text is stored verbatim.
- Added tests in `tests/unit/agent-mcp-manager.test.ts` and `tests/unit/agent-truncation.test.ts`.
- Updated `docs/reference/03-agent-runtime.md`, `docs/reference/06-data-and-storage.md`, `docs/reference/08-integrations.md` and `src/main/agent/mcp/AGENTS.md`.
