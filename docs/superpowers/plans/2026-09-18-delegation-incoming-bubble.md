# Delegation Incoming Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a delegated task in the target session as a labelled user bubble the moment the delegated turn starts, instead of leaving it invisible until the pane remounts.

**Architecture:** `MeowAgentManager.runDelegatedTurn` already persists the incoming message deterministically but suppresses the `user-message` event via `messageAlreadyPersisted`; the fix re-emits that event only when the store actually wrote the message. The renderer then carries `ChatMessage.delegation` through `FeedItem`, `toFeedItem`, and the live `user-message` handler, and `FeedMessage` renders a source label for `direction: 'incoming'` rows only.

**Tech Stack:** Electron 41, React 19, TypeScript strict, Vitest (node + jsdom), plain CSS in `src/renderer/src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-09-18-delegation-incoming-bubble-design.md`

## Global Constraints

- UI labels, source code, and docs are English.
- No new IPC channel: reuse the existing `user-message` `ChatEvent` and the already-persisted `ChatMessage.delegation` field.
- Only `direction: 'incoming'` is labelled; `direction: 'result'` and ordinary user messages render exactly as today.
- Never call `deps.onUserMessage` for a delegated message (it would auto-rename the target session).
- Only emit when `appendMessageIfMissing` returns `true`, so restart recovery cannot duplicate a bubble.
- Use existing CSS variables from `src/renderer/src/styles.css`; never hardcode colors.
- Run focused tests after every red/green step; run `npm run typecheck` and `npm test` before the final commit.
- Update the nearest `AGENTS.md` and the matching `docs/reference/` page in the same task as the behavior change.

## Planned File Structure

```text
src/main/meow-agent-manager.ts                     # emit the incoming delegated message
src/renderer/src/components/chat/ChatPanel.tsx     # carry delegation metadata + render the label
src/renderer/src/styles.css                        # label, badge, delegated bubble accent
tests/unit/meow-agent-manager-delegation.test.ts   # emit-once / no-duplicate-on-redelivery
tests/unit/chat-panel-events.test.ts               # labelled bubble, reload restore, negative cases
src/main/AGENTS.md
src/renderer/src/components/chat/AGENTS.md
docs/reference/09-ui-guide.md
```

---

### Task 1: Emit the delegated incoming message to the renderer

**Files:**
- Modify: `src/main/meow-agent-manager.ts` (method `runDelegatedTurn`, ~lines 274-309)
- Test: `tests/unit/meow-agent-manager-delegation.test.ts`
- Modify: `src/main/AGENTS.md`

**Interfaces:**
- Consumes: `MeowAgentManagerDeps.store.appendMessageIfMissing(sessionId: string, message: ChatMessage): Promise<boolean>` (returns whether the message was newly written), `MeowAgentManager.emit(e: ChatEvent): void` (private), `ChatDelegationMeta` from `@shared/types`.
- Produces: a `{ type: 'user-message'; agentId: string; message: ChatMessage }` event on the target agent whose `message.id` is `delegation-incoming:<delegationId>` and whose `message.delegation` is `{ id, direction: 'incoming', peerAgentId, peerName }`. Task 2 consumes exactly this shape.

**Current code** (`runDelegatedTurn`, to be replaced verbatim):

```ts
    this.deps.store.ensure(input.targetSessionId, target.id, target.cwd)
    await this.deps.store.appendMessageIfMissing(input.targetSessionId, {
      id: `delegation-incoming:${delegationId}`,
      role: 'user',
      text: input.task,
      delegation: {
        id: delegationId,
        direction: 'incoming',
        peerAgentId: input.sourceAgentId,
        peerName: input.sourceName
      },
      createdAt: Date.now()
    })
```

- [ ] **Step 1: Write the failing tests**

Append these two cases inside the existing `describe('MeowAgentManager delegation runtime', ...)` block in `tests/unit/meow-agent-manager-delegation.test.ts` (the file already imports `MeowAgentManager`, `DelegatedTurnInput`, and defines `makeManager()` returning `{ manager, store, snapshots, events }`, where `events: ChatEvent[]` is captured through `manager.setOnEvent`):

```ts
  it('emits the delegated incoming message to the renderer exactly once', async () => {
    const { manager, events } = await makeManager()
    const input: DelegatedTurnInput = {
      delegationId: 'd-emit',
      sourceAgentId: 'src-agent',
      sourceName: 'Staff Agent',
      targetAgentId: 'a1',
      targetSessionId: 'del-session-emit',
      task: 'do the thing'
    }
    await manager.runDelegatedTurn(input)

    const emitted = events.filter(e => e.type === 'user-message')
    expect(emitted).toHaveLength(1)
    const first = emitted[0]
    expect(first.type).toBe('user-message')
    if (first.type !== 'user-message') throw new Error('unreachable')
    expect(first.agentId).toBe('a1')
    expect(first.message.id).toBe('delegation-incoming:d-emit')
    expect(first.message.role).toBe('user')
    expect(first.message.text).toBe('do the thing')
    expect(first.message.delegation).toEqual({
      id: 'd-emit',
      direction: 'incoming',
      peerAgentId: 'src-agent',
      peerName: 'Staff Agent'
    })
  })

  it('does not re-emit a delegated incoming message on redelivery', async () => {
    const { manager, store, events } = await makeManager()
    const input: DelegatedTurnInput = {
      delegationId: 'd-redeliver',
      sourceAgentId: 'src-agent',
      sourceName: 'Staff Agent',
      targetAgentId: 'a1',
      targetSessionId: 'del-session-redeliver',
      task: 'do the thing again'
    }
    await manager.runDelegatedTurn(input)
    await manager.runDelegatedTurn(input)

    const emitted = events.filter(
      e => e.type === 'user-message' && e.message.id === 'delegation-incoming:d-redeliver'
    )
    expect(emitted).toHaveLength(1)
    const messages = store.get('del-session-redeliver')!.items
      .filter((i): i is { kind: 'message'; message: { id: string } } => i.kind === 'message')
      .map(i => i.message)
    expect(messages.filter(m => m.id === 'delegation-incoming:d-redeliver')).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/meow-agent-manager-delegation.test.ts -t "delegated incoming message"`

Expected: FAIL — the first test reports `expected [] to have a length of 1` (no `user-message` is emitted today); the redelivery test fails for the same reason.

- [ ] **Step 3: Write the minimal implementation**

In `src/main/meow-agent-manager.ts`, inside `runDelegatedTurn`, replace the block shown above with:

```ts
    this.deps.store.ensure(input.targetSessionId, target.id, target.cwd)
    const incoming: ChatMessage = {
      id: `delegation-incoming:${delegationId}`,
      role: 'user',
      text: input.task,
      delegation: {
        id: delegationId,
        direction: 'incoming',
        peerAgentId: input.sourceAgentId,
        peerName: input.sourceName
      },
      createdAt: Date.now()
    }
    // The target pane must show the delegated task while the turn runs, but a
    // recovery redelivery must not duplicate it: emit only on a real write.
    // onUserMessage is deliberately not called, so a delegated task never
    // auto-renames the target session.
    const wrote = await this.deps.store.appendMessageIfMissing(input.targetSessionId, incoming)
    if (wrote) this.emit({ type: 'user-message', agentId: input.targetAgentId, message: incoming })
```

Leave the following `await this.runTurn(input.targetAgentId, input.task, { ... messageAlreadyPersisted: true ... })` call untouched — the turn still must not append or re-emit the message.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/meow-agent-manager-delegation.test.ts`

Expected: PASS — all cases in the file, including the pre-existing `appends a deterministic incoming message...` case.

- [ ] **Step 5: Update `src/main/AGENTS.md`**

In the `meow-agent-manager.ts` bullet, extend the delegation sentence to record the new emit. Add this to the existing delegation description (keep the current wording, append one sentence):

```
A delegated run persists its incoming message deterministically and re-emits it as a
`user-message` event (only when the store actually wrote it, so recovery cannot duplicate the
bubble); `onUserMessage` is not called, so delegation never auto-renames the target session.
```

- [ ] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts tests/unit/meow-agent-manager-delegation.test.ts src/main/AGENTS.md
git commit -m "fix(agent): show the delegated task in the target session immediately"
```

---

### Task 2: Render the labelled incoming bubble in the target feed

**Files:**
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx` (`FeedItem` type ~line 20, `toFeedItem` ~line 31, `FeedMessage` ~line 83, `user-message` handler ~line 533, feed render ~line 953)
- Modify: `src/renderer/src/styles.css` (after the `.chat-msg.user .chat-text` rule, ~line 1055)
- Test: `tests/unit/chat-panel-events.test.ts`
- Modify: `src/renderer/src/components/chat/AGENTS.md`
- Modify: `docs/reference/09-ui-guide.md`

**Interfaces:**
- Consumes: the `{ type: 'user-message'; agentId: string; message: ChatMessage }` event from Task 1, and `ChatDelegationMeta` from `@shared/types` (`{ id: string; direction: 'incoming' | 'result'; peerAgentId: string; peerName: string }`).
- Produces: DOM elements with classes `chat-msg delegation` (root, incoming rows only), `chat-delegation-label`, `chat-delegation-badge`. Text content: `delegation` badge + `From session: <peerName>`.

- [ ] **Step 1: Write the failing tests**

Append three cases to the existing `describe('ChatPanel live event reconciliation', ...)` block in `tests/unit/chat-panel-events.test.ts`. The file already imports `act`, `createElement`, `createRoot`, `vi`, `ChatEvent`, and `ChatPanel`, declares `root`, sets `globalThis.IS_REACT_ACT_ENVIRONMENT`/`ResizeObserver`, and has an `afterEach` that unmounts and calls `vi.restoreAllMocks()`.

```ts
  it('renders an incoming delegated task as a labelled bubble', async () => {
    let resolveTranscript!: (page: TranscriptPage) => void
    const transcript = new Promise<TranscriptPage>(resolve => { resolveTranscript = resolve })
    let onEvent: ((event: ChatEvent) => void) | undefined
    const api = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'listChatTranscript') return () => transcript
        if (key === 'onChatEvent') return (listener: (event: ChatEvent) => void) => { onEvent = listener; return () => {} }
        if (key === 'getAgentVariants' || key === 'getChatTodos' || key === 'listCommands' || key === 'listModels') {
          return async () => []
        }
        if (key === 'getContextInfo') return async () => ({ limit: 128000, compactThreshold: 100000, sessionCost: 0 })
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: {
        id: 'delegation-incoming:d1',
        role: 'user',
        text: 'do the thing',
        createdAt: Date.now(),
        delegation: { id: 'd1', direction: 'incoming', peerAgentId: 'src-agent', peerName: 'Staff Agent' }
      }
    }))
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    const label = container.querySelector('.chat-delegation-label')
    expect(label).not.toBeNull()
    expect(label!.textContent).toContain('From session: Staff Agent')
    expect(container.querySelector('.chat-delegation-badge')!.textContent).toBe('delegation')
    expect(container.querySelector('.chat-text')!.textContent).toContain('do the thing')
  })

  it('restores the delegated label from the transcript after a reload', async () => {
    let resolveTranscript!: (page: TranscriptPage) => void
    const transcript = new Promise<TranscriptPage>(resolve => { resolveTranscript = resolve })
    const api = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'listChatTranscript') return () => transcript
        if (key === 'onChatEvent') return () => () => {}
        if (key === 'getAgentVariants' || key === 'getChatTodos' || key === 'listCommands' || key === 'listModels') {
          return async () => []
        }
        if (key === 'getContextInfo') return async () => ({ limit: 128000, compactThreshold: 100000, sessionCost: 0 })
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' }))
      resolveTranscript({
        items: [{
          kind: 'message',
          message: {
            id: 'delegation-incoming:d2',
            role: 'user',
            text: 'do the thing',
            createdAt: 1,
            delegation: { id: 'd2', direction: 'incoming', peerAgentId: 'src-agent', peerName: 'Staff Agent' }
          }
        }],
        hasMore: false
      })
      await transcript
    })

    expect(container.querySelector('.chat-delegation-label')!.textContent).toContain('From session: Staff Agent')
    expect(container.querySelector('.chat-msg.delegation')).not.toBeNull()
  })

  it('does not label ordinary user messages or delegation results', async () => {
    let resolveTranscript!: (page: TranscriptPage) => void
    const transcript = new Promise<TranscriptPage>(resolve => { resolveTranscript = resolve })
    let onEvent: ((event: ChatEvent) => void) | undefined
    const api = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'listChatTranscript') return () => transcript
        if (key === 'onChatEvent') return (listener: (event: ChatEvent) => void) => { onEvent = listener; return () => {} }
        if (key === 'getAgentVariants' || key === 'getChatTodos' || key === 'listCommands' || key === 'listModels') {
          return async () => []
        }
        if (key === 'getContextInfo') return async () => ({ limit: 128000, compactThreshold: 100000, sessionCost: 0 })
        if (key === 'isChatRunning') return async () => false
        if (key === 'getPendingPrompt') return async () => null
        return async () => undefined
      }
    }) as Window['api']
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => { root?.render(createElement(ChatPanel, { agentId: 'agent-1', cwd: 'C:\\repo' })) })
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: { id: 'u-plain', role: 'user', text: 'typed by hand', createdAt: Date.now() }
    }))
    act(() => onEvent?.({
      type: 'user-message', agentId: 'agent-1',
      message: {
        id: 'delegation-result:d3',
        role: 'user',
        text: '### Delegation result — Staff Agent',
        createdAt: Date.now(),
        delegation: { id: 'd3', direction: 'result', peerAgentId: 'a1', peerName: 'Staff Agent' }
      }
    }))
    await act(async () => { resolveTranscript({ items: [], hasMore: false }); await transcript })

    expect(container.querySelectorAll('.chat-delegation-label')).toHaveLength(0)
    expect(container.querySelectorAll('.chat-msg.delegation')).toHaveLength(0)
    expect(container.textContent).toContain('typed by hand')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/chat-panel-events.test.ts`

Expected: FAIL — the first two cases fail on `expect(received).not.toBeNull()` / a `null` `textContent` dereference because nothing renders `chat-delegation-label`. The third case passes already (it asserts absence).

- [ ] **Step 3: Carry the metadata through the feed**

In `src/renderer/src/components/chat/ChatPanel.tsx`:

(a) Extend the existing single `@shared/types` type import at the top of the file (line 3) by adding `ChatDelegationMeta` to its alphabetized list:

```ts
import type { AgentMode, ChatDelegationMeta, ChatEvent, ChatMessage, ChatTranscriptItem, Command, ImageAttachment, QuestionOption, QueuedMessage, TodoItem, TodoStatus, ToolCallData } from '@shared/types'
```

(b) Extend the `FeedItem` message variant (~line 20):

```ts
type FeedItem =
  | { kind: 'message'; id: string; role: ChatMessage['role']; text: string; reasoning?: string; images?: ImageAttachment[]; delegation?: ChatDelegationMeta }
```

(c) Copy the field in `toFeedItem` (~line 31):

```ts
        reasoning: it.message.reasoning, images: it.message.images, delegation: it.message.delegation
```

(d) Copy the field in the live `user-message` handler row (~line 551):

```ts
        const row = { kind: 'message' as const, id: e.message.id, role: 'user' as const, text: e.message.displayText ?? e.message.text, images: e.message.images, delegation: e.message.delegation }
```

- [ ] **Step 4: Render the label in `FeedMessage`**

In the same file:

(a) Add `delegation` to `FeedMessage`'s destructured props and its prop type (the type currently reads `role, text, reasoning, images, commands, messageId, onOpenImage, onOpenFile`):

```ts
const FeedMessage = memo(function FeedMessage({ role, text, reasoning, images, commands, messageId, delegation, onOpenImage, onOpenFile }: {
  role: ChatMessage['role']
  text: string
  reasoning?: string
  images?: ImageAttachment[]
  commands: Command[]
  messageId: string
  delegation?: ChatDelegationMeta
  onOpenImage?: (dataUrl: string) => void
  onOpenFile?: (path: string) => void
}) {
```

(b) Mark the root so the CSS can accent a delegated bubble:

```ts
    <div className={`chat-msg ${role}${delegation?.direction === 'incoming' ? ' delegation' : ''}`} data-chat-message-id={messageId}>
```

(c) Render the label as the first child of the `role !== 'assistant'` branch (i.e. immediately before the existing `{images && images.length > 0 && (` block):

```tsx
          {delegation?.direction === 'incoming' && (
            <div className="chat-delegation-label">
              <span className="chat-delegation-badge">delegation</span>
              <span>From session: {delegation.peerName}</span>
            </div>
          )}
```

(d) Pass the prop where the feed renders the row (~line 957):

```tsx
                images={item.images}
                delegation={item.delegation}
```

Leave the assistant branch untouched.

- [ ] **Step 5: Add the styles**

In `src/renderer/src/styles.css`, insert immediately after the `.chat-msg.user .chat-text { ... }` rule:

```css
/* A delegated task rendered in the target session: a normal user bubble with a
   source label, so it is distinguishable from input the human typed. */
.chat-delegation-label {
  display: flex; align-items: center; gap: 0.416667rem;
  max-width: 92%;
  font-family: var(--font-ui); font-size: var(--fs-xs);
  color: var(--text-dim); user-select: none;
}
.chat-delegation-badge {
  font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: var(--fw-semibold);
  text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.1rem 0.4rem; border-radius: var(--radius-sm);
  background: var(--accent-dim); color: var(--accent-strong);
}
.chat-msg.user.delegation .chat-text {
  background: var(--accent-dim);
  border: 0.083333rem solid var(--accent-border);
  color: var(--chat-text);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/chat-panel-events.test.ts`

Expected: PASS — all three new cases plus the pre-existing tool-result race case.

- [ ] **Step 7: Run the full gate**

Run: `npm run typecheck && npm test`

Expected: typecheck clean; the full Vitest suite green (including the delegation unit suites and `tests/unit/ipc-contract.test.ts`).

- [ ] **Step 8: Update docs**

- `src/renderer/src/components/chat/AGENTS.md`, `ChatPanel.tsx` row: append to the feed sentence —
  "An incoming delegated message renders as a user bubble with a `delegation` badge and a `From session: <name>` label (`.chat-delegation-label`); the metadata travels on `FeedItem`/`toFeedItem` so a reload reproduces it, and `direction: 'result'` rows stay unlabelled."
- `docs/reference/09-ui-guide.md`, `### Chat (components/chat/)` section, `ChatPanel.tsx` table row: append the same behavior in the page's existing prose style.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx src/renderer/src/styles.css tests/unit/chat-panel-events.test.ts src/renderer/src/components/chat/AGENTS.md docs/reference/09-ui-guide.md
git commit -m "feat(ui): label delegated tasks in the target session feed"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 Problem | Task 1 (emit) + Task 2 (render) |
| §2 Goal (bubble at turn start, labelled with source) | Task 1 Step 3 (emit before `runTurn`), Task 2 Steps 4-5 |
| §2 Non-goals (source side, status, cancel, queued bubble, sidebar, IPC) | No task by design; nothing in the plan touches them |
| §3 Decisions (timing, label content, transport, duplicate safety, no auto-rename) | Task 1 Step 3 + Task 2 Steps 4-5 |
| §4 Data flow steps 3-4 (`appendMessageIfMissing` gate, emit) | Task 1 Step 3, asserted in Task 1 Step 1 (redelivery case) |
| §4 Step 6 (reload renders the same bubble) | Task 2 Step 1 (`restores the delegated label...`), Step 3(c) |
| §5 Renderer (FeedItem, toFeedItem, handler, `FeedMessage`, English labels, CSS vars) | Task 2 Steps 3-5 |
| §6 Testing | Task 1 Step 1, Task 2 Step 1, Task 2 Step 7 |
| §7 Docs | Task 1 Step 5, Task 2 Step 8 |
| §8 Success criteria | Covered by Task 1/2 tests; source-side parity by the negative case in Task 2 Step 1 |

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows the full replacement text; every test step shows the full test body.

**3. Type consistency:** `ChatDelegationMeta` and `ChatMessage` come from `@shared/types` in both tasks. `appendMessageIfMissing` keeps its existing signature and is used for its `Promise<boolean>` return in Task 1 and referenced in Task 2 only through the event. Event field names (`agentId`, `message`) and message fields (`id`, `role`, `text`, `createdAt`, `delegation.{id,direction,peerAgentId,peerName}`) match `src/shared/types.ts` verbatim. CSS class names in Task 2's tests (`chat-delegation-label`, `chat-delegation-badge`, `chat-msg delegation`) match Task 2's implementation steps exactly.
