# Session-to-Session Delegation — Design Spec

Date: 2026-09-17 · Status: awaiting written-spec review

## 1. Goal

Allow one user-created session to delegate a task to another user-created session in the same
project. The target session receives a real message in its existing transcript, runs with its own
history, model, mode, permissions, hooks, and tools, then returns its final result to the source
session. The source session is automatically woken so it can continue from that result.

The motivating flow is:

1. The user brainstorms and approves work in session A.
2. Session A delegates the approved task to session B.
3. Session B implements the task using its existing identity and context.
4. The result is delivered to session A, which reviews or summarizes it for the user.

This feature is distinct from the existing `task` subagent tool. A subagent is an ephemeral,
isolated worker whose permissions are narrowed from its parent. A delegated session is a durable,
user-visible worker with its own transcript and permission context.

## 2. Product decisions

| Topic | Decision |
|---|---|
| Target | An existing session created by the user |
| Transcript | The delegated task is a real message in the target session |
| Project boundary | Source and target must belong to the same project |
| Busy target | Queue the task; never steer it into the active turn |
| Queue policy | Existing direct user messages at the target run before delegated work |
| Completion | Deliver the result to the source and wake it automatically |
| Permission prompts | Answered only in the target session |
| Delegation depth | One level only; a delegated turn cannot delegate again |
| Execution model | Asynchronous; the source tool call returns after durable enqueue |
| Persistence | Delegation lifecycle survives application restart |
| Concurrent files | No project or file locks in the MVP |

## 3. Considered approaches

### 3.1 Call `MeowAgentManager.send()` directly

The smallest implementation would make a `delegate_session` tool call `send(targetAgentId, task)`.
This reuses the existing runner and message queue, but it provides no durable relationship between
the source turn and target turn. A normal `done` event only identifies an agent, so completion could
be attributed to the wrong queued message. Restart recovery, idempotent result delivery, deletion,
and live status would also require unrelated callbacks in `MeowAgentManager`.

This approach is suitable only for a throwaway feasibility probe and is rejected for the product.

### 3.2 Durable delegation broker — selected

A dedicated service owns delegation records and their lifecycle. The tool creates a record; the
service schedules a correlated turn at the target; the manager runs that turn; and the service
delivers its terminal result to the source exactly once.

This adds a store and state machine, but gives the feature one authoritative source of truth,
restart recovery, explicit failure behavior, and a clean UI query/event surface.

### 3.3 Reuse the `task` subagent runner with session B

This would reuse existing subagent streaming and foreground tool semantics. It is rejected because
the models conflict: subagents are isolated and inherit narrowed permissions, while B must use its
own durable transcript and permissions. It would also keep A's turn open while B waits in a queue or
for user input.

## 4. Architecture

```text
Session A
   │ delegate_session(target=B, task)
   ▼
SessionDelegationService ── persist record ──► SessionDelegationStore
   │
   │ dispatch when B is idle and its direct-message queue is empty
   ▼
MeowAgentManager.runDelegatedTurn(B, delegation context)
   │
   ▼
Session B transcript and normal agent loop
   │ terminal AgentTurnResult
   ▼
SessionDelegationService ── persist result ──► source transcript
   │
   └── wake A now, or queue the wake if A is busy
```

### 4.1 `SessionDelegationStore`

The store is backed by `userData/delegations.json` through the existing `JsonStore` abstraction.
It owns persistence only:

- create and query records;
- validate and apply state transitions;
- return the oldest queued record for a target;
- update idempotency fields and monotonically increasing revisions;
- normalize stored data on load;
- recover interrupted state at startup;
- remove expired terminal records.

It does not run agents, mutate transcripts, or emit renderer events.

### 4.2 `SessionDelegationService`

The service owns orchestration:

- validate the source, target, project boundary, nesting rule, and limits;
- create the durable record before acknowledging the tool call;
- observe target availability without accessing manager-private maps;
- dispatch exactly one delegated turn at a target;
- correlate prompts and terminal results with the correct delegation;
- deliver a result or failure to the correct source transcript;
- wake the source exactly once;
- publish status changes to the renderer;
- handle session deletion, stop, application shutdown, and startup recovery.

The service does not construct a second runner. `MeowAgentManager` remains the only component that
orchestrates native agent runs.

### 4.3 `delegate_session` tool

The tool is a thin adapter in `src/main/agent/tools/delegate-session.ts`:

```ts
delegate_session({
  target_session_id: string,
  task: string
})
```

It reads the source identity from `ToolContext`, calls the delegation service, and returns either a
durable acknowledgement with the delegation ID or an actionable validation error. It does not own
queues, wait for the target, or call a runner directly.

The tool must remain visible in a delegated turn so that transcript replay remains stable, but its
runtime call is denied when the current run origin is a delegation. The one-level rule therefore
does not depend on prompt compliance.

### 4.4 Manager API and run correlation

The manager exposes typed internal operations instead of the service reading its private maps:

```ts
getPeerSessions(agentId: string): PeerSession[]
runDelegatedTurn(input: DelegatedTurnInput): Promise<AgentTurnResult>
wakeWithDelegationResult(input: DelegationResultInput): Promise<void>
```

Every run has internal correlation metadata:

```ts
interface AgentRunContext {
  runId: string
  agentId: string
  sessionId: string
  origin:
    | { type: 'user' }
    | { type: 'delegation'; delegationId: string }
}

interface AgentTurnResult {
  runId: string
  reason: string
  finalText?: string
  error?: string
}
```

The delegation service accepts a terminal result only when the run's delegation ID matches the
record it dispatched. It never infers completion from the latest `done` event for an agent.

## 5. Data model

```ts
type DelegationStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

interface SessionDelegation {
  id: string
  projectPath: string

  sourceAgentId: string
  sourceSessionId: string
  targetAgentId: string
  targetSessionId: string

  task: string
  status: DelegationStatus
  revision: number

  createdAt: number
  startedAt?: number
  finishedAt?: number

  result?: string
  error?: string
  deliveredAt?: number
  wakeAt?: number
}
```

Both agent IDs and concrete transcript session IDs are captured. Agent IDs identify the visible
source and target workers. Session IDs guarantee that the task and result stay attached to the
conversation that created them even if an internal active session changes later.

### 5.1 State transitions

```text
queued ───────────────► running ───────────────► completed
  │                       │  ▲                       ▲
  │                       │  └── waiting_for_input ─┘
  │                       │
  ├───────────────────────┼────────────────────► failed
  ├───────────────────────┼────────────────────► cancelled
  └───────────────────────┴────────────────────► interrupted
```

Terminal states never return to an active state. Retry creates a new delegation ID so file-changing
side effects are never silently replayed.

## 6. Dispatch and queue semantics

Creation validates all of the following before a record is written:

- source and target exist;
- source and target differ;
- both belong to the same `projectPath`;
- the source run is not itself delegated;
- task text is non-empty and within the size limit;
- the target has fewer than five non-terminal delegations.

The store is written before the tool reports success. A successful acknowledgement therefore means
the task can be recovered after a crash.

For each target, the service dispatches the oldest queued delegation only when:

1. the target has no active turn;
2. the target's existing direct-message queue is empty; and
3. no other delegated turn is running at that target.

Direct user messages have priority over delegated work. This avoids changing the existing steering
and queue implementation in the MVP and prevents automation from overtaking work the user explicitly
sent to B. The UI must show a delegation as `queued`; it must not imply progress before dispatch.

## 7. Target turn behavior

The target receives a real user-role message with structured delegation metadata. The LLM-visible
content is equivalent to:

```text
Delegated by session "Architecture brainstorm"

Task:
Implement the approved design.

Complete this task in this session and return a concise final result to the requesting session.
You may not delegate this task to another session.
```

`ChatMessage` gains optional JSON metadata for rendering and linkage:

```ts
delegation?: {
  id: string
  direction: 'incoming' | 'result'
  peerAgentId: string
  peerName: string
}
```

Routing never parses the display text. The record and run metadata are authoritative.

The target uses its own:

- prior transcript;
- model, account, and reasoning variant;
- build or plan mode;
- configured and saved permissions;
- hooks, MCP servers, skills, tools, and project instructions.

No permission or saved allow is inherited from the source.

## 8. Permission and input handling

When the target emits a permission or question prompt during a delegated turn:

1. the record moves from `running` to `waiting_for_input`;
2. the prompt remains owned by the target session;
3. the source receives a status event but cannot answer on the target's behalf;
4. the user opens the target session and uses its existing prompt UI;
5. after a response, the record returns to `running` while the target loop continues.

A denied permission is a normal tool result. It does not automatically fail the delegation; the
target may recover and produce a useful final answer.

## 9. Completion and source wake-up

When the correlated target turn ends:

1. The service captures the final assistant text produced by that turn.
2. It persists `completed` and the result, or `failed` and an infrastructure error.
3. It appends a structured result message to `sourceSessionId` if it is not already present.
4. It persists `deliveredAt`.
5. It wakes the source immediately if idle, or enqueues the wake if the source is busy.
6. It persists `wakeAt` so the wake is not repeated after restart.

The result message uses a deterministic ID derived from the delegation ID, such as
`delegation-result:<id>`. Delivery checks both the record and the source transcript, making the
operation idempotent across a crash between append and flag persistence.

The source receives a system-originated user-role input that identifies the target and contains the
result. It is not rendered as if the human typed it. The source can review changes, synthesize an
answer, or report failure to the user.

A target answer that reports a task-level problem, such as failing tests, still counts as
`completed`: the target ran and returned a result. `failed` is reserved for failures that prevent a
usable result, including provider errors, deleted targets, missing transcripts, persistence errors,
or a turn that produced no final answer.

## 10. Restart and lifecycle recovery

On startup:

- `queued` records remain queued and dispatch when their targets become available;
- `completed` or other terminal records without delivery are delivered idempotently;
- `running` and `waiting_for_input` records become `interrupted` and are reported to their sources;
- interrupted work is never automatically retried because it may already have changed files.

Other lifecycle cases:

| Situation | Behavior |
|---|---|
| Target renamed | Continue by ID; show the current name |
| Target deleted while queued | Mark failed and report to source |
| Target deleted while running | Stop the turn, mark failed, report to source |
| Source deleted while target runs | Target may finish; retain result without wake-up |
| Project removed | Cancel non-terminal records; retain terminal audit data until cleanup |
| User stops target | Mark cancelled; preserve partial file changes |
| Result arrives while source runs | Queue the result wake; never steer the active turn |
| Source or target prompt is open | Preserve prompt ownership; do not replace its UI state |

Queued tasks may be cancelled from either session. A source cannot remotely abort a running target
in the MVP; it must open the target and use its normal Stop action. This avoids silently terminating
a turn the user may be observing or authorizing.

## 11. Session discovery

Before each normal source turn, the agent receives a live peer-session roster containing same-project
session IDs, names, run states, and modes. It is generated as ephemeral system context and is not
persisted in the transcript. Runtime validation remains authoritative because the roster can become
stale between model generation and tool execution.

The tool accepts only a session ID for routing. Names are display data and may be duplicated or
changed.

If the project has no peer session, the roster is empty and an attempted tool call returns an error
that tells the user to create another session.

## 12. Renderer experience

### 12.1 Source session

The `delegate_session` tool call renders as a delegation card with:

- target name;
- short task text;
- current status;
- created, started, and finished times as applicable;
- an `Open session` action;
- a concise error for failed, interrupted, or cancelled work.

The card updates through broker events. It does not mirror the target's reasoning or tool stream.
The target remains the authoritative place to inspect detailed work.

### 12.2 Target session

The incoming message is rendered as a task card naming the source session and delegation ID. The
target's subsequent assistant messages and tool calls render normally. Starting a delegated task
does not steal focus or switch the active pane.

The target's sidebar row or pane header shows a queued-delegation count and reuses the existing
needs-input indication when a delegated turn is blocked on a prompt.

### 12.3 Result

The source result card shows the target's final result and an `Open full conversation` action. The
link uses the target agent ID, so session rename does not break historical cards.

### 12.4 IPC

The shared contract adds centralized `Channels` entries and corresponding `AgentApi` methods:

```ts
listDelegations(agentId: string): Promise<SessionDelegationSummary[]>
cancelDelegation(delegationId: string): Promise<void>
onDelegationChanged(cb: (event: DelegationChangedEvent) => void): () => void
```

The renderer loads summaries when a pane mounts and upserts live events by delegation ID and
revision. Transcript data remains authoritative for messages and tool calls; the delegation store is
authoritative for lifecycle state. Reload joins them by delegation ID.

Any new dropdown or action menu uses the renderer's common `BaseDropdown` or `BaseSelect`
components rather than custom overlay positioning.

## 13. Working-tree concurrency

All sessions in a project share one working tree. The MVP does not add project locks or file locks:
project locks would defeat parallel sessions, and file ownership cannot be known before an agent
acts.

Instead:

- the source receives a reminder not to edit the delegated scope before the result returns;
- the card warns when another same-project session is already running at dispatch time;
- target snapshots and artifacts remain attributed to the target agent;
- the result includes touched files when artifact tracking can identify them;
- the broker never automatically reverts or merges concurrent changes;
- undo remains a target-session action and warns when later concurrent changes may be overwritten.

File locking, worktree-per-session isolation, and automatic conflict resolution are separate future
designs.

## 14. Limits and retention

Initial internal limits:

- five non-terminal delegations per target;
- one running delegated turn per target;
- 32 KiB maximum task text;
- 64 KiB maximum stored result;
- context-safe result injection using the existing truncation conventions, with an explicit link to
  the full target conversation when truncated;
- 30-day retention for terminal records, unless both participating sessions are deleted earlier.

These are constants in the MVP rather than user settings. A delegated turn has no broker-imposed
wall-clock timeout; the user stops it in the target session when necessary.

## 15. Relationship to subagents

| `task` subagent | Session delegation |
|---|---|
| Ephemeral worker | User-created persistent session |
| Isolated context | Existing target transcript |
| Permissions narrowed from parent | Target's own permissions |
| May run several calls in parallel | One delegated turn per target |
| Foreground or background tool | Always asynchronous to the source |
| Result belongs to the source tool turn | Durable result message and source wake-up |
| Not present in the sidebar | Fully visible session and pane |

Tool descriptions and the system prompt must explain this distinction. The model should use
`task` for temporary isolated work and `delegate_session` when the user names or intends a specific
persistent session.

## 16. Testing

### 16.1 Unit tests

- valid and invalid state transitions;
- same-project, self-target, missing-target, and nesting validation;
- FIFO ordering per target;
- direct-message priority;
- per-target queue limit;
- deterministic and idempotent result delivery;
- recovery for every non-terminal and partially delivered state;
- source and target deletion behavior;
- permission state transition from running to waiting and back;
- rename-safe ID routing;
- result truncation preserving a target link;
- duplicate and out-of-order event handling by revision.

### 16.2 Integration tests

- idle A delegates to idle B and receives a result wake;
- a running B finishes its current and direct queued work before the delegation;
- a target permission request can be answered only at B;
- a result arriving while A runs is queued rather than steered;
- stopping B reports cancellation to A;
- queued work survives restart, while running work becomes interrupted;
- two delegations to one target execute serially;
- a delegated turn cannot create another delegation;
- snapshots and artifacts are attributed to B rather than A;
- provider failure and no-final-answer failure return structured errors.

### 16.3 Contract and UI tests

- main, preload, shared contract, and IPC tests agree;
- cards restore correctly after pane reload and application restart;
- status events upsert by revision without duplicates;
- `Open session` navigates to the correct project and session;
- target needs-input indication appears without switching focus;
- incoming task, outgoing task, and result messages are visually distinct;
- cancellation is offered only for queued work at the source;
- the end-to-end build covers delegate, execute, return, and wake.

Completion gates remain `npm run typecheck` and `npm test`. Because this feature changes the main
user flow and renderer navigation, implementation also requires `npm run build && npm run e2e`.

## 17. Expected implementation surface

New files are expected for the store, service, and tool. Existing changes will likely include:

- `src/main/meow-agent-manager.ts` for typed run correlation and delegated-run APIs;
- `src/main/index.ts` for composition, IPC handlers, and event forwarding;
- `src/main/agent/loop.ts` and tool context types for run-origin enforcement;
- `src/main/agent/session.ts` for idempotent message lookup or append support;
- `src/shared/types.ts` and `src/shared/ipc.ts` for serializable contracts;
- `src/preload/index.ts` for the bridge;
- renderer app, chat cards, sidebar indicators, and styles;
- unit, integration, IPC-contract, and end-to-end tests.

The exact file list belongs in the implementation plan after repository-level dependency analysis.

## 18. Documentation synchronization

Implementation must update only affected entries in the relevant module `AGENTS.md` files. It must
also update the matching reference pages, especially product overview, architecture, agent runtime,
tool catalog, IPC contract, data and storage, and UI guide. The documentation changes ship in the
same commits as the behavior they describe.

## 19. Out of scope

- cross-project delegation;
- nested delegation or workflow graphs;
- automatic target-session creation;
- copying the source transcript into the target;
- shared permissions or source-side approval of target prompts;
- streaming target reasoning or tool calls into the source;
- source-side force-stop of a running target;
- project or file locks;
- automatic retry after side effects;
- priority scheduling, deadlines, recurring tasks, or remote-control support;
- a general-purpose workflow engine.

## 20. Benefits and trade-offs

The design matches the user's mental model that a session is a durable worker. It preserves each
session's identity and permissions, supports background execution and restart recovery, provides an
audit trail, and leaves a clean path for future retry or deeper orchestration without merging the
feature with ephemeral subagents.

The cost is a medium-to-large architectural change. Turn correlation must be introduced where events
currently identify only an agent; more asynchronous states and recovery paths require testing; two
sessions can still conflict in the shared working tree; source and target consume separate model
context and tokens; and a target's prior history may influence a delegated task in ways an isolated
subagent would not.

The durable broker is nevertheless the recommended design. The runtime already provides multiple
independent sessions, persistent transcripts, queues, permissions, prompts, notifications, and
background execution. The new work is a bounded orchestration layer around those capabilities:

```text
tool request
→ durable delegation record
→ correlated target turn
→ terminal result
→ idempotent source delivery and wake-up
```
