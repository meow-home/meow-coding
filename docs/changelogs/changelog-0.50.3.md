# Changelog — Meow Coding v0.50.2 → v0.50.3

## 🐛 Bug Fixes
- MCP: an MCP server or tool whose name contained characters such as spaces or dots (e.g. a server named `pms mcp`) broke every request with `Invalid 'tools[N].function.name': string does not match pattern` on providers that validate function names (DeepSeek, OpenAI). Exposed MCP tool names now replace any character outside `[a-zA-Z0-9_-]` with `_` (`mcp__pms_mcp__<tool>`); the tool is still called on the server by its original name.

## 🧹 Internal & Docs
- Added `mcpToolName(server, tool)` in `src/main/agent/mcp/manager.ts`, with a regression test in `tests/unit/agent-mcp-manager.test.ts`.
- Updated `docs/reference/04-tool-catalog.md` and `src/main/agent/mcp/AGENTS.md`.
- Note: an "Always Allow" saved for such a server under its old (space-containing) name asks once more under the new name.
