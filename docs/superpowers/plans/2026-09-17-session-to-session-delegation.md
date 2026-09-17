# Session-to-Session Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Meow Coding session delegate a task to another session in the same project, let the target run independently, and durably return the result to the source session without stealing UI focus.

**Architecture:** Add a durable `SessionDelegationService` between the agent runtime and session stores. It owns validation, lifecycle transitions, per-target scheduling, restart recovery, and result delivery. The agent manager exposes a small runtime adapter to execute a turn against a fixed internal session and to enqueue a result wake-up that is deferred until the source agent is idle. The renderer projects durable records into chat cards, sidebar counts, and navigation.

**Tech Stack:** Electron 41, React 19, TypeScript strict, Vitest, Playwright, JSON stores under Electron `userData`.

**Spec:** `docs/superpowers/specs/2026-09-17-session-to-session-delegation-design.md`

## Global Constraints

- Use “session” in UI copy and `agent` only where the existing backend identifier requires it.
- Delegation is same-project and one level deep. A delegated run cannot call `delegate_session`.
- A busy target queues the delegated run; it is never injected as a steering message.
- The target keeps its own model, mode, permission rules, hooks, MCP servers, and tools.
- Prompts are answered in the target session. The source only receives durable status updates.
- A result wakes the source only when the source is idle. Existing direct user messages have priority.
- All store transitions are revisioned and idempotent. Restart never retries a run that may already have caused side effects.
- Update the nearest `AGENTS.md` and matching `docs/reference/` pages with every behavior or structure change.
- Do not hardcode IPC strings outside `src/shared/ipc.ts`.
- Run focused tests after every red/green step and commit after each task.

## Planned File Structure

```text
src/shared/types.ts
src/shared/ipc.ts
src/main/agent/run-context.ts
src/main/session-delegation-store.ts
src/main/session-delegation-service.ts
src/main/agent/tools/delegate-session.ts
src/main/meow-agent-manager.ts
src/main/index.ts
src/preload/index.ts
src/renderer/src/components/chat/DelegationCard.tsx
src/renderer/src/components/chat/ChatPanel.tsx
src/renderer/src/components/Sidebar.tsx
src/renderer/src/App.tsx
tests/unit/session-delegation-store.test.ts
tests/unit/session-delegation-service.test.ts
tests/unit/delegate-session-tool.test.ts
tests/unit/meow-agent-manager-delegation.test.ts
tests/unit/delegation-card.test.tsx
tests/unit/sidebar-delegation.test.tsx
tests/integration/delegation-ipc.test.ts
tests/e2e/session-delegation.spec.ts
```

Use the repository’s actual neighboring test directories and naming if implementation-time inspection shows a more specific established convention. Do not create a parallel convention.

---

### Task 1: Define the Shared Model, Run Context, and Durable Store

**Files:**

- Create: `src/main/agent/run-context.ts`
- Create: `src/main/session-delegation-store.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/agent/session.ts`
- Test: `tests/unit/session-delegation-store.test.ts`
- Modify: `src/main/AGENTS.md`
- Modify: `src/main/agent/AGENTS.md`
- Modify: `docs/reference/03-agent-runtime.md`
- Modify: `docs/reference/06-data-and-storage.md`

- [ ] **Step 1: Write failing store and session idempotency tests**

Cover queued creation at revision 1, disk reload, allowed and rejected transitions, revision conflicts, source/target/project filters, recovery of in-flight records, and duplicate deterministic message IDs. Use a unique temporary directory per test and assert serialized JSON.

- [ ] **Step 2: Run the test and confirm the missing implementation fails**

```powershell
npx vitest run tests/unit/session-delegation-store.test.ts
```

Expected: FAIL because the store, run-context types, and idempotent session helpers do not exist.

- [ ] **Step 3: Add shared delegation contracts**

Add to `src/shared/types.ts`:

```ts
export type DelegationStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface ChatDelegationMeta {
  id: string
  direction: 'incoming' | 'result'
  peerAgentId: string
  peerName: string
}

export interface SessionDelegation {
  id: string
  projectPath: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string
  task: string
  status: DelegationStatus
  revision: number
  targetBusyAtCreation: boolean
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  resultTruncated?: boolean
  error?: string
  touchedFiles?: string[]
  deliveredAt?: number
  wakeAt?: number
}

export type SessionDelegationSummary = SessionDelegation

export interface DelegationChangedEvent {
  delegation: SessionDelegationSummary
}
```

Extend the existing records in place rather than introducing parallel message types. Add these exact optional properties to their current declarations:

```ts
// ChatMessage
delegation?: ChatDelegationMeta

// ToolCallData
metadata?: Record<string, unknown>

// QueuedMessage
deferUntilIdle?: boolean
delegation?: ChatDelegationMeta
```

- [ ] **Step 4: Add fixed run identity contracts**

Create `src/main/agent/run-context.ts`:

```ts
export interface AgentRunContext {
  runId: string
  agentId: string
  sessionId: string
  origin: 'user' | 'delegation'
}

export interface AgentTurnResult {
  runId: string
  reason: 'completed' | 'failed' | 'cancelled'
  finalText?: string
  error?: string
  touchedFiles: string[]
}

export interface DelegatedTurnInput {
  delegationId: string
  sourceAgentId: string
  sourceName: string
  targetAgentId: string
  targetSessionId: string
  task: string
}

export interface DelegationResultInput {
  delegationId: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetName: string
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  result?: string
  error?: string
  touchedFiles: string[]
}
```

- [ ] **Step 5: Implement the durable store**

Expose:

```ts
export interface CreateDelegationRecord {
  id: string
  projectPath: string
  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string
  targetBusyAtCreation: boolean
  task: string
}

export interface TransitionPatch {
  startedAt?: number
  finishedAt?: number
  result?: string
  resultTruncated?: boolean
  error?: string
  touchedFiles?: string[]
  deliveredAt?: number
  wakeAt?: number
}

export class SessionDelegationStore {
  constructor(filePath: string, now?: () => number)
  load(): Promise<void>
  create(input: CreateDelegationRecord): Promise<SessionDelegation>
  get(id: string): SessionDelegation | undefined
  list(filter?: {
    projectPath?: string
    sourceAgentId?: string
    targetAgentId?: string
  }): SessionDelegation[]
  transition(
    id: string,
    expectedRevision: number,
    status: DelegationStatus,
    patch?: TransitionPatch,
  ): Promise<SessionDelegation | undefined>
  markDelivered(
    id: string,
    expectedRevision: number,
    deliveredAt: number,
  ): Promise<SessionDelegation | undefined>
  markWoken(
    id: string,
    expectedRevision: number,
    wakeAt: number,
  ): Promise<SessionDelegation | undefined>
  recoverInterrupted(): Promise<SessionDelegation[]>
  purgeTerminalBefore(cutoff: number): Promise<string[]>
}
```

Use the explicit transition table. `markDelivered` and `markWoken` are the only allowed post-terminal metadata mutations; both are revision-checked and idempotent:

```ts
const ALLOWED_TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['waiting_for_input', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting_for_input: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
}
```

Follow the existing atomic JSON-store pattern and path normalization helper. Return clones so callers cannot mutate state outside a revisioned transition. Purge terminal records older than 30 days, and purge earlier when both participating sessions have been deleted.

- [ ] **Step 6: Add deterministic message helpers to `SessionStore`**

```ts
hasMessage(sessionId: string, messageId: string): boolean
appendMessageIfMissing(sessionId: string, message: ChatMessage): Promise<boolean>
```

Return `false` without writing when the message ID already exists.

- [ ] **Step 7: Verify and commit**

```powershell
npx vitest run tests/unit/session-delegation-store.test.ts
npm run typecheck
git add src/shared/types.ts src/main/agent/run-context.ts src/main/agent/session.ts src/main/session-delegation-store.ts tests/unit/session-delegation-store.test.ts docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: add durable session delegation records"
```

---

### Task 2: Build the Delegation Service and Lifecycle Scheduler

**Files:**

- Create: `src/main/session-delegation-service.ts`
- Test: `tests/unit/session-delegation-service.test.ts`
- Modify: `src/main/AGENTS.md`
- Modify: `docs/reference/02-architecture.md`
- Modify: `docs/reference/03-agent-runtime.md`
- Modify: `docs/reference/06-data-and-storage.md`

- [ ] **Step 1: Write failing service tests using a fake runtime and deferred promises**

Cover self/cross-project/missing/nested rejection; 32 KiB task and five-active-item limits; immediate idle execution; busy FIFO behavior; one target run at a time; prompt-state transitions; exactly-once delivery; 64 KiB UTF-8-safe result truncation; queued cancellation; queued restart resumption; in-flight restart interruption without retry; 30-day retention; both-sessions-deleted cleanup; and shutdown suspension.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/unit/session-delegation-service.test.ts
```

- [ ] **Step 3: Define the runtime boundary**

```ts
export interface DelegationAgent {
  agentId: string
  name: string
  projectPath: string
  sessionId: string
}

export interface DelegationRuntime {
  resolveAgent(agentId: string): DelegationAgent | undefined
  isBusy(agentId: string): boolean
  runDelegatedTurn(input: DelegatedTurnInput): Promise<AgentTurnResult>
  appendResult(input: DelegationResultInput): Promise<void>
  wakeSource(input: DelegationResultInput): Promise<void>
}

export interface CreateDelegationInput {
  sourceRun: AgentRunContext
  targetAgentId: string
  task: string
}
```

Inject the store, runtime, ID factory, clock, and event callback.

- [ ] **Step 4: Implement validated durable creation**

Require a user-origin run; resolve both agents; reject self/cross-project/missing targets; validate nonblank UTF-8 task size; cap `queued` + `running` + `waiting_for_input` at five per target; snapshot `targetBusyAtCreation`; persist `queued` before scheduling; emit the persisted record.

- [ ] **Step 5: Implement a single-flight FIFO pump per target**

Maintain one target lock. Select the oldest queued record by `(createdAt, id)`, revalidate agents/project, wait for an availability notification when busy, transition to `running`, await the run, persist terminal status, and continue FIFO.

Expose:

```ts
notifyAgentAvailable(agentId: string): void
notifyPromptState(delegationId: string, waiting: boolean): Promise<void>
claimSourceWake(delegationId: string, wakeAt: number): Promise<boolean>
cancelQueued(id: string): Promise<SessionDelegation>
handleAgentRemoved(agentId: string): Promise<void>
handleProjectRemoved(projectPath: string): Promise<void>
start(): Promise<void>
suspend(): void
```

Do not poll. Agent removal fails affected queued/running target work, while source deletion retains terminal output without waking. Project removal cancels its nonterminal records and retains terminal audit records until retention cleanup.

- [ ] **Step 6: Implement terminal persistence and exactly-once delivery**

Persist the terminal record first, call the idempotent `runtime.appendResult`, and then persist `deliveredAt`. Next call the idempotent `runtime.wakeSource`; immediately before the queued wake invokes the model, the manager calls `claimSourceWake`, which revision-persists `wakeAt` and returns `false` if another recovery path already claimed it. This ordering lets startup finish either partially completed phase without repeating a claimed wake. On startup, append terminal records missing `deliveredAt`, schedule terminal records missing `wakeAt`, resume records that were durably `queued`, and apply retention cleanup. Recover `running` and `waiting_for_input` as `interrupted`, deliver the interruption once, and never rerun the target task. When a result is truncated, persist `resultTruncated: true` so the source card can link to the full target conversation. If the source was deleted, retain the terminal result, mark delivery handled, and skip wake-up.

- [ ] **Step 7: Verify, document, and commit**

```powershell
npx vitest run tests/unit/session-delegation-service.test.ts
npm run typecheck
git add src/main/session-delegation-service.ts tests/unit/session-delegation-service.test.ts docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: schedule durable session delegations"
```

---

### Task 3: Add the Model Tool, Runtime Guard, Permission Rule, and Peer Roster

**Files:**

- Create: `src/main/agent/tools/delegate-session.ts`
- Modify: `src/main/agent/tools/types.ts`
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/agent/config.ts`
- Modify: `src/main/agent/permission.ts`
- Modify: `src/main/agent/prompt.ts`
- Modify: `src/main/meow-agent-manager.ts` (construct/register the tool beside `createTaskTool`)
- Test: `tests/unit/delegate-session-tool.test.ts`
- Modify: `src/main/agent/AGENTS.md`
- Modify: `src/main/agent/tools/AGENTS.md`
- Modify: `docs/reference/03-agent-runtime.md`
- Modify: `docs/reference/04-tool-catalog.md`

- [ ] **Step 1: Write failing tool, permission, prompt, and metadata tests**

Assert required arguments, successful user-origin creation, nested-origin rejection, build allow, plan ask, same-project peer filtering, current-session exclusion, tool metadata persistence, and prompt guidance distinguishing persistent session delegation from ephemeral `task` subagents.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/unit/delegate-session-tool.test.ts
```

- [ ] **Step 3: Extend tool execution contracts**

Add `runContext?: AgentRunContext` to `ToolContext`, `metadata?: Record<string, unknown>` to `ToolRunResult`, and `runContext?: () => AgentRunContext | undefined` to loop dependencies. Snapshot it for each invocation and copy result metadata to the matching `ToolCallData` before persistence/emission.

- [ ] **Step 4: Implement `delegate_session`**

Use JSON schema fields `target_session_id` and `task`, both required non-empty strings with `additionalProperties: false`. Describe the tool as routing work to an existing persistent session, in contrast to the isolated ephemeral `task` worker. Call:

```ts
createDelegation(input: CreateDelegationInput): Promise<SessionDelegation>
```

Return:

```ts
{
  output: `Delegation ${record.id} queued for session ${record.targetAgentId}.`,
  metadata: { delegationId: record.id },
}
```

The renderer must never parse prose to recover the ID.

- [ ] **Step 5: Add permission behavior and live peer discovery**

Add `delegate_session: 'allow'` to default build rules and `delegate_session: 'ask'` to plan-mode rules. Extend `buildTurnReminder` with a bounded optional list:

```ts
export interface SessionPeer {
  agentId: string
  name: string
  mode: AgentMode
  state: 'idle' | 'running' | 'waiting_for_input'
}
```

Render each peer with name, session ID, mode, and state. Generate the list per turn, exclude the current agent, and include same-project agents only. The reminder must distinguish `delegate_session` from the ephemeral `task` tool and tell the source not to edit the delegated scope before the result returns.

- [ ] **Step 6: Register the tool per runner**

Follow the existing `task` construction pattern so service dependencies are bound to the manager instance. Do not reuse subagent task internals.

- [ ] **Step 7: Verify, document, and commit**

```powershell
npx vitest run tests/unit/delegate-session-tool.test.ts
npm run typecheck
git add src/main/agent tests/unit/delegate-session-tool.test.ts docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: expose session delegation tool"
```

---

### Task 4: Correlate Runs in the Agent Manager and Defer Source Wake-Ups

**Files:**

- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/meow-agent-manager-delegation.test.ts`
- Modify: `src/main/AGENTS.md`
- Modify: `docs/reference/02-architecture.md`
- Modify: `docs/reference/03-agent-runtime.md`

- [ ] **Step 1: Write failing manager tests**

Cover fixed internal session identity through a run; matching final text/error/touched files; idempotent incoming message storage; busy-source result deferral; exclusion from steering; direct-user-message priority; no result loss when the visible user queue is full; deterministic result messages; context-safe result injection; wake claiming; and service notifications. Include a regression test that switches the UI-selected session mid-run and confirms all transcript, usage, todo, replacement, and artifact writes remain on the original run session.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/unit/meow-agent-manager-delegation.test.ts
```

- [ ] **Step 3: Track an explicit active run**

```ts
interface ActiveRun {
  context: AgentRunContext
  finalText?: string
  error?: string
  touchedFiles: Set<string>
}

private readonly activeRuns = new Map<string, ActiveRun>()
```

Add `runSessionId(agentId)` and replace dynamic active-session lookups inside all runner callbacks. Capture terminal assistant text and normalized artifact paths for the matching run.

- [ ] **Step 4: Refactor turn execution around typed options**

```ts
interface RunTurnOptions {
  sessionId?: string
  origin?: 'user' | 'delegation'
  messageId?: string
  delegation?: ChatDelegationMeta
  messageAlreadyPersisted?: boolean
}

private async runTurn(
  agentId: string,
  content: string,
  options?: RunTurnOptions,
): Promise<AgentTurnResult>
```

Generate `runId` before invoking the runner, install/remove the active record with `try/finally`, and return the correlated result. Preserve current renderer events.

- [ ] **Step 5: Implement the runtime adapter**

Add:

```ts
resolveDelegationAgent(agentId: string): DelegationAgent | undefined
isBusy(agentId: string): boolean
runDelegatedTurn(input: DelegatedTurnInput): Promise<AgentTurnResult>
appendDelegationResult(input: DelegationResultInput): Promise<void>
wakeDelegationSource(input: DelegationResultInput): Promise<void>
```

`runDelegatedTurn` appends ID `delegation-incoming:<delegationId>` with incoming metadata and runs against `targetSessionId` with delegation origin.

- [ ] **Step 6: Implement deterministic source delivery and queue priority**

`appendDelegationResult` persists ID `delegation-result:<delegationId>` with result metadata. `wakeDelegationSource` idempotently creates an internal queued entry keyed by the same delegation ID, starts drain immediately if the source is idle, or leaves it with `deferUntilIdle: true` if busy. Format model input through the existing context-safe truncation helper while the result card retains the stored result and full-conversation link. Internal result wakes are not rejected by the five-item user-message queue cap. Before invoking the model, await `claimSourceWake`; discard the queue entry when it returns `false`. Pass `messageAlreadyPersisted: true` when it becomes model input. Split consumption into:

```ts
private takeSteers(agentId: string): QueuedMessage[]
private takeNextQueuedTurn(agentId: string): QueuedMessage | undefined
```

`takeSteers` returns only nondeferred entries. `takeNextQueuedTurn` selects oldest direct user input before oldest deferred result.

- [ ] **Step 7: Notify lifecycle changes**

Use narrow optional callbacks to report target availability, prompt open/answer, removal, and disposal. At turn completion, start all older direct queued work before notifying the delegation service that a target is available; this preserves the approved priority order. Suspend the service before manager teardown.

- [ ] **Step 8: Verify, document, and commit**

```powershell
npx vitest run tests/unit/meow-agent-manager-delegation.test.ts
npm run typecheck
git add src/main/meow-agent-manager.ts tests/unit/meow-agent-manager-delegation.test.ts docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: run delegated turns in fixed sessions"
```

---

### Task 5: Compose the Service and Expose Safe IPC

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/integration/delegation-ipc.test.ts`
- Modify: `src/main/AGENTS.md`
- Modify: `docs/reference/02-architecture.md`
- Modify: `docs/reference/05-ipc-contract.md`
- Modify: `docs/reference/06-data-and-storage.md`

- [ ] **Step 1: Write failing IPC and lifecycle integration tests**

Cover scoped listing, queued-only cancellation, revisioned changed events, startup recovery/redelivery, agent deletion, project removal, shutdown ordering, and exact preload listener removal.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/integration/delegation-ipc.test.ts
```

- [ ] **Step 3: Add centralized channels and `AgentApi` methods**

```ts
DelegationList: 'delegation:list',
DelegationCancel: 'delegation:cancel',
EventDelegationChanged: 'event:delegation-changed',
```

```ts
listDelegations(filter: {
  projectPath?: string
  agentId?: string
}): Promise<SessionDelegationSummary[]>
cancelDelegation(id: string): Promise<SessionDelegationSummary>
onDelegationChanged(
  listener: (event: DelegationChangedEvent) => void,
): () => void
```

Follow existing IPC envelopes and never expose raw `ipcRenderer`.

- [ ] **Step 4: Compose store, service, and manager in `MainApp`**

Use `path.join(app.getPath('userData'), 'delegations.json')`. Resolve constructor dependencies with lazy closures, not a mutable module singleton. Load stores first, start delegation recovery after existing agent reset, and suspend/flush the service before manager disposal.

- [ ] **Step 5: Register handlers and event forwarding**

Validate inputs in main, scope list records by project or source/target membership, delegate transition validation to the service, and broadcast only `DelegationChangedEvent`. Mirror the established preload subscribe/unsubscribe pattern.

- [ ] **Step 6: Verify, document, and commit**

```powershell
npx vitest run tests/integration/delegation-ipc.test.ts
npm run typecheck
git add src/main/index.ts src/shared/ipc.ts src/preload/index.ts tests/integration/delegation-ipc.test.ts docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: expose session delegation lifecycle"
```

---

### Task 6: Render Delegation Cards in Both Session Feeds

**Files:**

- Create: `src/renderer/src/components/chat/DelegationCard.tsx`
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`
- Modify: `src/renderer/src/components/chat/ToolCallCard.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/SessionPanes.tsx`
- Test: `tests/unit/delegation-card.test.tsx`
- Modify: `src/renderer/AGENTS.md`
- Modify: `src/renderer/src/components/AGENTS.md`
- Modify: `src/renderer/src/components/chat/AGENTS.md`
- Modify: `docs/reference/09-ui-guide.md`

- [ ] **Step 1: Write failing component/feed tests**

Test outgoing peer/task/status/cancel; a shared-working-tree warning when another same-project session is already running at dispatch time; a virtual queued incoming card with target-side cancel; replacement of that virtual card by the persisted incoming transcript item when execution starts; result text/error/touched files/target link; a full-target-conversation link for truncated results; metadata correlation; stale-revision rejection; and navigation callback behavior.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/unit/delegation-card.test.tsx
```

- [ ] **Step 3: Implement an explicit reusable card**

```ts
export interface DelegationCardProps {
  kind: 'outgoing' | 'incoming' | 'result'
  delegation: SessionDelegationSummary
  peerName: string
  onOpenSession: (agentId: string) => void
  onCancel?: (delegationId: string) => void
}
```

Use existing card/button/type/color/focus patterns. Make long task/result content collapsible with an accessible button. Do not add a custom popup or dropdown.

- [ ] **Step 4: Integrate durable records into `ChatPanel`**

Load transcript and relevant delegations, index by ID, subscribe to changes, accept only higher revisions, and unsubscribe on cleanup. Extend the feed union with delegation entries. Correlate outgoing cards via `ToolCallData.metadata.delegationId`; correlate started incoming/result cards through message metadata. For a target-side `queued` record with no incoming transcript item, append one virtual card ordered by `createdAt`; deduplicate it by delegation ID as soon as the persisted incoming message appears. Use transcript items for normal ordering and durable summaries for lifecycle state/content.

- [ ] **Step 5: Propagate navigation and cancellation callbacks**

Pass `onOpenSession(agentId)` from `App` through workspace/session pane layers. Offer cancel on either source or target card only while the durable status is `queued`. Call `window.api.cancelDelegation(id)` and wait for the changed event rather than applying an optimistic terminal state.

- [ ] **Step 6: Verify, document, and commit**

```powershell
npx vitest run tests/unit/delegation-card.test.tsx
npm run typecheck
git add src/renderer/src/components tests/unit/delegation-card.test.tsx docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: show session delegation cards"
```

---

### Task 7: Add Sidebar Counts, Needs-Input State, and Cross-Workspace Navigation

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/unit/sidebar-delegation.test.tsx`
- Modify: `src/renderer/AGENTS.md`
- Modify: `src/renderer/src/components/AGENTS.md`
- Modify: `docs/reference/09-ui-guide.md`

- [ ] **Step 1: Write failing sidebar and navigation tests**

Cover:

- only `queued` target records contribute to the queue badge;
- the count updates only from a newer event revision;
- `waiting_for_input` keeps the existing needs-input visual as the dominant state;
- opening a peer in the current workspace changes only the active session;
- opening a peer in another loaded workspace activates that workspace and session;
- an unavailable/deleted peer yields the existing nonfatal notification pattern.

- [ ] **Step 2: Confirm failure**

```powershell
npx vitest run tests/unit/sidebar-delegation.test.tsx
```

- [ ] **Step 3: Hoist a global revision-aware delegation projection**

In `App`, load delegations for loaded projects and maintain a map keyed by delegation ID. Upsert only higher revisions from `onDelegationChanged`. Derive rather than persist UI-only data:

```ts
const queuedByTarget = new Map<string, number>()
```

Count records whose status is exactly `queued`. Do not count `running` or `waiting_for_input` in the badge.

- [ ] **Step 4: Implement robust session navigation**

Create one callback that finds the target agent in loaded workspace data, activates its workspace when necessary, and then updates `activeSessionByPath`. Reuse it for delegation cards and sidebar interactions. It must not create a new session or focus a target automatically when delegation begins.

- [ ] **Step 5: Render the queued badge without obscuring existing status**

Add the count to the existing session row. Preserve running and needs-input semantics; the needs-input indicator remains visually primary. Add accessible text such as `2 queued delegated tasks`.

- [ ] **Step 6: Verify, document, and commit**

```powershell
npx vitest run tests/unit/sidebar-delegation.test.tsx
npm run typecheck
git add src/renderer/src/App.tsx src/renderer/src/components/sidebar tests/unit/sidebar-delegation.test.tsx docs/reference
git add -- '**/AGENTS.md'
git commit -m "feat: surface delegated work in the sidebar"
```

---

### Task 8: Prove the End-to-End Flow and Harden Races

**Files:**

- Create: `tests/e2e/session-delegation.spec.ts`
- Modify: existing mock model server/helper used by Playwright tests
- Modify: focused unit/integration tests from Tasks 1–7 as races are discovered
- Modify: `tests/unit/AGENTS.md`
- Modify: `tests/e2e/AGENTS.md`
- Modify: `docs/reference/10-build-test-release.md`

- [ ] **Step 1: Add a deterministic scripted provider scenario**

Configure the existing OpenAI-compatible mock stream to respond in this sequence:

1. Source session Alpha receives the user request and emits a `delegate_session` tool call targeting Beta.
2. Alpha receives the tool result and says `Delegation queued.`
3. Beta receives the durable incoming task and says `Implemented by Beta.`
4. Alpha receives the terminal result in a new idle turn and says `Beta finished; result reviewed.`

Match requests using stable message/tool markers rather than total request count so unrelated startup/model requests do not make the test flaky.

- [ ] **Step 2: Write the failing Playwright flow**

Seed two same-project sessions under a temporary `MEOW_USER_DATA`. Assert:

- Alpha renders an outgoing queued/running card;
- UI focus stays on Alpha while Beta starts;
- Beta’s transcript contains the incoming delegation card and task;
- Alpha later renders the completed result and wake response;
- clicking the target/source link navigates correctly;
- `delegations.json` ends in `completed` with `deliveredAt`;
- no duplicate `delegation-incoming:` or `delegation-result:` messages exist.

- [ ] **Step 3: Build and run the new E2E test to expose integration gaps**

```powershell
npm run build
npx playwright test tests/e2e/session-delegation.spec.ts
```

Expected before hardening: FAIL at the first missing integration or race assertion.

- [ ] **Step 4: Add focused race tests before each fix**

Add deterministic unit/integration coverage for:

```text
direct user queue entry versus deferred result
two simultaneous idle creates for one target
stale renderer event after a newer list response
queued work surviving restart and resuming FIFO
shutdown while a target run is active
restart with running and waiting_for_input records
target deletion between validation and pump start
source deletion before result delivery
target-side prompt answer without source-side resolution
manual target stop reported to the source as cancelled
provider failure and completion without final assistant text
session rename while a delegation is queued
UTF-8 truncation across a multi-byte character
nested delegate_session call from a delegated run
redelivery after result message persistence but before deliveredAt persistence
```

Use barriers/deferred promises, not sleeps.

- [ ] **Step 5: Make only the minimal production changes required by those tests**

Keep scheduling single-flight per target, preserve revision checks, stable ID routing across renames, and deterministic message IDs. Verify snapshots/artifacts remain attributed to the target. Do not broaden MVP scope with cross-project routing, cascading cancellation, arbitrary graph delegation, automatic retries, or file locks.

- [ ] **Step 6: Run all focused delegation tests**

```powershell
npx vitest run tests/unit/session-delegation-store.test.ts tests/unit/session-delegation-service.test.ts tests/unit/delegate-session-tool.test.ts tests/unit/meow-agent-manager-delegation.test.ts tests/unit/delegation-card.test.tsx tests/unit/sidebar-delegation.test.tsx tests/integration/delegation-ipc.test.ts
npm run build
npx playwright test tests/e2e/session-delegation.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Update testing documentation and commit**

```powershell
git add tests src docs/reference
git add -- '**/AGENTS.md'
git commit -m "test: cover session delegation end to end"
```

---

### Task 9: Audit Spec Coverage and Run the Full Verification Gate

**Files:**

- Modify: only documentation or tests found incomplete by the audit
- Review: `docs/superpowers/specs/2026-09-17-session-to-session-delegation-design.md`
- Review: all files changed by Tasks 1–8

- [ ] **Step 1: Build a spec-to-evidence checklist**

For every requirement in the approved spec, record the implementing symbol and at least one test. Explicitly verify same-project restriction, one-level guard, busy target queueing, target-owned permissions/context, target-side prompt handling, source idle wake-up, user-message priority, restart interruption, idempotent delivery, UI focus behavior, limits, cancellation scope, and deletion behavior.

- [ ] **Step 2: Scan for placeholders and accidental scope drift**

```powershell
$placeholderPattern = 'T' + 'BD|TO' + 'DO|FIX' + 'ME|implement la' + 'ter|fill in det' + 'ails|Similar to Ta' + 'sk|appropriate error hand' + 'ling'
rg -n $placeholderPattern src tests docs/superpowers/plans/2026-09-17-session-to-session-delegation.md
git diff --check
git status --short
```

Classify pre-existing repository matches separately. Remove new placeholders or turn intentional follow-ups into narrowly worded documented non-goals.

- [ ] **Step 3: Review type and lifecycle consistency**

Confirm one canonical `DelegationStatus`, one shared event DTO, centralized channels, no renderer import from main, no Node/Electron import from shared, all terminal transitions immutable, and all event upserts revision-aware. Verify every started service is suspended/disposed.

- [ ] **Step 4: Run the required repository gates**

```powershell
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected: every command exits 0. Preserve output as completion evidence; do not claim success from earlier focused runs.

- [ ] **Step 5: Inspect the final diff and documentation sync**

```powershell
git diff --stat
git diff -- docs/reference
git diff -- '**/AGENTS.md'
```

Confirm reference docs describe the actual API/storage/UI behavior and every changed module’s `AGENTS.md` was updated without unrelated rewriting.

- [ ] **Step 6: Commit any final audit corrections**

If the audit required changes:

```powershell
git add src tests docs
git add -- '**/AGENTS.md'
git commit -m "docs: finalize session delegation references"
```

If no changes remain, do not create an empty commit.

## Completion Criteria

- Alpha can delegate to Beta by stable session ID while both remain visible as independent sessions.
- Busy Beta queues delegated work and receives it only after ordinary work drains.
- Beta runs with its own runtime configuration and handles its own prompts.
- Alpha receives one durable terminal result and wakes only from idle.
- Restart never retries uncertain side effects and reports interrupted work.
- Chat cards, sidebar counts, and navigation reflect the latest revision without focus stealing.
- Typecheck, full Vitest, production build, and Playwright E2E all pass.
