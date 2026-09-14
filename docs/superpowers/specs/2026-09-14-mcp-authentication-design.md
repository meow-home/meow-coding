# MCP Authentication (HTTP Headers) Design Spec

## Overview
This specification details the addition of authentication support for HTTP (URL-based) Model Context Protocol (MCP) servers in Meow Coding. Users can configure HTTP headers (such as `Authorization: Bearer <token>` or `X-Api-Key: <key>`) directly in the MCP server configuration (`meow.json`) and through the Settings UI.

## Requirements & Goals
- Support custom HTTP headers (`headers?: Record<string, string>`) for HTTP-based MCP servers.
- Allow users to configure headers directly in `meow.json` and in the MCP Settings UI (`McpTab.tsx`).
- Provide convenient UI controls in `McpTab.tsx` for entering Bearer tokens and key-value HTTP headers.
- Mask sensitive header values in the UI for security.
- Pass configured headers to the `@modelcontextprotocol/sdk` transport (`StreamableHTTPClientTransport`) when connecting.

## Data Model & Config Changes

### 1. Shared Types (`src/shared/types.ts`)
Extend `McpServerConfig` interface:
```typescript
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
```

### 2. Config Normalization (`src/main/agent/config.ts`)
Update `normalizeMcp()` in `src/main/agent/config.ts`:
- Preserve `headers` if defined.
- Filter out empty keys or values from `headers`.
- Omit `headers` property if empty.

## Backend Implementation

### `src/main/agent/mcp/manager.ts`
Update `McpManager.makeTransport(cfg)`:
When creating `StreamableHTTPClientTransport` for a URL server:
```typescript
if (cfg.url) {
  const headers = cfg.headers && Object.keys(cfg.headers).length > 0 ? cfg.headers : undefined
  return new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: headers ? { headers } : undefined
  })
}
```

## UI Implementation

### `src/renderer/src/components/settings/McpTab.tsx`
- **Add / Edit Modal:**
  - When server type is `url`, provide input fields for:
    - **URL**
    - **Bearer Token** (shortcut setting `Authorization: Bearer <token>`)
    - **Custom Headers** (dynamic Key-Value list)
- **Card Display:**
  - Show header count or configured header keys.
  - Mask header values for display security.

## Verification & Testing
- **Unit Tests:**
  - `tests/unit/agent-mcp-spawn.test.ts`: Test that `makeTransport` passes `requestInit.headers` to `StreamableHTTPClientTransport`.
  - Config normalization tests in `tests/unit/config.test.ts`.
- **Type Checking & Tests:**
  - Run `npm run typecheck` and `npm test` to ensure clean build and passing tests.
