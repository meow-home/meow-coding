# AGENTS.md — src/main/agent/mcp

Model Context Protocol support: connects to MCP servers configured in `meow.json`, lists their
tools, and exposes them to the Meow agent as `ToolDefinition`s alongside the built-in registry.

## Key files

| File | Responsibility |
|---|---|
| `manager.ts` | `McpManager`: `connect(servers)` (closeAll → per-server client), `getTools()`, `getStatus()`, `closeAll()` on dispose. Also defines `McpServerConfig` type + status shape. `McpManagerDeps` accepts `truncation` (`TruncationStore`) + `getMcpOutputMaxTokens`; the `run` wrapper truncates output exceeding the cap (default `DEFAULT_MCP_OUTPUT_TOKENS` 25000) to a head/tail preview + file path. |

## Conventions

- MCP tools are merged into the agent tool map in `MeowAgentManager.syncTools()` — after user tools, before nothing else.
- Server config comes from `meow.json` `mcp` field; status surfaced via `getMcpStatus` IPC. Supports stdio commands, SSE endpoints (`SSEClientTransport`), and Streamable HTTP endpoints (`StreamableHTTPClientTransport`) with optional HTTP headers (`headers?: Record<string, string>`) and `transportType` (`auto` fallback, `sse`, `streamable-http`). Connections use per-server timeouts (10s), parallel connection execution, permissive tool schema parsing (`PermissiveListToolsResultSchema`), and auto-fallback with clean resource closing on errors.
- Only the main process talks to MCP servers; failures mark the server `error` in status without crashing.
