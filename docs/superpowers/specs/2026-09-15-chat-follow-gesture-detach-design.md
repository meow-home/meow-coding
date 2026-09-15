# Design Spec: Chat Follow-New-Messages — Gesture-Driven Detach

**Date:** 2026-09-15
**Status:** Approved

## Problem

The chat feed is supposed to stay pinned to the newest message ("following") until the user
deliberately scrolls away. In practice it detaches on its own.

`useChatScroll.onScroll` decides the scroll mode purely from the **observed scroll position**: any
scroll event that lands anywhere other than the literal bottom (`isAtTrueBottom() === false`) calls
`enterManual()`, which stops following and shows the "Scroll to end" button.

But `scroll` events are not only produced by user input. They also fire while the DOM grows:
streamed assistant deltas, `content-visibility` rows resolving their real height, the session-load
pin's per-frame `scrollTop` writes, and the history-paging prepend. In those frames `scrollTop` lags
behind the new `scrollHeight`, so a scroll event is observed off the bottom and the feed detaches —
even though the user never touched the mouse. The user then has to click "Scroll to end" again.

Requirements (from the user):

1. Always follow the newest message when the user clicks "Scroll to end" (jump-to-end).
2. Always follow the newest message from the start of a session, before any scroll happens.
3. Detach **only** when a real user scroll gesture is detected (mouse wheel, touch, scrollbar drag,
   or keyboard navigation) — never because the DOM grew and a scroll event was observed.

## Solution

Make detach **gesture-driven** instead of position-driven:

- Detach happens in the dedicated gesture handlers that already exist (wheel, touch, keyboard),
  plus one scrollbar-drag path.
- The position-based detach in `onScroll` is removed. `onScroll` keeps only its re-engage path
  (reaching the literal bottom resumes following) and a scrollbar-drag detach.
- DOM auto-growth therefore produces `scroll` events that change nothing.

Re-engage stays position-based (user scrolled back down to the literal bottom): confirmed desired.

### Decision summary

| Question | Decision |
|---|---|
| Which gestures detach? | Mouse wheel, touch move, scrollbar drag, keyboard nav keys. |
| Does DOM auto-growth detach? | No — never. |
| Re-engage when the user scrolls back to the literal bottom? | Yes. |
| Initial state on session load? | Following (before any user scroll). |
| A gesture that cannot actually move the feed (no overflow, or wheel up at `scrollTop === 0`)? | Does not detach. |

## Detailed Changes

### 1. `chat-scroll-geometry.ts` — pure decision helper

Add a pure function so the new rule is unit-testable (the geometry module is the renderer's only
covered scroll surface):

```ts
export type ChatScrollAction = 'none' | 'follow' | 'detach'

export function scrollEventAction(input: {
  programmatic: boolean
  scrollbarDrag: boolean
  atTrueBottom: boolean
}): ChatScrollAction {
  if (input.programmatic) return 'none'
  if (input.atTrueBottom) return 'follow'
  if (input.scrollbarDrag) return 'detach'
  return 'none'
}
```

`'follow'` also means "hide the jump-to-end button". No existing constant or geometry helper
changes; `nextChatScrollMode` and its event vocabulary stay as they are.

### 2. `useChatScroll.ts` — `onScroll` no longer detaches on position

```ts
const onScroll = useCallback(() => {
  const feed = feedRef.current
  if (!feed) return
  const action = scrollEventAction({
    programmatic: programmaticRef.current,
    scrollbarDrag: scrollbarDragRef.current,
    atTrueBottom: isAtTrueBottom()
  })
  if (action === 'none') return
  if (action === 'detach') {
    enterManual()
    return
  }
  modeRef.current = nextChatScrollMode(modeRef.current, 'user-bottom')
  setShowJumpToEnd(false)
}, [enterManual, isAtTrueBottom])
```

Removed: the `currentScrollTop < prevScrollTop - 1` upward-movement detach and the
`else if (modeRef.current !== 'manual') enterManual()` position detach for every non-bottom scroll
event. `lastScrollTopRef` was only read by that removed comparison — drop the ref and its writes in
`writeScrollTop`.

### 3. `useChatScroll.ts` — gesture handlers

- `onWheel`: keep `deltaY > 0 && !isAtTrueBottom() → enterManual()`. For `deltaY < 0`, only detach
  when the feed can actually move up (`feed.scrollTop > 0`); a wheel-up on a feed that is already at
  the top, or on a transcript short enough not to overflow, is a no-op gesture and must not detach
  (with no scroll event to follow it, nothing would ever re-engage).
- `onTouchMove`: unchanged (`enterManual()`).
- `onKeyDown`: unchanged — already detaches only for nav keys and keeps following for the
  down-keys when already at the literal bottom.
- `onPointerDown` / `onPointerUp`: unchanged — they maintain `scrollbarDragRef`, which `onScroll`
  now consumes to detach on a scrollbar drag (the only gesture with no wheel/touch/key handler).

### 4. Dead code

`useChatScroll.isAtBottom()` (the 80px `isInBottomFollowZone` wrapper) has no callers. Remove it and
the now-unused import. `isInBottomFollowZone` itself stays exported and tested in
`chat-scroll-geometry.ts`.

## Data Flow

```
wheel / touch / keyboard ──► dedicated handler ──► enterManual()  (detach)
scrollbar drag (pointerdown sets flag) ──► onScroll ──► enterManual()  (detach)
scroll to literal bottom ──► onScroll ──► following + hide button     (re-engage)
DOM grows / reconcile writes / history prepend ──► onScroll ──► nothing (or programmatic → skipped)
session load (pinSessionToEnd) / jump button ──► following + hide button
```

Modes are unchanged: `following` ⇄ `manual`, with `anchoring-turn` entered on message start and
released on `anchor-applied`. The tail-spacer / reconcile / turn-anchor machinery is untouched.

## Edge Cases

- **Programmatic writes.** `writeScrollTop` sets `programmaticRef` for one frame; those scroll events
  stay ignored (`'none'`), so the session pin and reconcile cannot detach the feed.
- **History paging.** `ChatPanel` calls `scroll.leaveFollowMode()` (→ `enterManual`) *before*
  prepending an older page, so paging still detaches deliberately; the prepend's own scroll events no
  longer detach anything on top of that.
- **Collapsed content (height shrink).** If the feed shrinks and the browser clamps `scrollTop` up to
  the new bottom, `onScroll` sees `atTrueBottom` and re-engages. Accepted: re-engage is
  position-based by requirement.
- **Scrollbar click on the track.** Pointerdown sets the flag, the resulting scroll detaches.

## Testing

- `tests/unit/chat-scroll-geometry.test.ts`: add cases for `scrollEventAction` — programmatic →
  `'none'`; off-bottom without a drag → `'none'` (the regression this fixes); off-bottom during a
  scrollbar drag → `'detach'`; at true bottom → `'follow'`.
- `npm run typecheck`, `npm test` pass.
- Manual: open a session, let a turn stream — the feed stays pinned and the "Scroll to end" button
  never appears on its own. Wheel up once → button appears. Click it → pinned again. Load a session,
  page older history → stays detached while paging.

## Out of Scope

- No API, IPC, or store changes.
- No change to the turn-anchor / tail-spacer / follow-geometry math.
- No change to `ChatPanel`'s `onFeedScroll` / `onFeedWheel` wrappers (the paging check keeps running
  after the controller handler).
