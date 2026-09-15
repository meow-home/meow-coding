# Processes UI Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-docked "Processes" overlay (per session) that lists the agent's background shells and monitors, streams a selected shell's output live, and can kill a shell.

**Architecture:** Store accessors + a manager subscription bridge expose background-shell/monitor state over new IPC (list/kill/subscribe + live data/exit events). A new `ProcessesOverlay` React component mirrors the Files overlay's docking/resize; App wires it to a pane's `⋮` menu, opened by agent id. Live output reuses the store's `data`/`exit` events and `inspect()` (never touches the agent's `bash_output` read offset).

**Tech Stack:** TypeScript, Electron (main + preload + renderer IPC), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-processes-ui-design.md`

## Global Constraints

- Output streaming reads the store via events + `inspect()` only; never `readNew` (that consumes the agent's offset).
- Per-session (agent) scope. No cross-agent aggregation, no persistence, no `xterm`.
- Follow the existing `agent:background` IPC pattern (Channels → `AgentApi` → preload → main handler → MainApp → manager).
- The React component is verified by typecheck + the manual smoke test in Task 5; there is no renderer unit-test harness.

## How to apply this plan (no inference required)

- Every **"Create"** step gives the file's full contents — write it verbatim.
- Every **"Modify"** step is a set of exact **FIND → REPLACE** edits. The `FIND` block exists verbatim in the current source; locate it and swap in the `REPLACE` block. Do not hand-merge.
- Line numbers in prose are **hints as of 2026-09-15 only** — match by the verbatim `FIND` text. If a `FIND` block does not match, re-read the file and re-locate the same anchor.
- Run the exact command at each "Run:" step and confirm the Expected result before moving on. Commit at the end of each task with the message given.

---

### Task 1: Shared types + store `list()` accessors

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/agent/background-process-store.ts`
- Modify: `src/main/agent/monitor-store.ts`
- Test: `tests/unit/background-process-store.test.ts`, `tests/unit/monitor-store.test.ts`

**Interfaces:**
- Produces: `BackgroundProcInfo`, `MonitorInfo` (shared); `BackgroundProcessStore.list(agentId)`; `MonitorStore.list(agentId)`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/background-process-store.test.ts`, add before the final `})`:

```ts
  it('list(agentId) returns running and exited entries for that agent', async () => {
    const { store } = makeStore()
    const a = store.start('a1', 'echo L1', dir) as { id: string }
    store.start('a2', 'sleep 5', dir)
    await waitFor(() => store.inspect(a.id)?.status === 'exited')
    const list = store.list('a1')
    expect(list.length).toBe(1)
    expect(list[0].command).toBe('echo L1')
    expect(list[0].status).toBe('exited')
    store.killAllForAgent('a2')
  }, 20000)
```

In `tests/unit/monitor-store.test.ts`, add inside the `describe('MonitorStore', ...)` block before its closing `})`:

```ts
  it('list(agentId) returns active monitors with a readable until', () => {
    const { procs, monitors } = makeStores()
    const bg = procs.start('a1', 'sleep 5', dir) as { id: string }
    monitors.start('a1', bg.id, { untilRegex: 'READY', timeoutMs: 30000 })
    const list = monitors.list('a1')
    expect(list.length).toBe(1)
    expect(list[0].targetId).toBe(bg.id)
    expect(list[0].until).toContain('READY')
    procs.killAllForAgent('a1')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/background-process-store.test.ts tests/unit/monitor-store.test.ts -t "list("`
Expected: FAIL — `store.list`/`monitors.list` is not a function.

- [ ] **Step 3a: Add shared types**

In `src/shared/types.ts`, add these exports near the other agent types (append at the end of the file is fine):

```ts
export interface BackgroundProcInfo {
  id: string
  command: string
  status: 'running' | 'exited'
  exitCode: number | null
}

export interface MonitorInfo {
  id: string
  targetId: string
  until: string
}
```

- [ ] **Step 3b: Add `BackgroundProcessStore.list`**

In `src/main/agent/background-process-store.ts`. FIND:
```ts
  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'running') n++
    return n
  }
```
REPLACE:
```ts
  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'running') n++
    return n
  }

  list(agentId: string): { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }[] {
    const out: { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId) out.push({ id: e.id, command: e.command, status: e.status, exitCode: e.exitCode })
    }
    return out
  }
```

- [ ] **Step 3c: Add `until` to monitor entries and `MonitorStore.list`**

In `src/main/agent/monitor-store.ts`.

**Edit 1 — add `until` to the `Entry` interface.** FIND:
```ts
  untilRegex?: RegExp
  untilExit?: boolean | number
  status: 'watching' | 'resolved'
```
REPLACE:
```ts
  untilRegex?: RegExp
  untilExit?: boolean | number
  until: string
  status: 'watching' | 'resolved'
```

**Edit 2 — compute `until` and store it on the entry.** FIND:
```ts
    const entry: Entry = {
      id, agentId, sessionId, targetId, untilRegex, untilExit: opts.untilExit,
      status: 'watching', onData: () => {}, onExit: () => {}
    }
```
REPLACE:
```ts
    const until = [
      opts.untilRegex ? `/${opts.untilRegex}/` : null,
      opts.untilExit !== undefined ? 'exit' : null,
      opts.timeoutMs ? `${Math.round(opts.timeoutMs / 1000)}s` : null
    ].filter(Boolean).join(' or ')
    const entry: Entry = {
      id, agentId, sessionId, targetId, untilRegex, untilExit: opts.untilExit, until,
      status: 'watching', onData: () => {}, onExit: () => {}
    }
```

**Edit 3 — add the `list` method** (after `count`). FIND:
```ts
  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'watching') n++
    return n
  }
```
REPLACE:
```ts
  count(agentId: string): number {
    let n = 0
    for (const e of this.entries.values()) if (e.agentId === agentId && e.status === 'watching') n++
    return n
  }

  list(agentId: string): { id: string; targetId: string; until: string }[] {
    const out: { id: string; targetId: string; until: string }[] = []
    for (const e of this.entries.values()) {
      if (e.agentId === agentId && e.status === 'watching') out.push({ id: e.id, targetId: e.targetId, until: e.until })
    }
    return out
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/background-process-store.test.ts tests/unit/monitor-store.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/agent/background-process-store.ts src/main/agent/monitor-store.ts tests/unit/background-process-store.test.ts tests/unit/monitor-store.test.ts
git commit -m "feat(agent): add list() accessors and BackgroundProcInfo/MonitorInfo types"
```

---

### Task 2: Manager methods + subscription bridge

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/agent-background-procs-bridge.test.ts`

**Interfaces:**
- Consumes: `BackgroundProcessStore` events (`data`/`exit`), `list()` (Task 1), `MonitorStore.list()`.
- Produces on `MeowAgentManager`: `backgroundProcsList(agentId)`, `monitorsList(agentId)`, `killBackgroundProc(id)`, `subscribeBackgroundProc(id)`, `unsubscribeBackgroundProc(id)`; new deps `onBackgroundProcData` / `onBackgroundProcExit`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent-background-procs-bridge.test.ts`. This drives only the subscription-forwarding logic via a minimal fake, so it does not construct the whole manager:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BackgroundProcessStore } from '../../src/main/agent/background-process-store'

const dir = mkdtempSync(path.join(tmpdir(), 'meow-bridge-'))

// Mirrors the manager's forwarding rule: forward data/exit only for subscribed ids.
function makeBridge(store: BackgroundProcessStore) {
  const subs = new Set<string>()
  const data: { id: string; chunk: string }[] = []
  const exits: { id: string; exitCode: number | null }[] = []
  store.on('data', (e: { id: string; chunk: string }) => { if (subs.has(e.id)) data.push(e) })
  store.on('exit', (e: { id: string; exitCode: number | null }) => { if (subs.has(e.id)) exits.push(e) })
  return { subs, data, exits }
}

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!fn()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 30)) }
}

describe('background proc subscription bridge', () => {
  it('forwards data/exit only for subscribed ids', async () => {
    const store = new BackgroundProcessStore({ getSessionId: () => 's', onExit: () => {} })
    const b = makeBridge(store)
    const watched = store.start('a1', 'sleep 0.2; echo SUB_OK', dir) as { id: string }
    const ignored = store.start('a1', 'echo IGN', dir) as { id: string }
    b.subs.add(watched.id)
    await waitFor(() => b.data.some(d => d.chunk.includes('SUB_OK')) && b.exits.some(e => e.id === watched.id))
    expect(b.data.every(d => d.id === watched.id)).toBe(true)
    expect(b.exits.some(e => e.id === ignored.id)).toBe(false)
  }, 20000)
})
```

> Note: this test verifies the forwarding *rule* independently. The manager methods added in Step 3 are covered by typecheck + the manual smoke test in Task 5.

- [ ] **Step 2: Run the test to verify it fails, then passes trivially**

Run: `npx vitest run tests/unit/agent-background-procs-bridge.test.ts`
Expected: PASS immediately (it exercises the real store events, which already exist). This test locks the forwarding contract the manager must implement in Step 3.

- [ ] **Step 3a: Add the deps**

In `src/main/meow-agent-manager.ts`, find the `MeowAgentManagerDeps` interface (search for `onBackgroundChange?`) and add two optional callbacks beside it. FIND:
```ts
  onBackgroundChange?: (agentId: string, background: boolean) => void
```
REPLACE:
```ts
  onBackgroundChange?: (agentId: string, background: boolean) => void
  onBackgroundProcData?: (e: { id: string; chunk: string }) => void
  onBackgroundProcExit?: (e: { id: string; exitCode: number | null }) => void
```

- [ ] **Step 3b: Add the subscription set and attach the bridge in the constructor**

**Edit 1 — import the event types.** FIND:
```ts
import { BackgroundProcessStore, type BgExitInfo } from './agent/background-process-store'
```
REPLACE:
```ts
import { BackgroundProcessStore, type BgExitInfo, type BgDataEvent, type BgExitEvent } from './agent/background-process-store'
```

**Edit 2 — add the field** (right after the `monitors` field). FIND:
```ts
  private monitors = new MonitorStore({
    procs: this.backgroundProcs,
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onResolve: (info) => this.onMonitorResolve(info)
  })
```
REPLACE:
```ts
  private monitors = new MonitorStore({
    procs: this.backgroundProcs,
    getSessionId: (agentId) => this.activeSessionId(agentId),
    onResolve: (info) => this.onMonitorResolve(info)
  })
  private procSubscriptions = new Set<string>()
```

**Edit 3 — attach the bridge at the end of the constructor.** FIND:
```ts
    this.idleCompactTimer = setInterval(() => void this.maybeCompactIdle(), 20_000)
    this.idleCompactTimer.unref?.()
  }
```
REPLACE:
```ts
    this.idleCompactTimer = setInterval(() => void this.maybeCompactIdle(), 20_000)
    this.idleCompactTimer.unref?.()
    // Bridge background-shell output to the renderer, but only for shells the
    // Processes panel has subscribed to (avoids flooding the renderer).
    this.backgroundProcs.on('data', (e: BgDataEvent) => {
      if (this.procSubscriptions.has(e.id)) this.deps.onBackgroundProcData?.(e)
    })
    this.backgroundProcs.on('exit', (e: BgExitEvent) => {
      if (this.procSubscriptions.has(e.id)) this.deps.onBackgroundProcExit?.(e)
    })
  }
```

- [ ] **Step 3c: Add the public methods** (place them right before `private onMonitorResolve`). FIND:
```ts
  private onMonitorResolve(info: MonitorResolveInfo): void {
```
REPLACE:
```ts
  backgroundProcsList(agentId: string): { id: string; command: string; status: 'running' | 'exited'; exitCode: number | null }[] {
    return this.backgroundProcs.list(agentId)
  }

  monitorsList(agentId: string): { id: string; targetId: string; until: string }[] {
    return this.monitors.list(agentId)
  }

  killBackgroundProc(id: string): void {
    this.backgroundProcs.kill(id)
  }

  subscribeBackgroundProc(id: string): { backlog: string; status: 'running' | 'exited'; exitCode: number | null } | null {
    const info = this.backgroundProcs.inspect(id)
    if (!info) return null
    this.procSubscriptions.add(id)
    return { backlog: info.buffer, status: info.status, exitCode: info.exitCode }
  }

  unsubscribeBackgroundProc(id: string): void {
    this.procSubscriptions.delete(id)
  }

  private onMonitorResolve(info: MonitorResolveInfo): void {
```

- [ ] **Step 3d: Clear subscriptions on dispose.** FIND:
```ts
    this.stopAll()
    this.monitors.cancelAll()
    this.backgroundProcs.killAll()
```
REPLACE:
```ts
    this.stopAll()
    this.monitors.cancelAll()
    this.backgroundProcs.killAll()
    this.procSubscriptions.clear()
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run tests/unit/agent-background-procs-bridge.test.ts` then `npm run typecheck`
Expected: test PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/meow-agent-manager.ts tests/unit/agent-background-procs-bridge.test.ts
git commit -m "feat(agent): manager list/kill/subscribe methods and renderer output bridge"
```

---

### Task 3: IPC surface (channels, preload, main handlers)

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: manager methods (Task 2).
- Produces: `window.api.backgroundProcsList / monitorsList / backgroundProcKill / backgroundProcSubscribe / backgroundProcUnsubscribe / onBackgroundProcData / onBackgroundProcExit`.

- [ ] **Step 1: Channels + `AgentApi`**

Two exact edits in `src/shared/ipc.ts`.

**Edit 1 — Channels.** FIND:
```ts
  AgentSetBackground: 'agent:set-background',
  EventAgentBackground: 'agent:background',
```
REPLACE:
```ts
  AgentSetBackground: 'agent:set-background',
  EventAgentBackground: 'agent:background',
  BackgroundProcsList: 'procs:list',
  MonitorsList: 'procs:monitors',
  BackgroundProcKill: 'procs:kill',
  BackgroundProcSubscribe: 'procs:subscribe',
  BackgroundProcUnsubscribe: 'procs:unsubscribe',
  EventBackgroundProcData: 'procs:data',
  EventBackgroundProcExit: 'procs:exit',
```

**Edit 2 — `AgentApi` methods** (and the `BackgroundProcInfo`/`MonitorInfo` type import). First the import — FIND the type-import list line that contains `FileSuggestion,` (near the top of `ipc.ts`) and add the two types to it:
```ts
  ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload, ImageContentResult,
```
REPLACE:
```ts
  BackgroundProcInfo, ConnectionAccount, ContextChangedEvent, ContextInfo, DirEntry, FileContentResult, FileSuggestion, FileViewerPayload, ImageContentResult, MonitorInfo,
```
Then the methods — FIND:
```ts
  setAgentBackground(agentId: string, background: boolean): Promise<void>
  onAgentBackground(cb: (e: { agentId: string; background: boolean }) => void): () => void
```
REPLACE:
```ts
  setAgentBackground(agentId: string, background: boolean): Promise<void>
  onAgentBackground(cb: (e: { agentId: string; background: boolean }) => void): () => void
  backgroundProcsList(agentId: string): Promise<BackgroundProcInfo[]>
  monitorsList(agentId: string): Promise<MonitorInfo[]>
  backgroundProcKill(id: string): Promise<void>
  backgroundProcSubscribe(id: string): Promise<{ backlog: string; status: 'running' | 'exited'; exitCode: number | null } | null>
  backgroundProcUnsubscribe(id: string): Promise<void>
  onBackgroundProcData(cb: (e: { id: string; chunk: string }) => void): () => void
  onBackgroundProcExit(cb: (e: { id: string; exitCode: number | null }) => void): () => void
```

- [ ] **Step 2: Preload**

In `src/preload/index.ts`. FIND:
```ts
  setAgentBackground: (agentId: string, background: boolean) =>
    ipcRenderer.invoke(Channels.AgentSetBackground, agentId, background),
  onAgentBackground: (cb: (e: { agentId: string; background: boolean }) => void) =>
    subscribe(Channels.EventAgentBackground, cb)
}
```
REPLACE:
```ts
  setAgentBackground: (agentId: string, background: boolean) =>
    ipcRenderer.invoke(Channels.AgentSetBackground, agentId, background),
  onAgentBackground: (cb: (e: { agentId: string; background: boolean }) => void) =>
    subscribe(Channels.EventAgentBackground, cb),
  backgroundProcsList: (agentId: string) => ipcRenderer.invoke(Channels.BackgroundProcsList, agentId),
  monitorsList: (agentId: string) => ipcRenderer.invoke(Channels.MonitorsList, agentId),
  backgroundProcKill: (id: string) => ipcRenderer.invoke(Channels.BackgroundProcKill, id),
  backgroundProcSubscribe: (id: string) => ipcRenderer.invoke(Channels.BackgroundProcSubscribe, id),
  backgroundProcUnsubscribe: (id: string) => ipcRenderer.invoke(Channels.BackgroundProcUnsubscribe, id),
  onBackgroundProcData: (cb: (e: { id: string; chunk: string }) => void) =>
    subscribe(Channels.EventBackgroundProcData, cb),
  onBackgroundProcExit: (cb: (e: { id: string; exitCode: number | null }) => void) =>
    subscribe(Channels.EventBackgroundProcExit, cb)
}
```

- [ ] **Step 3: Main — deps, MainApp methods, handlers**

Three exact edits in `src/main/index.ts`.

**Edit 1 — forward events to the renderer** (in the manager deps object). FIND:
```ts
    onBackgroundChange: (agentId, background) => {
      win?.webContents.send(Channels.EventAgentBackground, { agentId, background })
    },
```
REPLACE:
```ts
    onBackgroundChange: (agentId, background) => {
      win?.webContents.send(Channels.EventAgentBackground, { agentId, background })
    },
    onBackgroundProcData: (e) => { win?.webContents.send(Channels.EventBackgroundProcData, e) },
    onBackgroundProcExit: (e) => { win?.webContents.send(Channels.EventBackgroundProcExit, e) },
```

**Edit 2 — MainApp methods** (beside `setAgentBackground`). FIND:
```ts
  setAgentBackground(agentId: string, background: boolean): void {
    this.meowAgent.setBackground(agentId, background)
  }
```
REPLACE:
```ts
  setAgentBackground(agentId: string, background: boolean): void {
    this.meowAgent.setBackground(agentId, background)
  }

  backgroundProcsList(agentId: string) { return this.meowAgent.backgroundProcsList(agentId) }
  monitorsList(agentId: string) { return this.meowAgent.monitorsList(agentId) }
  killBackgroundProc(id: string): void { this.meowAgent.killBackgroundProc(id) }
  subscribeBackgroundProc(id: string) { return this.meowAgent.subscribeBackgroundProc(id) }
  unsubscribeBackgroundProc(id: string): void { this.meowAgent.unsubscribeBackgroundProc(id) }
```

**Edit 3 — handlers** (beside the `AgentSetBackground` handler). FIND:
```ts
  ipcMain.handle(Channels.AgentSetBackground, (_e, agentId: string, background: boolean) =>
    mainApp.setAgentBackground(agentId, background))
```
REPLACE:
```ts
  ipcMain.handle(Channels.AgentSetBackground, (_e, agentId: string, background: boolean) =>
    mainApp.setAgentBackground(agentId, background))
  ipcMain.handle(Channels.BackgroundProcsList, (_e, agentId: string) => mainApp.backgroundProcsList(agentId))
  ipcMain.handle(Channels.MonitorsList, (_e, agentId: string) => mainApp.monitorsList(agentId))
  ipcMain.handle(Channels.BackgroundProcKill, (_e, id: string) => mainApp.killBackgroundProc(id))
  ipcMain.handle(Channels.BackgroundProcSubscribe, (_e, id: string) => mainApp.subscribeBackgroundProc(id))
  ipcMain.handle(Channels.BackgroundProcUnsubscribe, (_e, id: string) => mainApp.unsubscribeBackgroundProc(id))
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean (node + web + extension + server).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(ipc): expose background procs/monitors list, kill, and output subscription"
```

---

### Task 4: `ProcessesOverlay` component + styles

**Files:**
- Create: `src/renderer/src/components/processes/ProcessesOverlay.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: the `window.api` methods from Task 3; `BackgroundProcInfo`/`MonitorInfo`.
- Produces: `ProcessesOverlay` (default export) + `PROCESSES_MIN_WIDTH`/`MAX`/`DEFAULT`.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/processes/ProcessesOverlay.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Skull, Terminal, X } from 'lucide-react'
import type { BackgroundProcInfo, MonitorInfo } from '@shared/types'

export const PROCESSES_MIN_WIDTH = 320
export const PROCESSES_MAX_WIDTH = 900
export const PROCESSES_DEFAULT_WIDTH = 420

interface Props {
  agentId: string
  full: boolean
  width: number
  onWidthChange: (width: number) => void
  onToggleFull: () => void
  onClose: () => void
}

export default function ProcessesOverlay({ agentId, full, width, onWidthChange, onToggleFull, onClose }: Props) {
  const [shells, setShells] = useState<BackgroundProcInfo[]>([])
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const outRef = useRef<HTMLPreElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      const next = Math.min(PROCESSES_MAX_WIDTH, Math.max(PROCESSES_MIN_WIDTH, dragRef.current.startWidth + delta))
      onWidthChange(next)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, onWidthChange])

  // Poll the lists while open.
  useEffect(() => {
    let alive = true
    const load = async () => {
      const [s, m] = await Promise.all([window.api.backgroundProcsList(agentId), window.api.monitorsList(agentId)])
      if (!alive) return
      setShells(s)
      setMonitors(m)
      setSelected(cur => (cur && s.some(x => x.id === cur) ? cur : (s[0]?.id ?? null)))
    }
    void load()
    const t = setInterval(() => void load(), 1500)
    return () => { alive = false; clearInterval(t) }
  }, [agentId])

  // Stream the selected shell's output.
  useEffect(() => {
    if (!selected) { setOutput(''); return }
    let alive = true
    setOutput('')
    void window.api.backgroundProcSubscribe(selected).then(res => { if (alive && res) setOutput(res.backlog) })
    const offData = window.api.onBackgroundProcData(e => { if (e.id === selected) setOutput(prev => prev + e.chunk) })
    const offExit = window.api.onBackgroundProcExit(e => {
      if (e.id === selected) setShells(prev => prev.map(s => s.id === e.id ? { ...s, status: 'exited', exitCode: e.exitCode } : s))
    })
    return () => {
      alive = false
      offData()
      offExit()
      void window.api.backgroundProcUnsubscribe(selected)
    }
  }, [selected])

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      className={`files-overlay processes-overlay${full ? ' full' : ' docked'}`}
      style={full ? undefined : { width }}
      role="dialog"
      aria-label="Processes"
    >
      {!full && <div className="files-resizer" onMouseDown={startDrag} />}
      <div className="files-head title-bar">
        <div className="files-head-title">
          <Terminal size={14} aria-hidden="true" />
          <span>Processes</span>
        </div>
        <div className="files-head-actions">
          <button className="icon-btn" title={full ? 'Restore size' : 'Expand'} aria-label={full ? 'Restore size' : 'Expand'} onClick={onToggleFull}>
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Processes" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="files-body">
        <div className="files-side processes-side">
          <div className="processes-group-title">Shells</div>
          {shells.length === 0 && <div className="processes-empty">No background shells.</div>}
          {shells.map(s => (
            <div
              key={s.id}
              className={`processes-row${s.id === selected ? ' active' : ''}`}
              onClick={() => setSelected(s.id)}
            >
              <span className={`status-dot status-${s.status === 'running' ? 'busy' : 'idle'}`} />
              <span className="processes-cmd" title={s.id}>{s.command}</span>
              {s.status === 'exited' && <span className="processes-exit">exit {s.exitCode ?? '?'}</span>}
              {s.status === 'running' && (
                <button
                  className="icon-btn processes-kill"
                  title="Kill"
                  aria-label={`Kill ${s.command}`}
                  onClick={ev => { ev.stopPropagation(); void window.api.backgroundProcKill(s.id) }}
                >
                  <Skull size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <div className="processes-group-title">Monitors</div>
          {monitors.length === 0 && <div className="processes-empty">No active monitors.</div>}
          {monitors.map(m => (
            <div key={m.id} className="processes-row processes-monitor" title={`monitor ${m.id}`}>
              <span className="status-dot status-busy" />
              <span className="processes-cmd">→ {m.targetId}</span>
              <span className="processes-until">{m.until}</span>
            </div>
          ))}
        </div>
        <div className="files-main processes-main">
          {selected ? (
            <pre ref={outRef} className="processes-output">{output || '(no output yet)'}</pre>
          ) : (
            <div className="files-empty">
              <Terminal size={30} aria-hidden="true" />
              <div className="files-empty-title">No shell selected</div>
              <div className="files-empty-hint">Start one with a background bash command, then pick it on the left.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add styles**

Append to `src/renderer/src/styles.css`:

```css
/* Processes overlay: reuses .files-overlay layout; only the inner list/output differ. */
.processes-side { padding: 6px 0; overflow-y: auto; }
.processes-group-title {
  font: var(--font-display);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  padding: 8px 12px 4px;
}
.processes-empty { padding: 4px 12px 8px; color: var(--text-faint); font-size: 12px; }
.processes-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.processes-row:hover { background: var(--menu-hover); }
.processes-row.active { background: var(--menu-hover); }
.processes-cmd { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, monospace); }
.processes-exit { color: var(--text-faint); font-variant-numeric: tabular-nums; }
.processes-until { color: var(--text-faint); font-family: var(--font-mono, monospace); }
.processes-kill { color: var(--text-faint); }
.processes-kill:hover { color: var(--red, #e5484d); }
.processes-monitor { cursor: default; }
.processes-main { display: flex; }
.processes-output {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (The component compiles against the `window.api` methods added in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/processes/ProcessesOverlay.tsx src/renderer/src/styles.css
git commit -m "feat(ui): add ProcessesOverlay component and styles"
```

---

### Task 5: Wire the overlay into App and the pane menu

**Files:**
- Modify: `src/renderer/src/components/PaneHeader.tsx`
- Modify: `src/renderer/src/components/Pane.tsx`
- Modify: `src/renderer/src/components/SessionPanes.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `ProcessesOverlay` (Task 4).
- Produces: a "Processes" `⋮` menu item that opens the overlay for that pane's agent.

- [ ] **Step 1: `PaneHeader` — prop + menu item**

Three exact edits in `src/renderer/src/components/PaneHeader.tsx`.

**Edit 1 — prop type** (beside `onOpenFiles`). FIND:
```ts
  onOpenFiles?: () => void
```
REPLACE:
```ts
  onOpenFiles?: () => void
  onOpenProcesses?: () => void
```

**Edit 2 — destructure** (beside `onOpenFiles,`). FIND:
```ts
  onOpenFiles,
```
REPLACE:
```ts
  onOpenFiles,
  onOpenProcesses,
```

**Edit 3 — menu item** (after the Files item). FIND:
```ts
            {onOpenFiles && (
              <button className="menu-item" onClick={() => { close(); onOpenFiles() }}>
                <FolderTree size={16} aria-hidden="true" />
                Files
              </button>
            )}
```
REPLACE:
```ts
            {onOpenFiles && (
              <button className="menu-item" onClick={() => { close(); onOpenFiles() }}>
                <FolderTree size={16} aria-hidden="true" />
                Files
              </button>
            )}
            {onOpenProcesses && (
              <button className="menu-item" onClick={() => { close(); onOpenProcesses() }}>
                <Terminal size={16} aria-hidden="true" />
                Processes
              </button>
            )}
```

**Edit 4 — import the `Terminal` icon.** FIND:
```ts
import {
  Code,
```
REPLACE:
```ts
import {
  Terminal,
  Code,
```

- [ ] **Step 2: `Pane` — thread the prop**

Three exact edits in `src/renderer/src/components/Pane.tsx`.

**Edit 1 — prop type.** FIND:
```ts
  onOpenFiles?: () => void
}
```
REPLACE:
```ts
  onOpenFiles?: () => void
  onOpenProcesses?: () => void
}
```

**Edit 2 — destructure.** FIND:
```ts
export default function Pane({ pane, background, active, onFocus, onRemove, onSendDraftMessage, onOpenFiles }: Props) {
```
REPLACE:
```ts
export default function Pane({ pane, background, active, onFocus, onRemove, onSendDraftMessage, onOpenFiles, onOpenProcesses }: Props) {
```

**Edit 3 — pass to `PaneHeader`.** FIND:
```ts
        onOpenFiles={onOpenFiles}
        onRemove={onRemove}
```
REPLACE:
```ts
        onOpenFiles={onOpenFiles}
        onOpenProcesses={onOpenProcesses}
        onRemove={onRemove}
```

- [ ] **Step 3: `SessionPanes` — thread + per-pane binding**

Three exact edits in `src/renderer/src/components/SessionPanes.tsx`.

**Edit 1 — prop type.** FIND:
```ts
  onOpenFiles?: (id: string) => void
}
```
REPLACE:
```ts
  onOpenFiles?: (id: string) => void
  onOpenProcesses?: (id: string) => void
}
```

**Edit 2 — destructure.** FIND:
```ts
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove, onSendDraftMessage, onOpenFiles }: Props) {
```
REPLACE:
```ts
export default function SessionPanes({ panes, activeId, onActiveChange, backgrounds, onRemove, onSendDraftMessage, onOpenFiles, onOpenProcesses }: Props) {
```

**Edit 3 — per-pane binding.** FIND:
```ts
            onOpenFiles={onOpenFiles ? () => onOpenFiles(pane.agent.id) : undefined}
```
REPLACE:
```ts
            onOpenFiles={onOpenFiles ? () => onOpenFiles(pane.agent.id) : undefined}
            onOpenProcesses={onOpenProcesses ? () => onOpenProcesses(pane.agent.id) : undefined}
```

- [ ] **Step 4: `App.tsx` — thread through `WorkspaceView` and render the overlay**

Seven exact edits in `src/renderer/src/App.tsx`.

**Edit 1 — import.** FIND:
```ts
import FilesOverlay, { FILES_DEFAULT_WIDTH, FILES_MAX_WIDTH, FILES_MIN_WIDTH } from './components/files/FilesOverlay'
```
REPLACE:
```ts
import FilesOverlay, { FILES_DEFAULT_WIDTH, FILES_MAX_WIDTH, FILES_MIN_WIDTH } from './components/files/FilesOverlay'
import ProcessesOverlay, { PROCESSES_DEFAULT_WIDTH, PROCESSES_MAX_WIDTH, PROCESSES_MIN_WIDTH } from './components/processes/ProcessesOverlay'
```

**Edit 2 — `WorkspaceView` prop (destructure).** FIND:
```ts
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane, onSendDraftMessage, onOpenFiles
}: {
```
REPLACE:
```ts
  runtime, backgrounds, activeSessionByPath, onActiveChange, onRemovePane, onSendDraftMessage, onOpenFiles, onOpenProcesses
}: {
```

**Edit 3 — `WorkspaceView` prop type.** FIND:
```ts
  onOpenFiles: (id: string) => void
}) {
```
REPLACE:
```ts
  onOpenFiles: (id: string) => void
  onOpenProcesses: (id: string) => void
}) {
```

**Edit 4 — pass to `SessionPanes`.** FIND:
```ts
        onOpenFiles={() => onOpenFiles(runtime.workspace.projectPath)}
      />
```
REPLACE:
```ts
        onOpenFiles={() => onOpenFiles(runtime.workspace.projectPath)}
        onOpenProcesses={onOpenProcesses}
      />
```

**Edit 5 — state** (after the Files width state). FIND:
```ts
  const [filesWidth, setFilesWidth] = useState(() => {
    const w = Number(localStorage.getItem('meow.files.width'))
    return Number.isFinite(w) && w >= FILES_MIN_WIDTH && w <= FILES_MAX_WIDTH ? w : FILES_DEFAULT_WIDTH
  })
```
REPLACE:
```ts
  const [filesWidth, setFilesWidth] = useState(() => {
    const w = Number(localStorage.getItem('meow.files.width'))
    return Number.isFinite(w) && w >= FILES_MIN_WIDTH && w <= FILES_MAX_WIDTH ? w : FILES_DEFAULT_WIDTH
  })
  const [processesOpenFor, setProcessesOpenFor] = useState<string | null>(null)
  const [processesFull, setProcessesFull] = useState(false)
  const [processesWidth, setProcessesWidth] = useState(() => {
    const w = Number(localStorage.getItem('meow.processes.width'))
    return Number.isFinite(w) && w >= PROCESSES_MIN_WIDTH && w <= PROCESSES_MAX_WIDTH ? w : PROCESSES_DEFAULT_WIDTH
  })
  useEffect(() => { localStorage.setItem('meow.processes.width', String(processesWidth)) }, [processesWidth])
```

**Edit 6 — pass `onOpenProcesses` to both `WorkspaceView` renders.** This FIND occurs twice (active + hidden); apply the same replacement to **both** occurrences. FIND:
```ts
                  onOpenFiles={projectPath => { setFilesFull(false); setFilesOpenFor(projectPath) }}
```
REPLACE:
```ts
                  onOpenFiles={projectPath => { setFilesFull(false); setFilesOpenFor(projectPath) }}
                  onOpenProcesses={agentId => { setProcessesFull(false); setProcessesOpenFor(agentId) }}
```

**Edit 7 — render the overlay** (beside the Files overlay). FIND:
```ts
          {filesOpenFor && (
            <FilesOverlay
              projectPath={filesOpenFor}
              full={filesFull}
              width={filesWidth}
              onWidthChange={setFilesWidth}
              onToggleFull={() => setFilesFull(v => !v)}
              onClose={() => setFilesOpenFor(null)}
            />
          )}
```
REPLACE:
```ts
          {filesOpenFor && (
            <FilesOverlay
              projectPath={filesOpenFor}
              full={filesFull}
              width={filesWidth}
              onWidthChange={setFilesWidth}
              onToggleFull={() => setFilesFull(v => !v)}
              onClose={() => setFilesOpenFor(null)}
            />
          )}
          {processesOpenFor && (
            <ProcessesOverlay
              agentId={processesOpenFor}
              full={processesFull}
              width={processesWidth}
              onWidthChange={setProcessesWidth}
              onToggleFull={() => setProcessesFull(v => !v)}
              onClose={() => setProcessesOpenFor(null)}
            />
          )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean across all projects. (`useEffect` is already imported in `App.tsx`; if the typecheck reports it missing, add it to the existing `react` import.)

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`
Then, in the app:
1. In a session, send a prompt that runs a background shell, e.g. ask the agent to run `bash` with `run_in_background` on a chatty command (or use one that emits over time, like a short loop).
2. Open the pane's `⋮` menu → **Processes**. Confirm the panel docks on the right (resizable, Expand, Esc/✕ close).
3. Confirm the shell appears under **Shells**, select it, and its output streams live in the right pane.
4. Ask the agent to `monitor` that shell; confirm it appears under **Monitors** with the `until` summary, and disappears when it resolves.
5. Click **Kill** on a running shell; confirm it flips to `exited`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/Pane.tsx src/renderer/src/components/SessionPanes.tsx
git commit -m "feat(ui): open Processes overlay from the pane menu (per session)"
```

---

## Self-Review

**1. Spec coverage:**
- Store accessors `list()` (spec §1) → Task 1. ✓
- IPC surface list/monitors/kill/subscribe/unsubscribe + data/exit events (spec §2) → Task 3 (types in Task 1). ✓
- Subscription forwarding in the manager (spec §3) → Task 2. ✓
- `ProcessesOverlay` two-column, live output, kill (spec §4) → Task 4. ✓
- App wiring by agent id + `⋮` menu (spec §5) → Task 5. ✓
- Lifecycle: unsubscribe on close/change/unmount, clear on dispose (spec §6) → Task 4 (effect cleanup) + Task 2 Step 3d. ✓
- Testing: main-process TDD + manual smoke (spec §7) → Tasks 1–2 tests + Task 5 smoke. ✓

**2. Placeholder scan:** No `TBD`/`TODO`; every code step has real code; the React component is complete.

**3. Type consistency:** `BackgroundProcInfo` / `MonitorInfo` fields match across shared types, store `list()`, IPC signatures, and the component. `backgroundProcSubscribe` returns `{ backlog, status, exitCode }` in the manager, the IPC signature, and the component. `onBackgroundProcData` / `onBackgroundProcExit` payloads (`{id,chunk}` / `{id,exitCode}`) match across store emit, manager bridge, preload, and component. The `onOpenProcesses` prop threads App → WorkspaceView → SessionPanes (id-bound) → Pane → PaneHeader with consistent signatures.
```
