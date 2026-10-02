# Browser Bridge — One-Click Extension Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed 6-digit pairing code with an extension-ID allowlist plus a one-click approval in the app.

**Architecture:** The extension announces itself with `{ type: 'hello', extensionId }` when the WebSocket opens; the bridge accepts it only when the handshake `Origin` header equals `chrome-extension://<claimed id>`, then either pairs silently (id already in `userData/browser-trusted.json`) or parks the socket in a new `pending` status until the renderer approves or denies it. The old code path is removed in Task 8, after its last caller is gone — every task leaves the tree green.

**Tech Stack:** Electron 41 main process, `ws` 8, React 19 renderer, Chrome MV3 extension (esbuild), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-browser-bridge-extension-approval-design.md`

## Global Constraints

- The bridge binds `127.0.0.1` only; never expose it to the network.
- Never hardcode IPC channel strings — only `Channels` from `src/shared/ipc.ts`.
- `src/shared` must not import Node or Electron.
- Only the main process spawns/closes sockets; the renderer goes through `window.api`.
- Source code, UI labels and system notifications are English.
- No `Co-Authored-By` trailer in commits.
- Do not add narration comments; comment only non-obvious decisions.
- Popups/dropdowns use the common components (`BaseModal`, `BaseDropdown`, `BaseSelect`).
- `npm run typecheck` and `npm test` must pass at the end of every task.
- Pending approval TTL: 2 minutes (`120_000` ms). Command timeout stays 30s.

## Review Focus

Inputs and failure modes the spec implies that are most likely to bite a user of this software:

1. A **web page or local process** connecting to `127.0.0.1:3927` and sending `hello` with a *trusted* extension id but a non-extension `Origin` — a reasonable person expects this to be rejected. (Task 3)
2. An **unknown extension** connecting while another extension is already paired — the paired connection must survive. (Task 8)
3. **Two unknown extensions racing**: only the one the user approved may end up paired. (Task 3)
4. `approve` / `deny` / `revoke` called with an id that is neither the pending nor the paired one — must be a no-op, never corrupt state. (Task 3)
5. The paired socket closing **mid-command** (revoke, Chrome restart) — in-flight commands must fail fast, not hang for 30s. (Task 8)

---

### Task 1: Shared protocol types (additive)

**Files:**
- Modify: `src/shared/browser-types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BrowserStatus` gains `'pending'`; `PendingExtensionInfo { extensionId: string; version?: string; requestedAt: number }`; `BrowserStatusInfo.pendingExtension?: PendingExtensionInfo`; `TrustedExtension { id: string; version?: string; approvedAt: number }`; `HelloMessage { type: 'hello'; extensionId: string; version?: string }`; `HelloResultMessage { type: 'hello_result'; ok: boolean; paired: boolean; pending?: boolean; error?: string }`. The old `PairMessage` / `PairResultMessage` / `PairingInfo` / `pairingCode` stay until Task 8.

- [ ] **Step 1: Add the new status value and the pending info type**

In `src/shared/browser-types.ts`, replace:

```ts
export type BrowserStatus = 'idle' | 'listening' | 'paired' | 'disconnected' | 'error'

export interface BrowserStatusInfo {
  status: BrowserStatus
  port: number
  paired: boolean
  pairingCode?: string
  pairingExpiresAt?: number
}
```

with:

```ts
export type BrowserStatus = 'idle' | 'listening' | 'pending' | 'paired' | 'disconnected' | 'error'

export interface PendingExtensionInfo {
  extensionId: string
  version?: string
  requestedAt: number
}

export interface BrowserStatusInfo {
  status: BrowserStatus
  port: number
  paired: boolean
  pairingCode?: string
  pairingExpiresAt?: number
  pendingExtension?: PendingExtensionInfo
}

export interface TrustedExtension {
  id: string
  version?: string
  approvedAt: number
}
```

- [ ] **Step 2: Add the hello messages**

In the same file, replace:

```ts
export interface PairMessage { type: 'pair'; code: string }
export interface PairResultMessage { type: 'pair_result'; ok: boolean; error?: string }
```

with:

```ts
export interface PairMessage { type: 'pair'; code: string }
export interface PairResultMessage { type: 'pair_result'; ok: boolean; error?: string }
export interface HelloMessage { type: 'hello'; extensionId: string; version?: string }
export interface HelloResultMessage {
  type: 'hello_result'
  ok: boolean
  paired: boolean
  pending?: boolean
  error?: string
}
```

and replace:

```ts
export type ExtensionToBridge = PairMessage | ResultMessage | EventMessage | PingMessage
export type BridgeToExtension = PairResultMessage | CmdMessage | PongMessage
```

with:

```ts
export type ExtensionToBridge = PairMessage | HelloMessage | ResultMessage | EventMessage | PingMessage
export type BridgeToExtension = PairResultMessage | HelloResultMessage | CmdMessage | PongMessage
```

- [ ] **Step 3: Verify the tree still typechecks**

Run: `npm run typecheck`
Expected: PASS (nothing consumes the new types yet; the old ones are untouched).

- [ ] **Step 4: Commit**

```bash
git add src/shared/browser-types.ts
git commit -m "feat(browser): add hello handshake and pending-approval types"
```

---

### Task 2: Trusted-extension store

**Files:**
- Create: `src/main/browser/trusted-store.ts`
- Test: `tests/unit/browser/trusted-store.test.ts`

**Interfaces:**
- Consumes: `TrustedExtension` from `src/shared/browser-types.ts` (Task 1); `JsonStore<T>` from `src/main/json-store.ts`.
- Produces: `class TrustedExtensionStore` with `constructor(store?: JsonStore<TrustedExtension>)`, `list(): TrustedExtension[]`, `has(id: string): boolean`, `approve(id: string, version?: string): TrustedExtension[]`, `revoke(id: string): TrustedExtension[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/browser/trusted-store.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../../src/main/json-store'
import { TrustedExtensionStore } from '../../../src/main/browser/trusted-store'
import type { TrustedExtension } from '../../../src/shared/browser-types'

const dirs: string[] = []

function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-trusted-'))
  dirs.push(d)
  return path.join(d, 'browser-trusted.json')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('TrustedExtensionStore', () => {
  it('starts empty when the file does not exist', () => {
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(tmpFile()))
    expect(s.list()).toEqual([])
    expect(s.has('abc')).toBe(false)
  })

  it('approves an id and persists it across instances', () => {
    const file = tmpFile()
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    s.approve('abc', '0.3.4')
    expect(s.has('abc')).toBe(true)
    expect(s.list()[0]).toMatchObject({ id: 'abc', version: '0.3.4' })

    const reloaded = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    expect(reloaded.has('abc')).toBe(true)
  })

  it('re-approving the same id updates it instead of duplicating', () => {
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(tmpFile()))
    s.approve('abc', '0.3.4')
    s.approve('abc', '0.3.5')
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0].version).toBe('0.3.5')
  })

  it('revokes an id and persists the removal', () => {
    const file = tmpFile()
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    s.approve('abc')
    s.revoke('abc')
    expect(s.has('abc')).toBe(false)

    const reloaded = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    expect(reloaded.list()).toEqual([])
  })

  it('works in memory when no store is injected', () => {
    const s = new TrustedExtensionStore()
    s.approve('abc')
    expect(s.has('abc')).toBe(true)
    s.revoke('abc')
    expect(s.has('abc')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/browser/trusted-store.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/main/browser/trusted-store"`.

- [ ] **Step 3: Write the store**

Create `src/main/browser/trusted-store.ts`:

```ts
import type { TrustedExtension } from '../../shared/browser-types'
import type { JsonStore } from '../json-store'

export class TrustedExtensionStore {
  private items: TrustedExtension[] | null = null

  constructor(private store?: JsonStore<TrustedExtension>) {}

  list(): TrustedExtension[] {
    if (!this.items) this.items = this.store?.load() ?? []
    return this.items
  }

  has(id: string): boolean {
    return this.list().some(e => e.id === id)
  }

  approve(id: string, version?: string): TrustedExtension[] {
    const next = this.list().filter(e => e.id !== id)
    next.push({ id, ...(version ? { version } : {}), approvedAt: Date.now() })
    this.items = next
    this.store?.save(next)
    return next
  }

  revoke(id: string): TrustedExtension[] {
    const next = this.list().filter(e => e.id !== id)
    this.items = next
    this.store?.save(next)
    return next
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/browser/trusted-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/trusted-store.ts tests/unit/browser/trusted-store.test.ts
git commit -m "feat(browser): add the trusted-extension store"
```

---

### Task 3: Bridge hello handshake, allowlist and pending approval

**Files:**
- Modify: `src/main/browser/bridge.ts`
- Test: `tests/unit/browser/bridge.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `TrustedExtensionStore` (Task 2); `HelloMessage` / `HelloResultMessage` / `PendingExtensionInfo` / `TrustedExtension` (Task 1).
- Produces: `BridgeDeps.trusted?: TrustedExtensionStore`, `BridgeDeps.pendingTtlMs?: number`; `BrowserBridge.approveExtension(extensionId: string): BrowserStatusInfo`, `denyExtension(extensionId: string): BrowserStatusInfo`, `revokeExtension(extensionId: string): BrowserStatusInfo`, `getTrustedExtensions(): TrustedExtension[]`. `pair()` and the code path still work (removed in Task 8).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/browser/bridge.test.ts` (keep everything already in the file):

```ts
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`

function connectWithOrigin(port: number, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function hello(ws: WebSocket, extensionId = EXT_ID, version = '0.3.4'): void {
  ws.send(JSON.stringify({ type: 'hello', extensionId, version }))
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise(resolve => ws.once('close', () => resolve()))
}

describe('BrowserBridge extension approval', () => {
  it('pairs silently when the extension id is already trusted', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID, '0.3.4')
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().status).toBe('paired')
    expect(b.getStatus().pendingExtension).toBeUndefined()
    ws.close()
  })

  it('asks for approval when the extension id is unknown', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore() })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: false, pending: true })
    const status = b.getStatus()
    expect(status.status).toBe('pending')
    expect(status.paired).toBe(false)
    expect(status.pendingExtension).toMatchObject({ extensionId: EXT_ID, version: '0.3.4' })
    ws.close()
  })

  it('rejects a hello whose origin does not match the claimed id', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID, '0.3.4')
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, 'https://evil.example')
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: false })
    await closed(ws)
    expect(b.getStatus().paired).toBe(false)
    expect(b.getStatus().status).toBe('listening')
  })

  it('approveExtension pairs the pending socket and persists the id', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.approveExtension(EXT_ID)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(info.status).toBe('paired')
    expect(info.pendingExtension).toBeUndefined()
    expect(trusted.has(EXT_ID)).toBe(true)
    ws.close()
  })

  it('approveExtension with a different id is a no-op', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.approveExtension('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
    expect(info.status).toBe('pending')
    expect(trusted.has('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false)
    expect(trusted.has(EXT_ID)).toBe(false)
    ws.close()
  })

  it('denyExtension closes the pending socket and clears the approval', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.denyExtension(EXT_ID)
    await closed(ws)
    expect(info.status).toBe('listening')
    expect(info.pendingExtension).toBeUndefined()
    expect(trusted.has(EXT_ID)).toBe(false)
  })

  it('revokeExtension disconnects the paired extension', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)
    expect(b.getStatus().paired).toBe(true)

    const info = b.revokeExtension(EXT_ID)
    await closed(ws)
    expect(info.status).toBe('listening')
    expect(info.paired).toBe(false)
    expect(trusted.has(EXT_ID)).toBe(false)
  })

  it('drops a pending approval after the ttl', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore(), pendingTtlMs: 50 })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)
    await closed(ws)

    expect(b.getStatus().status).toBe('listening')
    expect(b.getStatus().pendingExtension).toBeUndefined()
  })

  it('replaces the pending extension when a second unknown one connects', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const first = await connectWithOrigin(port, EXT_ORIGIN)
    hello(first)
    await nextMsg(first)

    const secondId = 'ponmlkjihgfedcbaponmlkjihgfedcba'
    const second = await connectWithOrigin(port, `chrome-extension://${secondId}`)
    hello(second, secondId)
    await nextMsg(second)

    await closed(first)
    expect(b.getStatus().pendingExtension?.extensionId).toBe(secondId)

    b.approveExtension(secondId)
    expect(await nextMsg(second)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().paired).toBe(true)
    second.close()
  })

  it('re-pairs silently after a reconnect once trusted', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const first = await connectWithOrigin(port, EXT_ORIGIN)
    hello(first)
    await nextMsg(first)
    first.close()
    await new Promise(r => setTimeout(r, 50))

    const second = await connectWithOrigin(port, EXT_ORIGIN)
    hello(second)
    expect(await nextMsg(second)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().paired).toBe(true)
    second.close()
  })

  it('notifies status listeners with the pending extension', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore() })
    const port = await b.start()
    const seen: { status: string; pending?: string }[] = []
    const off = b.onStatusChange(info => seen.push({ status: info.status, pending: info.pendingExtension?.extensionId }))

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    expect(seen).toContainEqual({ status: 'pending', pending: EXT_ID })
    off()
    ws.close()
  })
})
```

Add the store import at the top of the file:

```ts
import { TrustedExtensionStore } from '../../../src/main/browser/trusted-store'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/browser/bridge.test.ts`
Expected: FAIL — the new tests time out waiting for `hello_result` (the bridge ignores `hello`).

- [ ] **Step 3: Add the deps and fields**

In `src/main/browser/bridge.ts`, replace:

```ts
import { createServer, type Server } from 'node:http'
import { randomInt, randomUUID } from 'node:crypto'
```

with:

```ts
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomInt, randomUUID } from 'node:crypto'
```

and add to the type import:

```ts
import type {
  BrowserCommandName, BrowserCommandResult, BrowserEvent, BrowserStatus, BrowserStatusInfo,
  ExtensionToBridge, HelloMessage, HelloResultMessage, PairingInfo, PendingExtensionInfo, TrustedExtension
} from '../../shared/browser-types'
import { TrustedExtensionStore } from './trusted-store'
```

Replace the deps interface:

```ts
export interface BridgeDeps {
  host?: string
  preferredPort?: number
  screenshotDir?: string
  snapshotDir?: string
  codeTtlMs?: number
  maxLogEntries?: number
  createServer?: () => Server
  trusted?: TrustedExtensionStore
  pendingTtlMs?: number
}
```

Add the constant next to the others:

```ts
const DEFAULT_PENDING_TTL_MS = 120_000
```

Add the fields:

```ts
  private pendingExtension: PendingExtensionInfo | null = null
  private pendingSocket: WebSocket | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private pairedExtensionId: string | null = null
  private trusted: TrustedExtensionStore
```

and initialize in the constructor:

```ts
  constructor(private deps: BridgeDeps = {}) {
    this.trusted = deps.trusted ?? new TrustedExtensionStore()
  }
```

- [ ] **Step 4: Report the pending extension in the status**

Replace `getStatus()`:

```ts
  getStatus(): BrowserStatusInfo {
    const paired = this.status === 'paired'
    return {
      status: this.status,
      port: this.port,
      paired,
      ...(paired ? {} : { pairingCode: this.code, pairingExpiresAt: this.codeExpiresAt || undefined }),
      ...(this.pendingExtension ? { pendingExtension: this.pendingExtension } : {})
    }
  }
```

Replace `setStatus` with an always-emitting pair of methods (a second unknown extension changes
`pendingExtension` while the status stays `pending`, so the dedupe would swallow that update):

```ts
  private setStatus(status: BrowserStatus): void {
    this.status = status
    this.emitStatus()
  }

  private emitStatus(): void {
    const info = this.getStatus()
    for (const cb of this.statusListeners) cb(info)
  }
```

- [ ] **Step 5: Handle the hello message**

In `handleConnection`, replace the signature and the message dispatch:

```ts
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close()
    }
    this.socket = ws
    const origin = req.headers.origin
    this.setStatus(this.code && Date.now() < this.codeExpiresAt ? 'listening' : 'idle')

    ws.on('message', (raw) => {
      let msg: ExtensionToBridge
      try {
        msg = JSON.parse(String(raw)) as ExtensionToBridge
      } catch {
        return
      }
      if (msg.type === 'pair') this.handlePair(ws, msg.code)
      else if (msg.type === 'hello') this.handleHello(ws, origin, msg)
      else if (msg.type === 'result') this.handleResult(msg.id, msg)
      else if (msg.type === 'event') this.handleEvent(msg.name, msg.data)
      else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })
```

and update the `wss.on('connection')` registration in `start()`:

```ts
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
```

Add the new methods after `handlePair`:

```ts
  private handleHello(ws: WebSocket, origin: string | undefined, msg: HelloMessage): void {
    // The claimed id is only trustworthy when the handshake Origin matches it: a web
    // page or a local process can send any id, but cannot forge a chrome-extension:// origin.
    if (!msg.extensionId || origin !== `chrome-extension://${msg.extensionId}`) {
      ws.send(JSON.stringify({
        type: 'hello_result', ok: false, paired: false, error: 'origin mismatch'
      } satisfies HelloResultMessage))
      ws.close()
      return
    }
    if (this.trusted.has(msg.extensionId)) {
      this.clearPending()
      this.pairedExtensionId = msg.extensionId
      this.setStatus('paired')
      ws.send(JSON.stringify({ type: 'hello_result', ok: true, paired: true } satisfies HelloResultMessage))
      return
    }
    if (this.pendingSocket && this.pendingSocket !== ws) this.pendingSocket.close()
    this.pendingSocket = ws
    this.pendingExtension = {
      extensionId: msg.extensionId,
      ...(msg.version ? { version: msg.version } : {}),
      requestedAt: Date.now()
    }
    this.armPendingTimer()
    this.setStatus('pending')
    ws.send(JSON.stringify({
      type: 'hello_result', ok: true, paired: false, pending: true
    } satisfies HelloResultMessage))
  }

  private armPendingTimer(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      const socket = this.pendingSocket
      this.clearPending()
      // Detach before closing so the socket's own close handler does not overwrite
      // the status we are about to set (and never touch a paired socket).
      if (this.socket === socket) this.socket = null
      if (this.status === 'pending') this.setStatus(this.pairedExtensionId ? 'paired' : 'listening')
      socket?.close()
    }, this.deps.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS)
  }

  private clearPending(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.pendingExtension = null
    this.pendingSocket = null
  }

  approveExtension(extensionId: string): BrowserStatusInfo {
    if (this.pendingExtension?.extensionId !== extensionId) return this.getStatus()
    const socket = this.pendingSocket
    this.trusted.approve(extensionId, this.pendingExtension.version)
    this.clearPending()
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'hello_result', ok: true, paired: true } satisfies HelloResultMessage))
      this.socket = socket
      this.pairedExtensionId = extensionId
      this.setStatus('paired')
    }
    return this.getStatus()
  }

  denyExtension(extensionId: string): BrowserStatusInfo {
    if (this.pendingExtension?.extensionId !== extensionId) return this.getStatus()
    const socket = this.pendingSocket
    this.clearPending()
    if (this.socket === socket) this.socket = null
    if (this.status === 'pending') this.setStatus(this.pairedExtensionId ? 'paired' : 'listening')
    socket?.close()
    return this.getStatus()
  }

  revokeExtension(extensionId: string): BrowserStatusInfo {
    this.trusted.revoke(extensionId)
    if (this.pairedExtensionId === extensionId) {
      this.socket?.close()
      this.socket = null
      this.pairedExtensionId = null
      this.setStatus('listening')
    }
    return this.getStatus()
  }

  getTrustedExtensions(): TrustedExtension[] {
    return this.trusted.list()
  }
```

- [ ] **Step 6: Clear the pending timer on close**

In `close()`, replace:

```ts
    this.server = null
    this.sessionPaired = false
    this.setStatus('idle')
```

with:

```ts
    this.server = null
    this.sessionPaired = false
    this.clearPending()
    this.pairedExtensionId = null
    this.setStatus('idle')
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/browser/bridge.test.ts`
Expected: PASS — the new `BrowserBridge extension approval` block (11 tests) plus every pre-existing test.

- [ ] **Step 8: Run the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/browser/bridge.ts tests/unit/browser/bridge.test.ts
git commit -m "feat(browser): approve extensions by id with an origin-checked hello"
```

---

### Task 4: IPC surface for approve / deny / revoke

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `BrowserBridge.approveExtension` / `denyExtension` / `revokeExtension` / `getTrustedExtensions` (Task 3); `TrustedExtension` (Task 1).
- Produces: `Channels.BrowserApproveExtension = 'browser:approve-extension'`, `Channels.BrowserDenyExtension = 'browser:deny-extension'`, `Channels.BrowserRevokeExtension = 'browser:revoke-extension'`, `Channels.BrowserGetTrustedExtensions = 'browser:get-trusted-extensions'`; `AgentApi.approveBrowserExtension(id)`, `denyBrowserExtension(id)`, `revokeBrowserExtension(id)`, `getBrowserTrustedExtensions()`. `BrowserPair` / `pairBrowser` stay until Task 8.

- [ ] **Step 1: Write the failing contract test**

In `tests/unit/ipc-contract.test.ts`, add the four methods to the expected-methods array, right after `'getBrowserStatus', 'pairBrowser',`:

```ts
      'approveBrowserExtension', 'denyBrowserExtension', 'revokeBrowserExtension', 'getBrowserTrustedExtensions',
```

add the stubs to the `api` object, right after `pairBrowser: async () => ({ code: '000000', expiresAt: 0 }),`:

```ts
      approveBrowserExtension: async () => ({ status: 'paired', port: 0, paired: true }),
      denyBrowserExtension: async () => ({ status: 'listening', port: 0, paired: false }),
      revokeBrowserExtension: async () => ({ status: 'listening', port: 0, paired: false }),
      getBrowserTrustedExtensions: async () => [],
```

and add the channel assertions, right after `expect(Channels.BrowserPair).toBe('browser:pair')`:

```ts
    expect(Channels.BrowserApproveExtension).toBe('browser:approve-extension')
    expect(Channels.BrowserDenyExtension).toBe('browser:deny-extension')
    expect(Channels.BrowserRevokeExtension).toBe('browser:revoke-extension')
    expect(Channels.BrowserGetTrustedExtensions).toBe('browser:get-trusted-extensions')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ipc-contract.test.ts`
Expected: FAIL — `Channels.BrowserApproveExtension` is undefined.

- [ ] **Step 3: Add the channels and the API methods**

In `src/shared/ipc.ts`, replace:

```ts
  BrowserPair: 'browser:pair',
```

with:

```ts
  BrowserPair: 'browser:pair',
  BrowserApproveExtension: 'browser:approve-extension',
  BrowserDenyExtension: 'browser:deny-extension',
  BrowserRevokeExtension: 'browser:revoke-extension',
  BrowserGetTrustedExtensions: 'browser:get-trusted-extensions',
```

update the type import at the top of the file:

```ts
import type { BrowserStatusInfo, PairingInfo, TrustedExtension } from './browser-types'
```

and replace:

```ts
  pairBrowser(): Promise<PairingInfo>
```

with:

```ts
  pairBrowser(): Promise<PairingInfo>
  approveBrowserExtension(extensionId: string): Promise<BrowserStatusInfo>
  denyBrowserExtension(extensionId: string): Promise<BrowserStatusInfo>
  revokeBrowserExtension(extensionId: string): Promise<BrowserStatusInfo>
  getBrowserTrustedExtensions(): Promise<TrustedExtension[]>
```

- [ ] **Step 4: Expose them through the preload bridge**

In `src/preload/index.ts`, replace:

```ts
  pairBrowser: () => ipcRenderer.invoke(Channels.BrowserPair),
```

with:

```ts
  pairBrowser: () => ipcRenderer.invoke(Channels.BrowserPair),
  approveBrowserExtension: (extensionId: string) => ipcRenderer.invoke(Channels.BrowserApproveExtension, extensionId),
  denyBrowserExtension: (extensionId: string) => ipcRenderer.invoke(Channels.BrowserDenyExtension, extensionId),
  revokeBrowserExtension: (extensionId: string) => ipcRenderer.invoke(Channels.BrowserRevokeExtension, extensionId),
  getBrowserTrustedExtensions: () => ipcRenderer.invoke(Channels.BrowserGetTrustedExtensions),
```

- [ ] **Step 5: Register the handlers and wire the store**

In `src/main/index.ts`, replace:

```ts
  ipcMain.handle(Channels.BrowserPair, () => mainApp.browserBridge.pair())
```

with:

```ts
  ipcMain.handle(Channels.BrowserPair, () => mainApp.browserBridge.pair())
  ipcMain.handle(Channels.BrowserApproveExtension, (_e, extensionId: string) => mainApp.browserBridge.approveExtension(extensionId))
  ipcMain.handle(Channels.BrowserDenyExtension, (_e, extensionId: string) => mainApp.browserBridge.denyExtension(extensionId))
  ipcMain.handle(Channels.BrowserRevokeExtension, (_e, extensionId: string) => mainApp.browserBridge.revokeExtension(extensionId))
  ipcMain.handle(Channels.BrowserGetTrustedExtensions, () => mainApp.browserBridge.getTrustedExtensions())
```

replace:

```ts
  browserBridge = new BrowserBridge({
    screenshotDir: path.join(app.getPath('userData'), 'browser-screenshots'),
    snapshotDir: path.join(app.getPath('userData'), 'browser-snapshots')
  })
```

with:

```ts
  browserBridge = new BrowserBridge({
    screenshotDir: path.join(app.getPath('userData'), 'browser-screenshots'),
    snapshotDir: path.join(app.getPath('userData'), 'browser-snapshots'),
    trusted: new TrustedExtensionStore(
      createJsonStore<TrustedExtension>(path.join(app.getPath('userData'), 'browser-trusted.json'))
    )
  })
```

and add the imports next to the other browser imports:

```ts
import { TrustedExtensionStore } from './browser/trusted-store'
import type { TrustedExtension } from '../shared/browser-types'
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(browser): expose extension approve/deny/revoke over IPC"
```

---

### Task 5: Renderer approval UI

**Files:**
- Modify: `src/renderer/src/components/BrowserDialog.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api.approveBrowserExtension` / `denyBrowserExtension` / `revokeBrowserExtension` / `getBrowserTrustedExtensions` (Task 4); `BrowserStatusInfo.pendingExtension` and `TrustedExtension` (Task 1).
- Produces: the approval modal opens automatically on a pending status; `StatusBar` shows a `pending` pill.

- [ ] **Step 1: Rewrite the dialog**

Replace the whole content of `src/renderer/src/components/BrowserDialog.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  Globe,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Radio,
  Compass,
  ExternalLink,
  FolderOpen,
  Trash2,
  Check,
  X
} from 'lucide-react'
import type { BrowserStatusInfo, TrustedExtension } from '@shared/browser-types'
import BaseModal from './common/BaseModal'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [trusted, setTrusted] = useState<TrustedExtension[]>([])
  const [busy, setBusy] = useState(false)

  const refreshTrusted = useCallback(async () => {
    setTrusted(await window.api.getBrowserTrustedExtensions())
  }, [])

  useEffect(() => {
    void refreshTrusted()
  }, [refreshTrusted])

  const pending = status?.pendingExtension
  const waiting = !status?.paired && !pending && (status?.status === 'listening' || status?.status === 'idle')
  const pillClass = status?.paired ? 'paired' : pending || waiting ? 'waiting' : 'idle'

  const decide = async (approve: boolean) => {
    if (!pending) return
    setBusy(true)
    try {
      if (approve) await window.api.approveBrowserExtension(pending.extensionId)
      else await window.api.denyBrowserExtension(pending.extensionId)
      await refreshTrusted()
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (extensionId: string) => {
    setBusy(true)
    try {
      await window.api.revokeBrowserExtension(extensionId)
      await refreshTrusted()
    } finally {
      setBusy(false)
    }
  }

  const titleNode = (
    <div className="browser-modal-header">
      <div className="browser-modal-title">
        <Globe size={18} style={{ color: 'var(--accent)' }} />
        <span>Browser Bridge</span>
        <span className={`browser-status-pill ${pillClass}`}>
          {status?.paired ? (
            <>
              <CheckCircle2 size={12} />
              Paired {status.port ? `(Port ${status.port})` : ''}
            </>
          ) : pending ? (
            <>
              <ShieldAlert size={12} />
              Approval needed
            </>
          ) : waiting ? (
            <>
              <RefreshCw size={12} className="spin" />
              Waiting for extension
            </>
          ) : (
            <>
              <Radio size={12} />
              {status?.status ?? 'Idle'}
            </>
          )}
        </span>
      </div>
    </div>
  )

  return (
    <BaseModal title={titleNode} onClose={onClose} size="lg" className="browser-dialog">
      <div className="browser-dialog-body">
        {pending ? (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldAlert size={18} style={{ color: '#eab308' }} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Extension wants to connect</h4>
                <p className="context-card-desc">
                  Approve it once — later connections from this extension id are trusted automatically.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="browser-extension-id">
                <span className="updates-status-desc">Extension ID</span>
                <span className="browser-extension-id-value">{pending.extensionId}</span>
                {pending.version && (
                  <span className="updates-status-desc">Version {pending.version}</span>
                )}
              </div>
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>
                  <Check size={14} />
                  Allow
                </button>
                <button className="btn" disabled={busy} onClick={() => void decide(false)}>
                  <X size={14} />
                  Deny
                </button>
              </div>
            </div>
          </div>
        ) : status?.paired ? (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldCheck size={18} style={{ color: '#22c55e' }} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Active Connection</h4>
                <p className="context-card-desc">
                  Chrome Extension is connected and ready for browser automation.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="updates-status-banner ok">
                <div className="updates-info-group">
                  <CheckCircle2 size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
                  <div className="updates-status-text">
                    <span className="updates-status-title">Bridge Ready</span>
                    <span className="updates-status-desc">
                      Connected via local loopback on port {status.port ?? '127.0.0.1'}.
                    </span>
                  </div>
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
                  <FolderOpen size={14} />
                  Extension Folder
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <Compass size={18} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Extension Setup</h4>
                <p className="context-card-desc">
                  Install the Meow extension in Chrome. It asks for approval here the first time it connects.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() => void window.api.openBrowserInstallGuide()}
                >
                  <ExternalLink size={14} />
                  Open Install Guide
                </button>
                <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>
                  <FolderOpen size={14} />
                  Extension Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {trusted.length > 0 && (
          <div className="browser-card">
            <div className="browser-card-head">
              <div className="context-icon-badge">
                <ShieldCheck size={18} />
              </div>
              <div className="context-title-group">
                <h4 className="context-card-title">Trusted extensions</h4>
                <p className="context-card-desc">
                  These extension ids connect without asking. Revoking disconnects one immediately.
                </p>
              </div>
            </div>
            <div className="browser-card-body">
              {trusted.map(entry => (
                <div className="browser-trusted-row" key={entry.id}>
                  <span className="browser-extension-id-value">{entry.id}</span>
                  <button
                    className="btn icon-btn"
                    title="Revoke"
                    disabled={busy}
                    onClick={() => void revoke(entry.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  )
}
```

- [ ] **Step 2: Open the dialog automatically when approval is needed**

In `src/renderer/src/App.tsx`, replace:

```tsx
    const offBrowser = window.api.onBrowserStatus((info) => {
      setBrowser(info)
    })
```

with:

```tsx
    const offBrowser = window.api.onBrowserStatus((info) => {
      setBrowser(info)
      // browser_start may be blocked on this approval while the user is elsewhere
      // in the app, so surface the decision instead of waiting for a click.
      if (info.pendingExtension) setBrowserDialogOpen(true)
    })
```

- [ ] **Step 3: Show the pending state in the status bar**

In `src/renderer/src/components/StatusBar.tsx`, replace:

```tsx
  const paired = Boolean(browser?.paired)
  const waiting = !paired && (browser?.status === 'listening' || browser?.status === 'idle')
```

with:

```tsx
  const paired = Boolean(browser?.paired)
  const pending = Boolean(browser?.pendingExtension)
  const waiting = !paired && !pending && (browser?.status === 'listening' || browser?.status === 'idle')
```

replace:

```tsx
          className={`sb-item sb-button sb-browser ${paired ? 'paired' : waiting ? 'waiting' : 'offline'}`}
          onClick={onBrowserClick}
          title="Open Browser Bridge status and pairing"
```

with:

```tsx
          className={`sb-item sb-button sb-browser ${paired ? 'paired' : pending || waiting ? 'waiting' : 'offline'}`}
          onClick={onBrowserClick}
          title="Open Browser Bridge status and extension approval"
```

replace:

```tsx
            {paired ? `browser: paired` : waiting ? `browser: waiting` : `browser: off`}
```

with:

```tsx
            {paired
              ? `browser: paired`
              : pending
                ? `browser: approval needed`
                : waiting
                  ? `browser: waiting`
                  : `browser: off`}
```

and replace:

```tsx
          {paired ? (
            <CheckCircle2 size={12} className="sb-status-icon ok" />
          ) : waiting ? (
            <RefreshCw size={12} className="sb-status-icon spin waiting" />
          ) : (
            <Radio size={12} className="sb-status-icon off" />
          )}
```

with:

```tsx
          {paired ? (
            <CheckCircle2 size={12} className="sb-status-icon ok" />
          ) : pending ? (
            <ShieldAlert size={12} className="sb-status-icon waiting" />
          ) : waiting ? (
            <RefreshCw size={12} className="sb-status-icon spin waiting" />
          ) : (
            <Radio size={12} className="sb-status-icon off" />
          )}
```

adding `ShieldAlert` to the existing `lucide-react` import in that file.

- [ ] **Step 4: Style the new rows**

In `src/renderer/src/styles.css`, delete the now-unused `.browser-pairing-box`, `.browser-code-row` and
`.browser-code-display` rules (lines around 4272–4300), and add after `.browser-card-body`:

```css
.browser-extension-id {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.browser-extension-id-value {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-strong);
  word-break: break-all;
}

.browser-trusted-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 0.083333rem solid var(--hairline);
}

.browser-trusted-row:last-child {
  border-bottom: none;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev`, then open the Browser Bridge dialog from the status bar.
Expected: the dialog shows "Extension Setup" with no pairing-code card; the status-bar pill reads
`browser: waiting`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/BrowserDialog.tsx src/renderer/src/App.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/styles.css
git commit -m "feat(browser): approve extensions from the Browser Bridge dialog"
```

---

### Task 6: Extension hello handshake

**Files:**
- Modify: `src/browser-extension/background.ts`, `src/browser-extension/popup.ts`, `src/browser-extension/popup.html`

**Interfaces:**
- Consumes: `HelloMessage` / `HelloResultMessage` from `src/shared/browser-types.ts` (Task 1).
- Produces: the extension announces `chrome.runtime.id` on connect and reports `pending` to the popup; the popup no longer has a code field.

- [ ] **Step 1: Replace the code handshake with hello**

In `src/browser-extension/background.ts`, replace:

```ts
interface StoredState {
  port?: number
  code?: string
  connected?: boolean
}
```

with:

```ts
interface StoredState {
  port?: number
  connected?: boolean
}
```

replace:

```ts
let paired = false
let pendingCode: string | null = null
```

with:

```ts
let paired = false
let pendingApproval = false
```

replace:

```ts
function broadcastStatus(): void {
  void chrome.runtime.sendMessage({ kind: 'status', paired, connected: ws?.readyState === WebSocket.OPEN }).catch(() => {})
}
```

with:

```ts
function broadcastStatus(): void {
  void chrome.runtime.sendMessage({
    kind: 'status',
    paired,
    pending: pendingApproval,
    connected: ws?.readyState === WebSocket.OPEN
  }).catch(() => {})
}
```

replace:

```ts
    ws = socket
    const code = pendingCode ?? state.code ?? null
    socket.onopen = () => {
      if (ws !== socket) return
      paired = false
      broadcastStatus()
      if (code) socket.send(JSON.stringify({ type: 'pair', code } satisfies ExtensionToBridge))
    }
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as BridgeToExtension
      if (msg.type === 'pair_result') {
        if (ws !== socket) return
        paired = msg.ok
        if (msg.ok) {
          pendingCode = null
          saveState({ connected: true })
          reconnectDelay = 1000
        } else {
          saveState({ connected: false })
          snapshot = null
          void debugSession.close()
        }
        broadcastStatus()
        return
      }
      if (msg.type === 'cmd') {
        void handleCommand(msg)
        return
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      paired = false
      saveState({ connected: false })
      broadcastStatus()
      ws = null
      snapshot = null
      void debugSession.close()
      scheduleReconnect()
    }
```

with:

```ts
    ws = socket
    socket.onopen = () => {
      if (ws !== socket) return
      paired = false
      pendingApproval = false
      broadcastStatus()
      socket.send(JSON.stringify({
        type: 'hello',
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      } satisfies ExtensionToBridge))
    }
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as BridgeToExtension
      if (msg.type === 'hello_result') {
        if (ws !== socket) return
        paired = msg.paired
        pendingApproval = Boolean(msg.pending)
        if (msg.paired) {
          saveState({ connected: true })
          reconnectDelay = 1000
        } else if (!msg.ok) {
          saveState({ connected: false })
          snapshot = null
          void debugSession.close()
          socket.close()
        }
        broadcastStatus()
        return
      }
      if (msg.type === 'cmd') {
        void handleCommand(msg)
        return
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      paired = false
      pendingApproval = false
      saveState({ connected: false })
      broadcastStatus()
      ws = null
      snapshot = null
      void debugSession.close()
      scheduleReconnect()
    }
```

Note: `const state = await loadState()` above stays — `state.port` is still read by `detectPort()`.

- [ ] **Step 2: Replace the popup's pair message with a reconnect**

In `src/browser-extension/background.ts`, replace:

```ts
  if (msg?.kind === 'pair') {
    pendingCode = String(msg.code)
    saveState({ code: pendingCode })
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pair', code: pendingCode } satisfies ExtensionToBridge))
    } else {
      connect()
    }
    sendResponse({ ok: true })
    return false
  }
  if (msg?.kind === 'status') {
    sendResponse({ paired, connected: ws?.readyState === WebSocket.OPEN })
    return false
  }
```

with:

```ts
  if (msg?.kind === 'reconnect') {
    if (ws) ws.close()
    else connect()
    sendResponse({ ok: true })
    return false
  }
  if (msg?.kind === 'status') {
    sendResponse({ paired, pending: pendingApproval, connected: ws?.readyState === WebSocket.OPEN })
    return false
  }
```

- [ ] **Step 3: Drop the code field from the popup**

Replace the whole content of `src/browser-extension/popup.ts` with:

```ts
const STORAGE_KEY = 'meowBridge'
const DEFAULT_PORT = 3927

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

function refreshStatus(): void {
  void chrome.runtime.sendMessage({ kind: 'status' }).then((res: { paired?: boolean; pending?: boolean; connected?: boolean }) => {
    const dot = $('dot')
    const text = $('statusText')
    if (res?.paired) {
      dot.className = 'dot green'
      text.textContent = 'Paired & connected'
    } else if (res?.pending) {
      dot.className = 'dot amber'
      text.textContent = 'Waiting for approval in Meow'
    } else if (res?.connected) {
      dot.className = 'dot amber'
      text.textContent = 'Connected (not paired)'
    } else {
      dot.className = 'dot red'
      text.textContent = 'Disconnected'
    }
  }).catch(() => {
    $('dot').className = 'dot red'
    $('statusText').textContent = 'Disconnected'
  })
}

async function detect(): Promise<void> {
  const portInput = $('port') as HTMLInputElement
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/api/status`)
    if (res.ok) {
      const body = await res.json() as { port?: number }
      if (typeof body.port === 'number') portInput.value = String(body.port)
      $('hint').textContent = `Detected Meow bridge on port ${body.port}.`
    } else {
      $('hint').textContent = 'No bridge found on the default port.'
    }
  } catch {
    $('hint').textContent = 'Is Meow running? Could not connect to the bridge.'
  }
}

void chrome.storage.local.get(STORAGE_KEY).then((res: Record<string, { port?: number } | undefined>) => {
  const cur = res[STORAGE_KEY]
  if (cur?.port) ($('port') as HTMLInputElement).value = String(cur.port)
  refreshStatus()
})

$('detectBtn').addEventListener('click', () => void detect())
$('saveBtn').addEventListener('click', () => {
  const port = Number(($('port') as HTMLInputElement).value) || DEFAULT_PORT
  void chrome.storage.local.set({ [STORAGE_KEY]: { port } }).then(() => {
    void chrome.runtime.sendMessage({ kind: 'reconnect' }).then(() => {
      $('hint').textContent = 'Saved. Connecting...'
      setTimeout(refreshStatus, 800)
    })
  })
})
```

In `src/browser-extension/popup.html`, replace:

```html
  <div class="row">
    <label>Pairing code</label>
    <input id="code" placeholder="000000" />
  </div>
  <button id="saveBtn" class="primary">Save &amp; connect</button>
  <div class="hint" id="hint">Enter the pairing code shown in Meow.</div>
```

with:

```html
  <button id="saveBtn" class="primary">Save &amp; connect</button>
  <div class="hint" id="hint">Approve this extension in Meow &rarr; Browser Bridge.</div>
```

- [ ] **Step 4: Build the extension**

Run: `npm run build:extension`
Expected: PASS — `out/browser-extension` is rebuilt with no TypeScript error.

- [ ] **Step 5: Verify against the running app**

Run: `npm run dev`. In Chrome, reload the unpacked extension from `userData/browser-extension`, open its
popup.
Expected: the popup has no code field, the status reads "Waiting for approval in Meow", and the Meow
Browser Bridge dialog shows the approval card with the extension id.

- [ ] **Step 6: Commit**

```bash
git add src/browser-extension/background.ts src/browser-extension/popup.ts src/browser-extension/popup.html
git commit -m "feat(extension): announce the extension id instead of a pairing code"
```

---

### Task 7: Integration flow on the hello path

**Files:**
- Modify: `tests/integration/browser/bridge-flow.test.ts`

**Interfaces:**
- Consumes: `BrowserBridge.approveExtension` (Task 3), `TrustedExtensionStore` (Task 2).
- Produces: an end-to-end bridge test that pairs through hello + approval instead of a code.

- [ ] **Step 1: Rewrite the fake extension helper**

In `tests/integration/browser/bridge-flow.test.ts`, replace the imports:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import WebSocket from 'ws'
import { BrowserBridge } from '../../../src/main/browser/bridge'
import type { BridgeToExtension } from '../../../src/shared/browser-types'
```

with:

```ts
import { describe, expect, it, afterEach } from 'vitest'
import WebSocket from 'ws'
import { BrowserBridge } from '../../../src/main/browser/bridge'
import { TrustedExtensionStore } from '../../../src/main/browser/trusted-store'
import type { BridgeToExtension } from '../../../src/shared/browser-types'

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`
```

replace:

```ts
function newBridge(): BrowserBridge {
  const b = new BrowserBridge({ preferredPort: 0 })
  bridges.push(b)
  return b
}
```

with:

```ts
function newBridge(): BrowserBridge {
  const b = new BrowserBridge({ preferredPort: 0, trusted: new TrustedExtensionStore() })
  bridges.push(b)
  return b
}
```

and replace the whole `fakeExtension` function with:

```ts
// Mô phỏng extension: hello → chờ user duyệt → tự trả lời từng command theo map name → result.
async function fakeExtension(port: number, handlers: Record<string, (params: Record<string, unknown>) => unknown>): Promise<FakeExtension> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: EXT_ORIGIN })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'hello', extensionId: EXT_ID, version: '0.3.4' }))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error('hello timeout'))
    }, 2000)
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as BridgeToExtension
      if (msg.type === 'hello_result' && msg.pending) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve()
      }
    }
    ws.on('message', onMsg)
    ws.once('error', () => {
      clearTimeout(timer)
      reject(new Error('ws error'))
    })
  })
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as BridgeToExtension
    if (msg.type !== 'cmd') return
    const handler = handlers[msg.name]
    const data = handler ? handler(msg.params ?? {}) : { error: `no handler: ${msg.name}` }
    const out: { type: 'result'; id: string; ok: boolean } & Record<string, unknown> = {
      type: 'result', id: msg.id, ok: true, data
    }
    ws.send(JSON.stringify(out))
  })
  return {
    ws,
    close: () => new Promise<void>(resolve => {
      if (ws.readyState === WebSocket.CLOSED) { resolve(); return }
      ws.once('close', () => resolve())
      ws.close()
    })
  }
}
```

- [ ] **Step 2: Update the two tests to approve instead of pairing**

In the first test, replace:

```ts
    const b = newBridge()
    const port = await b.start()
    const { code } = b.pair()

    const ext = await fakeExtension(port, code, {
      navigate: (p) => ({ url: p.url, ok: true }),
      read: () => ({ url: 'https://example.com', title: 'Example', text: 'hello', elements: [] }),
      screenshot: () => ({ base64: Buffer.from('img').toString('base64') })
    })

    expect(b.getStatus().paired).toBe(true)
```

with:

```ts
    const b = newBridge()
    const port = await b.start()

    const ext = await fakeExtension(port, {
      navigate: (p) => ({ url: p.url, ok: true }),
      read: () => ({ url: 'https://example.com', title: 'Example', text: 'hello', elements: [] }),
      screenshot: () => ({ base64: Buffer.from('img').toString('base64') })
    })

    expect(b.getStatus().status).toBe('pending')
    b.approveExtension(EXT_ID)
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(true)
```

In the second test, replace:

```ts
    const b = newBridge()
    const port = await b.start()
    const { code } = b.pair()

    const ext1 = await fakeExtension(port, code, { listTabs: () => ({ tabs: [1] }) })
    expect(b.getStatus().paired).toBe(true)
    await ext1.close()
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(false)

    const ext2 = await fakeExtension(port, code, { listTabs: () => ({ tabs: [2] }) })
    expect(b.getStatus().paired).toBe(true)
```

with:

```ts
    const b = newBridge()
    const port = await b.start()

    const ext1 = await fakeExtension(port, { listTabs: () => ({ tabs: [1] }) })
    b.approveExtension(EXT_ID)
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(true)
    await ext1.close()
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(false)

    // Đã được duyệt trước đó → lần kết nối sau pair im lặng, không hỏi lại
    const ext2 = await fakeExtension(port, { listTabs: () => ({ tabs: [2] }) })
    await new Promise(r => setTimeout(r, 50))
    expect(b.getStatus().paired).toBe(true)
```

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run tests/integration/browser/bridge-flow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/browser/bridge-flow.test.ts
git commit -m "test(browser): drive the bridge flow through hello and approval"
```

---

### Task 8: Remove the pairing-code path

**Files:**
- Modify: `src/main/browser/bridge.ts`, `src/shared/browser-types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `tests/unit/browser/bridge.test.ts`, `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `hello` is the only handshake; `pair()` / `PairingInfo` / `BrowserPair` / `pairBrowser` are gone; the trusted socket is the only one whose messages are accepted; a closing socket rejects its in-flight commands.

- [ ] **Step 1: Write the failing tests for the new invariants**

In `tests/unit/browser/bridge.test.ts`, add to the `BrowserBridge extension approval` block:

```ts
  it('does not evict a paired extension when an unknown one connects', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const pairedWs = await connectWithOrigin(port, EXT_ORIGIN)
    hello(pairedWs)
    await nextMsg(pairedWs)
    expect(b.getStatus().paired).toBe(true)

    const otherId = 'ponmlkjihgfedcbaponmlkjihgfedcba'
    const other = await connectWithOrigin(port, `chrome-extension://${otherId}`)
    hello(other, otherId)
    expect(await nextMsg(other)).toMatchObject({ type: 'hello_result', ok: true, paired: false, pending: true })

    expect(b.getStatus().paired).toBe(true)
    expect(pairedWs.readyState).toBe(WebSocket.OPEN)
    expect(await b.execute('listTabs')).toMatchObject({ ok: false, error: expect.stringContaining('not connected') })

    b.denyExtension(otherId)
    await closed(other)
    pairedWs.close()
  })

  it('ignores results from a socket that is not the paired one', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const pairedWs = await connectWithOrigin(port, EXT_ORIGIN)
    hello(pairedWs)
    await nextMsg(pairedWs)

    const otherId = 'ponmlkjihgfedcbaponmlkjihgfedcba'
    const other = await connectWithOrigin(port, `chrome-extension://${otherId}`)
    hello(other, otherId)
    await nextMsg(other)

    const done = b.execute('listTabs', undefined, 200)
    const cmd = await nextMsg(pairedWs) as Extract<BridgeToExtension, { type: 'cmd' }>
    other.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { tabs: 'stolen' } }))
    pairedWs.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { tabs: [1] } }))

    expect(await done).toEqual({ ok: true, data: { tabs: [1] } })
    b.denyExtension(otherId)
    await closed(other)
    pairedWs.close()
  })

  it('rejects in-flight commands when the paired socket closes', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const done = b.execute('read')
    await nextMsg(ws) // consume cmd, never reply
    ws.close()

    expect(await done).toEqual({ ok: false, error: 'browser extension disconnected' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/browser/bridge.test.ts`
Expected: FAIL — the unknown extension evicts the paired socket, the untrusted result is accepted, and the in-flight command hangs until its 30s timeout.

- [ ] **Step 3: Make the trusted socket the only one**

In `src/main/browser/bridge.ts`, replace `handleConnection` with:

```ts
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // this.socket is assigned only after a hello passes the origin check, so an
    // unknown connection can never evict the extension that is currently paired.
    const origin = req.headers.origin
    if (this.status === 'idle' || this.status === 'disconnected') this.setStatus('listening')

    ws.on('message', (raw) => {
      let msg: ExtensionToBridge
      try {
        msg = JSON.parse(String(raw)) as ExtensionToBridge
      } catch {
        return
      }
      if (msg.type === 'hello') {
        this.handleHello(ws, origin, msg)
        return
      }
      if (ws !== this.socket) return
      if (msg.type === 'result') this.handleResult(msg.id, msg)
      else if (msg.type === 'event') this.handleEvent(msg.name, msg.data)
      else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })

    ws.on('close', () => {
      if (this.socket !== ws) return
      const wasPaired = this.pairedExtensionId !== null
      this.socket = null
      this.pairedExtensionId = null
      this.clearPending()
      this.rejectPendingCommands('browser extension disconnected')
      this.setStatus(wasPaired ? 'disconnected' : 'listening')
    })
    ws.on('error', () => ws.close())
  }
```

add the helper next to `close()`:

```ts
  private rejectPendingCommands(error: string): void {
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer)
      resolve({ ok: false, error })
    }
    this.pending.clear()
  }
```

and in `handleHello`, replace:

```ts
    if (this.trusted.has(msg.extensionId)) {
      this.clearPending()
      this.pairedExtensionId = msg.extensionId
      this.setStatus('paired')
```

with:

```ts
    if (this.trusted.has(msg.extensionId)) {
      this.clearPending()
      if (this.socket && this.socket !== ws && this.socket.readyState === WebSocket.OPEN) this.socket.close()
      this.socket = ws
      this.pairedExtensionId = msg.extensionId
      this.setStatus('paired')
```

- [ ] **Step 4: Delete the code path**

In `src/main/browser/bridge.ts`:

- remove the `randomInt` import (keep `randomUUID`),
- remove `codeTtlMs` from `BridgeDeps` and `DEFAULT_CODE_TTL_MS`,
- remove the fields `code`, `codeExpiresAt`, `sessionPaired`,
- remove `pair()` and `handlePair()`,
- in `start()`, remove the three lines that mint the code:

```ts
    this.code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    this.codeExpiresAt = Date.now() + (this.deps.codeTtlMs ?? DEFAULT_CODE_TTL_MS)
    this.sessionPaired = false
```

- in `getStatus()`, replace:

```ts
      ...(paired ? {} : { pairingCode: this.code, pairingExpiresAt: this.codeExpiresAt || undefined }),
```

with nothing (the `pendingExtension` spread stays),

- in `close()`, replace:

```ts
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer)
      resolve({ ok: false, error: 'browser bridge closed' })
    }
    this.pending.clear()
    this.socket?.close()
```

with:

```ts
    this.rejectPendingCommands('browser bridge closed')
    this.socket?.close()
```

and replace:

```ts
    this.server = null
    this.sessionPaired = false
    this.clearPending()
```

with:

```ts
    this.server = null
    this.clearPending()
```

- remove `PairingInfo` from the type import.

- [ ] **Step 5: Delete the dead types, channel and API method**

In `src/shared/browser-types.ts`, remove `PairMessage`, `PairResultMessage`, `PairingInfo`,
`pairingCode` and `pairingExpiresAt`, and set:

```ts
export type ExtensionToBridge = HelloMessage | ResultMessage | EventMessage | PingMessage
export type BridgeToExtension = HelloResultMessage | CmdMessage | PongMessage
```

In `src/shared/ipc.ts`, remove `BrowserPair: 'browser:pair',`, remove `pairBrowser(): Promise<PairingInfo>`
from `AgentApi`, and drop `PairingInfo` from the type import.

In `src/preload/index.ts`, remove `pairBrowser: () => ipcRenderer.invoke(Channels.BrowserPair),`.

In `src/main/index.ts`, remove `ipcMain.handle(Channels.BrowserPair, () => mainApp.browserBridge.pair())`.

- [ ] **Step 6: Rewrite the pair-based unit tests onto the hello path**

In `tests/unit/browser/bridge.test.ts`, add two helpers next to `connect`:

```ts
function newTrustedBridge(deps: Record<string, unknown> = {}): BrowserBridge {
  const trusted = new TrustedExtensionStore()
  trusted.approve(EXT_ID)
  return newBridge({ trusted, ...deps })
}

async function connectTrusted(port: number, extensionId = EXT_ID): Promise<WebSocket> {
  const ws = await connectWithOrigin(port, `chrome-extension://${extensionId}`)
  ws.send(JSON.stringify({ type: 'hello', extensionId }))
  await nextMsg(ws)
  return ws
}
```

Then, in every remaining test that uses the code, replace

```ts
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
```

with

```ts
    const b = newTrustedBridge()
    const port = await b.start()
    const ws = await connectTrusted(port)
```

Affected tests: `routes a command to the extension and resolves the result`,
`times out when the extension never replies`, `buffers console and network events in ring buffers`,
`saves screenshots to the screenshot dir and returns the path`, `replies pong to a heartbeat ping from
the extension`, and `notifies status listeners on pair` (keep the name; it still asserts `seen`
contains `'paired'`).

Delete these three tests, which only describe the code path:
`pairs with the correct code and rejects a wrong one`,
`re-accepts a previously-paired extension after the code TTL has passed`,
`requires the pairing code again after a new code is issued`.

In `waitForPaired resolves once paired and rejects on timeout`, replace:

```ts
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    const waiter = b.waitForPaired(2000)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
    expect(await waiter).toBe(true)
```

with:

```ts
    const b = newTrustedBridge()
    const port = await b.start()
    const ws = await connectWithOrigin(port, EXT_ORIGIN)

    const waiter = b.waitForPaired(2000)
    ws.send(JSON.stringify({ type: 'hello', extensionId: EXT_ID }))
    await nextMsg(ws)
    expect(await waiter).toBe(true)
```

Remove the now-unused `connect(port)` helper if nothing references it.

- [ ] **Step 7: Update the IPC contract test**

In `tests/unit/ipc-contract.test.ts`, remove `'pairBrowser',` from the expected-methods array, remove
the `pairBrowser: async () => ({ code: '000000', expiresAt: 0 }),` stub, and remove
`expect(Channels.BrowserPair).toBe('browser:pair')`.

- [ ] **Step 8: Verify nothing references the old path**

Run: `grep -rn "pairBrowser\|BrowserPair\|PairingInfo\|pairingCode\|pairingExpiresAt\|handlePair\|sessionPaired\|codeTtlMs" src tests`
Expected: no output.

- [ ] **Step 9: Run the full verification**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(browser): drop the pairing code in favour of extension approval"
```

---

### Task 9: Tool copy, docs and AGENTS.md

**Files:**
- Modify: `src/main/agent/tools/browser.ts`, `src/main/AGENTS.md`, `docs/reference/01-product-overview.md`, `docs/reference/04-tool-catalog.md`, `docs/reference/05-ipc-contract.md`, `docs/reference/06-data-and-storage.md`, `docs/reference/08-integrations.md`, `docs/reference/09-ui-guide.md`, `docs/reference/11-conventions-and-pitfalls.md`

**Interfaces:**
- Consumes: the finished behavior from Tasks 1–8.
- Produces: user-facing copy and reference docs that describe approval instead of a code.

- [ ] **Step 1: Update the `browser_start` copy**

In `src/main/agent/tools/browser.ts`, replace:

```ts
        'Ensure the Chrome bridge is connected. If not paired, opens Chrome, shows install steps, ' +
        'and waits for the user to pair the extension. Returns the bridge status.',
```

with:

```ts
        'Ensure the Chrome bridge is connected. If not paired, opens Chrome, shows install steps, ' +
        'and waits for the user to approve the extension in Meow. Returns the bridge status.',
```

and replace:

```ts
        if (!paired) return { error: 'browser not paired after 60s — check the pairing code in the extension popup' }
```

with:

```ts
        if (!paired) return { error: 'browser not paired after 60s — approve the extension in Meow → Browser Bridge' }
```

- [ ] **Step 2: Update `docs/reference/08-integrations.md`**

Replace the protocol table rows:

```markdown
| ext → bridge | `{ type: 'pair', code }` | Redeem the pairing code |
| bridge → ext | `{ type: 'pair_result', ok, error? }` | Result |
```

with:

```markdown
| ext → bridge | `{ type: 'hello', extensionId, version? }` | Announce the extension id on connect |
| bridge → ext | `{ type: 'hello_result', ok, paired, pending?, error? }` | Trusted (silent pair), pending approval, or rejected |
```

Replace `BrowserStatus` ∈ `idle` | `listening` | `paired` | `disconnected` | `error`. with
`BrowserStatus` ∈ `idle` | `listening` | `pending` | `paired` | `disconnected` | `error`.

Replace the pairing bullet:

```markdown
- Pairing code: 6 digits, TTL 5 minutes. The **TTL bounds only the initial pairing** — once
  `sessionPaired` is set, a reconnect with the same code silently re-pairs, because MV3 service
  workers get suspended while idle and drop the WebSocket.
```

with:

```markdown
- Trust is an **extension-id allowlist** (`userData/browser-trusted.json`) plus an `Origin` check: a
  `hello` is accepted only when the handshake `Origin` equals `chrome-extension://<claimed id>`, so a
  web page or local process cannot impersonate an approved id. A trusted id pairs silently on every
  reconnect (MV3 service workers get suspended while idle and drop the WebSocket); an unknown id parks
  the socket in `pending` for 2 minutes until the renderer approves or denies it.
- A connection that is not the trusted socket has its `result` / `event` / `ping` messages ignored, and
  a paired socket is never evicted by an unknown connection.
```

Replace the "Exactly **one** extension socket at a time; a new connection closes the previous one."
bullet with:

```markdown
- Exactly **one** trusted extension socket at a time; a trusted id reconnecting replaces the previous
  socket, while an unknown connection is rejected without touching the paired one.
```

In the install flow, replace step 5:

```markdown
5. The user enters the 6-digit code in the extension popup.
```

with:

```markdown
5. The extension announces its id; the app asks once ("Extension `<id>` wants to connect") and the
   user clicks **Allow**. Later connections from that id are silent.
```

and replace the `action` row:

```markdown
| `action` | `popup.html` — pairing UI and status |
```

with:

```markdown
| `action` | `popup.html` — bridge port and connection status |
```

- [ ] **Step 3: Update `docs/reference/05-ipc-contract.md`**

In the browser bridge table, replace:

```markdown
| `BrowserPair` | `browser:pair` | `pairBrowser(): PairingInfo` |
```

with:

```markdown
| `BrowserApproveExtension` | `browser:approve-extension` | `approveBrowserExtension(extensionId): BrowserStatusInfo` |
| `BrowserDenyExtension` | `browser:deny-extension` | `denyBrowserExtension(extensionId): BrowserStatusInfo` |
| `BrowserRevokeExtension` | `browser:revoke-extension` | `revokeBrowserExtension(extensionId): BrowserStatusInfo` |
| `BrowserGetTrustedExtensions` | `browser:get-trusted-extensions` | `getBrowserTrustedExtensions(): TrustedExtension[]` |
```

- [ ] **Step 4: Update `docs/reference/06-data-and-storage.md`**

In the network endpoints table, replace:

```markdown
| `127.0.0.1:3927` (HTTP + WS) | app listens | Browser bridge. `GET /api/status` returns `{port, status}`; the WS endpoint speaks the pairing/command protocol |
```

with:

```markdown
| `127.0.0.1:3927` (HTTP + WS) | app listens | Browser bridge. `GET /api/status` returns `{port, status}`; the WS endpoint speaks the hello/command protocol |
```

and add a row to the userData file table (next to the other `userData/*.json` entries):

```markdown
| `browser-trusted.json` | Approved Chrome extension ids (`{ id, version?, approvedAt }[]`) — the browser bridge allowlist |
```

- [ ] **Step 5: Update `docs/reference/04-tool-catalog.md`**

Replace:

```markdown
| `browser_start` | `{}` | Ensure the bridge is connected. If unpaired, opens Chrome, shows install steps, and waits for pairing. Returns bridge status. |
```

with:

```markdown
| `browser_start` | `{}` | Ensure the bridge is connected. If unpaired, opens Chrome, shows install steps, and waits for the user to approve the extension in Meow. Returns bridge status. |
```

- [ ] **Step 6: Update `docs/reference/09-ui-guide.md`**

Replace:

```markdown
`AddProjectDialog`, `UpdateDialog`, `BrowserDialog` (bridge pairing + status),
```

with:

```markdown
`AddProjectDialog`, `UpdateDialog`, `BrowserDialog` (bridge status + extension approval),
```

- [ ] **Step 7: Update `docs/reference/11-conventions-and-pitfalls.md`**

Replace:

```markdown
| **Browser bridge binds `127.0.0.1` only and requires a pairing code** | It drives the user's *real* Chrome profile |
```

with:

```markdown
| **Browser bridge binds `127.0.0.1` only and requires an approved extension id** | It drives the user's *real* Chrome profile; the `Origin` check is what makes the id trustworthy |
```

- [ ] **Step 8: Update `docs/reference/01-product-overview.md`**

Replace:

```markdown
| **Bridge** | The loopback WebSocket server that pairs the app with the Meow Chrome extension. |
```

with:

```markdown
| **Bridge** | The loopback WebSocket server that connects the app to the approved Meow Chrome extension. |
```

- [ ] **Step 9: Update `src/main/AGENTS.md`**

Replace:

```markdown
- `browser/` — BrowserBridge (local WS server + pairing) + Chrome launcher + snapshot format.
```

with:

```markdown
- `browser/` — BrowserBridge (local WS server + extension approval) + trusted-extension store + Chrome launcher + snapshot format.
```

- [ ] **Step 10: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add -A
git commit -m "docs(browser): describe extension approval instead of the pairing code"
```

---

## Self-Review

**Spec coverage:** §4.1 trust gate → Tasks 3, 8. §4.2 allowlist storage → Tasks 2, 4. §4.3 state machine
(no code, no `sessionPaired`, no eviction of a paired socket, 2-minute TTL) → Tasks 3, 8. §4.4 protocol
types → Tasks 1, 8. §4.5 bridge API → Tasks 3, 8. §4.6 IPC → Tasks 4, 8. §4.7 extension → Task 6. §4.8
renderer → Task 5. §4.9 `browser_start` → Task 9. §5 migration → Task 6 (the extension re-syncs on
launch and asks once). §6 testing → Tasks 2, 3, 7, 8. §7 docs → Task 9. §8 risks 1–3 → Tasks 3, 5, 8.
§9 deferred (manifest `"key"`, multi-extension UI) → intentionally not implemented.

**Placeholder scan:** no TBD/TODO; every code step carries the literal code; the only "replace X with Y"
steps quote both sides verbatim.

**Type consistency:** `TrustedExtension` is defined once in `src/shared/browser-types.ts` (Task 1) and
imported by the store (Task 2), the bridge (Task 3), IPC (Task 4) and the renderer (Task 5).
`approveExtension` / `denyExtension` / `revokeExtension` / `getTrustedExtensions` keep the same names and
signatures from Task 3 through Task 8. `pendingExtension` is the only field the renderer reads for the
approval card, and it is produced by `getStatus()` in Task 3.

**Known follow-ups for the executor:** the `pending` TTL and `deny` paths must never overwrite a
`paired` status (the guards in Task 3's `armPendingTimer` / `denyExtension` handle this); `handleConnection`
must not reset a `pending` status (Task 8's version only resets `idle` / `disconnected`).

**Review Focus:** 1 → Task 3 (`rejects a hello whose origin does not match the claimed id`); 2 → Task 8
(`does not evict a paired extension when an unknown one connects`); 3 → Task 3
(`replaces the pending extension when a second unknown one connects`) and Task 8
(`ignores results from a socket that is not the paired one`); 4 → Task 3
(`approveExtension with a different id is a no-op`, `denyExtension` / `revokeExtension` guards);
5 → Task 8 (`rejects in-flight commands when the paired socket closes`).
