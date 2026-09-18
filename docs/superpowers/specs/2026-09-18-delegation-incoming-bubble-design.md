# Delegation incoming bubble — Design Spec

Date: 2026-09-18 · Status: awaiting written-spec review
Depends on: [2026-09-17 session-to-session delegation](./2026-09-17-session-to-session-delegation-design.md) (§12.2 is the parent design; this spec implements only its bubble part)

## 1. Problem

When a session delegates work through `delegate_session`, the target session silently starts
working: no bubble for the delegated task appears while the turn runs. `ChatPanel` only reloads the
transcript on mount / `agentId` change (and after undo/redo or when paging older history) — the
`done`/`error` handler does **not** reload it, and a session that is merely hidden stays mounted — so
the delegated task text effectively stays invisible until the pane is remounted (app restart, or
opening the project fresh).

Cause: `MeowAgentManager.runDelegatedTurn` persists the incoming message with
`id: delegation-incoming:<delegationId>` and then calls `runTurn(..., { messageAlreadyPersisted: true })`.
Because of that flag, `runTurnInner` skips **both** `store.appendMessageIfMissing` **and**
`emit({ type: 'user-message' })`, so the renderer never learns about the message until a later
transcript load.

The renderer is also delegation-unaware: `FeedItem` message rows drop `ChatMessage.delegation`, so
even after a reload the bubble carries no marker of where it came from. Nothing distinguishes a
delegated task from a message the user typed themselves.

## 2. Goal

Show the delegated task in the target session as a normal user bubble, appearing the moment the
delegated turn starts, labelled with the source session so it is distinguishable from genuine user
input.

Non-goals (deferred, still owned by the parent spec §12 / plan Task 6):

- outgoing delegation card in the source session (§12.1) — the source side keeps its current
  behaviour unchanged;
- delegation status, timing, error text, `Open session`, and cancel actions;
- a bubble for a delegation still in `queued` state (target busy) — the bubble appears only when
  the turn actually starts;
- sidebar queued-delegation counts and needs-input reuse (§12.2 second paragraph);
- any new IPC channel.

## 3. Decisions

| Topic | Decision |
|---|---|
| Timing | Bubble appears when the delegated turn starts, never earlier |
| Source session | Unchanged; no delegation rendering added there |
| Target rendering | A regular user bubble plus a small source label above it |
| Label content | `From session: <peerName>` with a `delegation` badge |
| Transport | Extend the existing `user-message` ChatEvent; no new IPC |
| Persistence | Reuse `ChatMessage.delegation` (`direction: 'incoming'`, `peerName`), already persisted |
| Duplicate safety | Emit only when `appendMessageIfMissing` actually wrote the message |
| Session auto-naming | Not triggered by a delegated message |

## 4. Data flow

1. `SessionDelegationService` calls `runtime.runDelegatedTurn({ delegationId, sourceAgentId, sourceName, targetAgentId, targetSessionId, task })`.
2. `runDelegatedTurn` builds the incoming `ChatMessage` (`role: 'user'`, `text: task`,
   `delegation: { id, direction: 'incoming', peerAgentId: sourceAgentId, peerName: sourceName }`).
3. `store.appendMessageIfMissing(targetSessionId, message)` returns whether the message was newly
   written. Only `true` proceeds to the next step, so a recovery redelivery cannot duplicate the
   bubble.
4. `emit({ type: 'user-message', agentId: targetAgentId, message })` delivers the bubble to the
   renderer immediately.
5. `runTurn(..., { messageAlreadyPersisted: true, delegation, messageId })` runs the turn as today.
6. The renderer upserts the row by message id (existing `user-message` reconciliation), and
   `FeedItem`/`toFeedItem` carry `delegation` so a transcript reload renders the same bubble.

`onUserMessage` is deliberately **not** called: a delegated task must not auto-rename the target
session (the current behaviour, preserved).

## 5. Renderer

- `FeedItem` message rows gain `delegation?: ChatDelegationMeta`; `toFeedItem` copies
  `it.message.delegation`, and the `user-message` handler copies `e.message.delegation`.
- `FeedMessage` renders, for `delegation?.direction === 'incoming'` only, a compact label row above
  the bubble: a `delegation` badge and `From session: <peerName>`. The bubble keeps the existing
  user styling, with a muted left accent so it reads as delegated rather than typed.
- `direction: 'result'` rows are untouched, so the source session renders exactly as it does today.
- UI labels are English, matching the project convention.
- Styling uses existing CSS variables; no new hardcoded colors.

## 6. Testing

- `tests/unit/meow-agent-manager-delegation.test.ts`: a delegated turn emits exactly one
  `user-message` for `delegation-incoming:<id>`; a redelivery of the same delegation emits none;
  the emitted message carries `delegation.direction === 'incoming'` and the source name.
- `tests/unit/chat-panel-events.test.ts` (jsdom): an incoming `user-message` renders a bubble with
  the source label; a transcript load containing the same message restores the label after reload.
- Gate: `npm run typecheck`, `npm test`. No e2e impact beyond the existing smoke run.

## 7. Docs

- Update `docs/reference/09-ui-guide.md` (delegated incoming bubble) and the affected `AGENTS.md`
  files (`src/main`, `src/renderer/src/components/chat`) when implementing.
- The parent spec's §12.2 stays accurate: its remaining items (sidebar counts, needs-input) are
  still unimplemented and remain part of Task 6.

## 8. Success criteria

- Starting a delegation makes the task appear immediately in the target session as a labelled user
  bubble.
- Reloading the target pane reproduces the same labelled bubble from the transcript.
- Recovery/redelivery never produces a duplicate bubble.
- The source session's rendering is byte-for-byte unchanged.
