# MCP Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HTTP Headers (Bearer Token / API Key) authentication support for URL-based MCP servers across shared types, config normalization, main process transport creation, and renderer settings UI.

**Architecture:** Extend `McpServerConfig` with an optional `headers?: Record<string, string>` property. Update `normalizeMcp` in `config.ts` to sanitize headers. In `McpManager.makeTransport`, pass headers into `StreamableHTTPClientTransport` options. Enhance `McpTab.tsx` with Bearer token shortcut and custom headers key-value inputs, with masked preview in server cards.

**Tech Stack:** React 19, TypeScript, Electron, `@modelcontextprotocol/sdk`, Vitest.

## Global Constraints

- Do not introduce breaking changes to existing `McpServerConfig` fields (`command`, `args`, `env`, `url`).
- Only pass `headers` to `StreamableHTTPClientTransport` when `cfg.url` is present and headers object is non-empty.
- Mask secret values in UI views.
- No `Co-Authored-By` in git commits.
- Pass `npm run typecheck` and `npm test` after changes.

---

### Task 1: Update Data Model and Config Normalization

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/agent/config.ts`
- Modify: `tests/unit/config.test.ts` (or `tests/unit/ipc-contract.test.ts`)

**Interfaces:**
- Consumes: Existing `McpServerConfig` interface and `normalizeMcp` helper function.
- Produces: Updated `McpServerConfig` with `headers?: Record<string, string>`, and `normalizeMcp` handling header sanitization.

- [ ] **Step 1: Write the failing unit test for header normalization**

Add a test in `tests/unit/config.test.ts` checking `normalizeMcp`:
```typescript
it('normalizes mcp headers by trimming keys/values and omitting empty headers', () => {
  const input = {
    myMcp: {
      url: 'https://example.com/mcp',
      headers: {
        ' Authorization ': ' Bearer token123 ',
        'X-Api-Key': 'key456',
        ' Empty ': '   '
      }
    }
  }
  const result = normalizeMcp(input)
  expect(result.myMcp.headers).toEqual({
    Authorization: 'Bearer token123',
    'X-Api-Key': 'key456'
  })
})
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL due to missing property or unhandled header normalization.

- [ ] **Step 3: Update `src/shared/types.ts` and `src/main/agent/config.ts`**

In `src/shared/types.ts`:
```typescript
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}
```

In `src/main/agent/config.ts` within `normalizeMcp`:
```typescript
if (cfg.headers && typeof cfg.headers === 'object') {
  const cleanHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.headers)) {
    const key = k.trim()
    const val = typeof v === 'string' ? v.trim() : ''
    if (key && val) cleanHeaders[key] = val
  }
  if (Object.keys(cleanHeaders).length > 0) {
    next.headers = cleanHeaders
  } else {
    delete next.headers
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/agent/config.ts tests/unit/config.test.ts
git commit -m "feat(mcp): add headers field to McpServerConfig and config normalization"
```

---

### Task 2: Pass HTTP Headers in McpManager Transport

**Files:**
- Modify: `src/main/agent/mcp/manager.ts`
- Modify: `tests/unit/agent-mcp-spawn.test.ts`

**Interfaces:**
- Consumes: Updated `McpServerConfig` with `headers`.
- Produces: `McpManager.makeTransport` passing `requestInit: { headers }` to `StreamableHTTPClientTransport`.

- [ ] **Step 1: Write the failing unit test for McpManager HTTP Transport with headers**

In `tests/unit/agent-mcp-spawn.test.ts`, add a test verifying `makeTransport` with HTTP URL and `headers`:
```typescript
it('creates StreamableHTTPClientTransport with requestInit headers when headers specified', () => {
  const mcp = new McpManager({ projectPath: '/proj' })
  const transport = (mcp as unknown as { makeTransport(c: unknown): unknown }).makeTransport({
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer test-token' }
  })
  expect(transport).toBeDefined()
  expect((transport as unknown as { _requestInit: { headers: Record<string, string> } })._requestInit?.headers).toEqual({
    Authorization: 'Bearer test-token'
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/unit/agent-mcp-spawn.test.ts`
Expected: FAIL (headers not passed in requestInit).

- [ ] **Step 3: Update `makeTransport` in `src/main/agent/mcp/manager.ts`**

Update `makeTransport` method in `McpManager`:
```typescript
if (cfg.url) {
  const headers = cfg.headers && Object.keys(cfg.headers).length > 0 ? cfg.headers : undefined
  return new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: headers ? { headers } : undefined
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-mcp-spawn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/mcp/manager.ts tests/unit/agent-mcp-spawn.test.ts
git commit -m "feat(mcp): pass configured HTTP headers to StreamableHTTPClientTransport"
```

---

### Task 3: Update Settings UI (McpTab.tsx) for Header & Token Management

**Files:**
- Modify: `src/renderer/src/components/settings/McpTab.tsx`

**Interfaces:**
- Consumes: Updated `McpServerConfig` with `headers`.
- Produces: UI for adding/editing Bearer token and custom HTTP headers in MCP settings tab, with masked value display in server cards.

- [ ] **Step 1: Add state and inputs for Bearer Token and Custom Headers in McpTab.tsx modal**

In `McpTab.tsx`:
- Add form state for Bearer Token (`bearerToken`) and Custom Key-Value Headers (`headersList: Array<{ key: string, value: string }>`).
- When saving server, construct `headers` record from `bearerToken` (setting `Authorization: Bearer <token>`) and non-empty key-value header entries.
- Add header key-value editor rows with "Add Header" and remove buttons in the modal.

- [ ] **Step 2: Display header summary and masked header preview in MCP Server Card**

In `McpTab.tsx` server card rendering:
- Show header count badge (e.g. `2 headers`).
- Show configured header keys with masked values (e.g. `Authorization: Bearer ••••••••`).

- [ ] **Step 3: Run typecheck & tests to verify UI build**

Run: `npm run typecheck` and `npm test`
Expected: All pass with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/McpTab.tsx
git commit -m "feat(mcp): add Bearer Token and Custom Headers controls to MCP settings UI"
```

---

### Task 4: Full System Verification and AGENTS.md & Docs Update

**Files:**
- Modify: `src/main/agent/mcp/AGENTS.md`
- Modify: `docs/reference/05-mcp-and-tools.md` (if existing) or reference docs

- [ ] **Step 1: Update module AGENTS.md and reference docs**

Update `src/main/agent/mcp/AGENTS.md` to note `headers` support for HTTP MCP servers.

- [ ] **Step 2: Run complete typecheck and unit test suite**

Run: `npm run typecheck && npm test`
Expected: PASS (100%)

- [ ] **Step 3: Commit documentation and final adjustments**

```bash
git add src/main/agent/mcp/AGENTS.md docs/
git commit -m "docs: update MCP module docs with HTTP header auth support"
```
