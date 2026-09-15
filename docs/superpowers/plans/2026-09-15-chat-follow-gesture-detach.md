# Chat Follow-New-Messages (Gesture-Driven Detach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat feed stop following the newest message only when the user performs a real scroll gesture (wheel, touch, scrollbar drag, keyboard), never because the DOM grew and the browser emitted a `scroll` event.

**Architecture:** Detach becomes gesture-driven instead of position-driven. A new pure helper `scrollEventAction()` in `chat-scroll-geometry.ts` classifies a `scroll` event as `none` / `follow` / `detach` given the programmatic-write flag, the scrollbar-drag flag and whether the feed sits at the literal bottom. `useChatScroll.onScroll` consumes that classification and no longer detaches from the observed position alone; the wheel / touch / keyboard handlers keep detaching on their own.

**Tech Stack:** React 19, TypeScript (strict), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-chat-follow-gesture-detach-design.md`

## Global Constraints

- TypeScript strict: `npm run typecheck` must pass (all four tsconfig projects).
- `npm test` must pass (`vitest run`).
- Source code, UI labels and docs are English; no unnecessary comments (only non-obvious decisions).
- IPC channel strings come only from `Channels` in `src/shared/ipc.ts` — this plan touches no IPC.
- Docs sync rule: `src/renderer/src/components/chat/AGENTS.md` and the matching
  `docs/reference/09-ui-guide.md` line must be updated in the same commit as the behavior change.
- Do not add a `Co-Authored-By` trailer to commit messages.
- Do not change `nextChatScrollMode`, the turn-anchor / tail-spacer math, or `ChatPanel.tsx`.

---

### Task 1: Add the pure `scrollEventAction` helper

**Files:**
- Modify: `src/renderer/src/components/chat/chat-scroll-geometry.ts` (append at end of file)
- Test: `tests/unit/chat-scroll-geometry.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces: `export type ChatScrollAction = 'none' | 'follow' | 'detach'` and
  `export function scrollEventAction(input: { programmatic: boolean; scrollbarDrag: boolean; atTrueBottom: boolean }): ChatScrollAction`.
  Task 2 imports both by these exact names from `./chat-scroll-geometry`.

- [ ] **Step 1: Write the failing test**

Open `tests/unit/chat-scroll-geometry.test.ts`. Add `scrollEventAction` to the existing import list
from `'../../src/renderer/src/components/chat/chat-scroll-geometry'`, keeping the list alphabetical
(so it goes between `nextChatScrollMode` and `tailSpacerHeight`):

```ts
import {
  CHAT_BOTTOM_FOLLOW_ZONE,
  CHAT_TRUE_BOTTOM_EPSILON,
  CHAT_TURN_TOP_INSET,
  anchorScrollTop,
  followScrollDelta,
  isAtTrueBottom,
  isInBottomFollowZone,
  nextChatScrollMode,
  scrollEventAction,
  tailSpacerHeight
} from '../../src/renderer/src/components/chat/chat-scroll-geometry'
```

Then insert this new `it` block inside the existing `describe('chat scroll geometry', ...)`, directly
after the `transitions only through explicit scroll intent` block and before the closing `})` of the
describe:

```ts
  it('only detaches follow mode on a real scroll gesture', () => {
    // The browser fires scroll events while the DOM itself grows (streamed
    // deltas, content-visibility rows resolving their height). A scroll event
    // off the bottom with no gesture must change nothing, or the feed detaches
    // on its own.
    expect(scrollEventAction({ programmatic: false, scrollbarDrag: false, atTrueBottom: false })).toBe('none')
    // A programmatic write (session-load pin, reconcile, jump-to-end) is never
    // user intent, whatever the position says.
    expect(scrollEventAction({ programmatic: true, scrollbarDrag: false, atTrueBottom: false })).toBe('none')
    expect(scrollEventAction({ programmatic: true, scrollbarDrag: true, atTrueBottom: false })).toBe('none')
    expect(scrollEventAction({ programmatic: true, scrollbarDrag: true, atTrueBottom: true })).toBe('none')
    // A scrollbar drag is the one gesture with no wheel/touch/key handler, so it
    // is recognised here.
    expect(scrollEventAction({ programmatic: false, scrollbarDrag: true, atTrueBottom: false })).toBe('detach')
    // Reaching the literal bottom always re-engages following, and outranks a drag.
    expect(scrollEventAction({ programmatic: false, scrollbarDrag: false, atTrueBottom: true })).toBe('follow')
    expect(scrollEventAction({ programmatic: false, scrollbarDrag: true, atTrueBottom: true })).toBe('follow')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`
Expected: FAIL — the module has no export named `scrollEventAction` (import/type error, or
`scrollEventAction is not a function`).

- [ ] **Step 3: Write minimal implementation**

Append to the end of `src/renderer/src/components/chat/chat-scroll-geometry.ts`:

```ts
export type ChatScrollAction = 'none' | 'follow' | 'detach'

// What a `scroll` event means for follow mode. A scroll event is NOT a reliable
// user-intent signal: the browser also fires them when the DOM grows (streamed
// deltas, content-visibility rows resolving their height, the session-load pin's
// per-frame writes) and scrollTop lags the new scrollHeight. Only a real gesture
// may detach — wheel, touch and keyboard detach in their own handlers, and a
// scrollbar drag is recognised here through the flag onPointerDown sets.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chat-scroll-geometry.test.ts`
Expected: PASS — all geometry tests plus the new one.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/chat-scroll-geometry.ts tests/unit/chat-scroll-geometry.test.ts
git commit -m "feat(chat): add scrollEventAction gesture classifier for follow mode"
```

---

### Task 2: Use gesture-driven detach in `useChatScroll`

**Files:**
- Modify: `src/renderer/src/components/chat/useChatScroll.ts`
- Modify: `src/renderer/src/components/chat/AGENTS.md` (the `useChatScroll.ts` table row)
- Modify: `docs/reference/09-ui-guide.md:143` (the `useChatScroll.ts` table row)

**Interfaces:**
- Consumes: `scrollEventAction` and type `ChatScrollAction` from `./chat-scroll-geometry`
  (Task 1, signature `(input: { programmatic: boolean; scrollbarDrag: boolean; atTrueBottom: boolean }) => 'none' | 'follow' | 'detach'`).
- Produces: no interface change. `ChatScrollController` keeps every member it has today except the
  private `isAtBottom` helper (which was never part of the exported interface) — `onScroll`, `onWheel`,
  `onTouchMove`, `onPointerDown`, `onPointerUp`, `onKeyDown` keep their signatures, so
  `ChatPanel.tsx` needs no change.

- [ ] **Step 1: Swap the geometry import**

In `src/renderer/src/components/chat/useChatScroll.ts`, change the import block to drop
`isInBottomFollowZone` and add `scrollEventAction` (keep the list alphabetical):

```ts
import {
  CHAT_ANCHOR_HOLD_FRAMES,
  CHAT_TURN_TOP_INSET,
  anchorScrollTop,
  followScrollDelta,
  isAtTrueBottom as isFeedAtTrueBottom,
  nextChatScrollMode,
  scrollEventAction,
  tailSpacerHeight
} from './chat-scroll-geometry'
```

- [ ] **Step 2: Delete the dead `lastScrollTopRef`**

Remove this line from the refs block:

```ts
  const lastScrollTopRef = useRef<number>(0)
```

Then remove the only write to it, inside `writeScrollTop`, so the callback reads:

```ts
  const writeScrollTop = useCallback((top: number) => {
    const feed = feedRef.current
    if (!feed) return
    programmaticRef.current = true
    feed.scrollTop = top
    requestAnimationFrame(() => { programmaticRef.current = false })
  }, [])
```

- [ ] **Step 3: Delete the unused `isAtBottom` callback**

Delete this whole callback (the 80px `isInBottomFollowZone` wrapper). It has no callers:

```ts
  const isAtBottom = useCallback(() => {
    const feed = feedRef.current
    if (!feed) return false
    return isInBottomFollowZone({
      scrollHeight: feed.scrollHeight,
      scrollTop: feed.scrollTop,
      clientHeight: feed.clientHeight
    })
  }, [])
```

- [ ] **Step 4: Stop wheel-up from detaching when the feed cannot move**

Replace `onWheel` with:

```ts
  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const feed = feedRef.current
    if (!feed) return
    if (event.deltaY > 0) {
      // Scrolling down away from the literal end yields control to the user.
      if (!isAtTrueBottom()) enterManual()
      return
    }
    // Wheel up only detaches when the feed can actually move up: a wheel-up at
    // scrollTop 0 (or on a transcript that does not overflow) emits no scroll
    // event, so nothing would ever re-engage following.
    if (event.deltaY < 0 && feed.scrollTop > 0) enterManual()
  }, [enterManual, isAtTrueBottom])
```

- [ ] **Step 5: Rewrite `onScroll` to be gesture-driven**

Replace `onScroll` with:

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

This removes both old detach paths: the `currentScrollTop < prevScrollTop - 1` upward-movement check
and the `else if (modeRef.current !== 'manual') enterManual()` position check that fired on every
scroll event observed off the bottom (the bug: DOM growth detaching the feed). `onTouchMove`,
`onPointerDown`, `onPointerUp` and `onKeyDown` are unchanged.

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npm run typecheck`
Expected: PASS, 0 errors — in particular no `lastScrollTopRef` / `isAtBottom` / `isInBottomFollowZone`
"declared but never read" or "cannot find name" errors.

Run: `npm test`
Expected: PASS (all unit + integration tests).

- [ ] **Step 7: Update the module docs**

In `src/renderer/src/components/chat/AGENTS.md`, edit only the `useChatScroll.ts` table row's
description of the detach rule. Replace the clause that says following resumes only at the literal
bottom with a version that adds the gesture rule and the growth regression, keeping the existing
format and the rest of the row intact:

> `useChatScroll.ts` | Feed scroll controller: follow/anchored/manual modes, turn-top anchoring, jump-to-end, jump button, and `isPinning()` (whether the session-load pin's settle loop is still running, so callers can tell a transitional scroll write from a user gesture). Detach is **gesture-driven**: only wheel, touch, keyboard nav, or a scrollbar drag leaves follow mode — a `scroll` event observed off the bottom while the DOM itself grows (streamed deltas, `content-visibility` rows resolving their height, history paging) must NOT detach it. Once the user scrolls away (manual mode) following only resumes at the literal bottom (`isAtTrueBottom`), not the loose 80px follow zone — re-arming there on a long, still-streaming turn would snap the viewport back down on the next delta (up/down jitter). `scrollEventAction()` classifies a scroll event into none/follow/detach; `chat-scroll-geometry.ts` holds the pure geometry helpers.

In `docs/reference/09-ui-guide.md`, replace the whole line 143 (`| `useChatScroll.ts` | ... |`) with:

```markdown
| `useChatScroll.ts` | Feed scroll controller: follow / anchored / manual modes, turn-top anchoring, jump-to-end button. Detach is **gesture-driven**: only wheel, touch, keyboard nav, or a scrollbar drag leaves follow mode — a `scroll` event observed off the bottom while the DOM itself grows (streamed deltas, `content-visibility` rows resolving their height, history paging) must NOT detach it. Once the user scrolls away (manual mode) following only resumes at the literal bottom — re-arming from the loose 80px follow zone would make a slight upward nudge on a long, still-streaming turn snap the viewport back down next delta (up/down jitter). `scrollEventAction()` classifies a scroll event into none/follow/detach; pure geometry helpers live in `chat-scroll-geometry.ts`. |
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/chat/useChatScroll.ts src/renderer/src/components/chat/AGENTS.md docs/reference/09-ui-guide.md
git commit -m "fix(chat): only detach feed follow mode on a real scroll gesture"
```

---

### Task 3: Manual verification of the follow behavior

**Files:**
- No file changes (verification only).

**Interfaces:**
- Consumes: the running app from Task 2.
- Produces: a confirmed behavior report; no code.

- [ ] **Step 1: Start the dev app**

Run: `npm run dev` (leave it running in the background).
Expected: the Electron window opens with no renderer console errors.

- [ ] **Step 2: Verify streaming does not detach**

Open a session and send a prompt whose answer streams for several seconds (e.g. "write a 200-line
summary"). While it streams: the feed stays pinned to the newest output and the "Scroll to end"
button never appears on its own.
Expected: no jump button appears; the newest content stays visible.

- [ ] **Step 3: Verify a wheel-up gesture detaches**

While the feed has overflow, scroll the mouse wheel up once.
Expected: the "Scroll to end" button appears immediately.

- [ ] **Step 4: Verify the jump button re-pins**

Click "Scroll to end".
Expected: the button disappears and the feed follows the newest message again, including for the
rest of the running turn.

- [ ] **Step 5: Verify start-of-session following**

Restart the app (or open a session whose transcript overflows) and, without scrolling, send a prompt.
Expected: the feed is already following — new messages auto-pin from the start.

- [ ] **Step 6: Verify scrollbar drag and keyboard**

Drag the scrollbar thumb upwards slightly; then, after re-pinning via the button, press `PageUp`.
Expected: both gestures detach and show the button; `PageDown`/`End` while already at the literal
bottom keeps following.

- [ ] **Step 7: Verify history paging keeps its deliberate detach**

Scroll to the top so an older page loads.
Expected: the feed detaches (button shown) and does not fight the newly prepended rows.

- [ ] **Step 8: Record the result**

Report per step PASS/FAIL with what was observed. If any step fails, stop and report it — do not
"fix forward" without a design decision.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| `scrollEventAction` pure helper + signature | Task 1 |
| `onScroll` no longer detaches on position | Task 2 Step 5 |
| `onWheel` wheel-up guard | Task 2 Step 4 |
| `onTouchMove` / `onKeyDown` / `onPointerDown` / `onPointerUp` unchanged | Task 2 Step 5 (explicit) |
| Dead code: `lastScrollTopRef`, `isAtBottom`, `isInBottomFollowZone` import | Task 2 Steps 2–3 |
| Programmatic writes ignored | Task 1 (classifier) + Task 2 Step 5 |
| History paging keeps `leaveFollowMode()` detach | Task 3 Step 7 (no code change needed) |
| Re-engage at literal bottom | Task 1 `'follow'` + Task 2 Step 5 |
| Initial state follows on session load | unchanged code; Task 3 Step 5 verifies |
| Unit tests for the classifier | Task 1 Steps 1–4 |
| Doc sync (`AGENTS.md`, `docs/reference/09-ui-guide.md`) | Task 2 Step 7 |

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows the
full code to write.

**Type consistency:** `scrollEventAction` is defined once (Task 1) with the exact input object keys
`programmatic` / `scrollbarDrag` / `atTrueBottom` and the exact return union
`'none' | 'follow' | 'detach'`, and Task 2 Step 5 calls it with those same three keys and compares
against those same three strings. The flags it reads (`programmaticRef`, `scrollbarDragRef`) are the
existing refs in `useChatScroll.ts`; `isAtTrueBottom` is the existing local wrapper over
`isFeedAtTrueBottom`.
