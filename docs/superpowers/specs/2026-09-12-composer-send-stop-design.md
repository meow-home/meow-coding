# Composer Send / Stop Button — Design

**Date:** 2026-09-12
**Status:** Approved (design), pending implementation plan

## Summary

The composer card currently stacks a fixed two-row textarea and a text **Stop**
button on its own toolbar line below it, and it has **no Send button at all**
(Enter submits). This spec reshapes the card's bottom row into one line:

```
┌────────────────────────────────────────────────────────────┐
│ Type a message... (/ for commands)              [ ↵ ]      │
└────────────────────────────────────────────────────────────┘
```

One line tall at rest, growing with the text up to 8 lines and then scrolling
inside the card; one square icon button at the card's right edge, inside the
frame — **Send** at rest, **Stop** while a turn runs.

## Goals

1. **One line at rest.** The card opens **47px** tall (one 18px text line —
   `line-height: 1.5` × the field's `1rem` = the 12px root — plus 6px field
   padding top/bottom, the card's 8px padding and its 1px of border), instead of
   today's **71px** (two text rows + the gap + the empty toolbar line).

   These are measured, not derived: `border: 0.083333rem` at a 12px root is
   `0.99999px`, which Chromium reports as **0.5px per side** — hence 1px of
   border, not 2. The e2e spec computes the one-line height from the live
   computed styles rather than hard-coding 47, so a user-configured root
   font-size keeps the assertion honest.
2. **Send and Stop live inside the card, at its right edge** — both square
   icon buttons of the same size, at the same place, so the button does not move
   when a turn starts or ends.
3. **The frame never becomes the bottleneck.** Text grows the card up to 8 lines;
   past that the textarea scrolls internally, so a pasted file cannot push the
   transcript off screen.
4. **Running is legible at the composer.** The placeholder becomes
   `Processing…` while a turn is in flight, and the right-hand button turns into
   a red Stop.
5. **Sending stays one keystroke.** Enter still submits, Shift+Enter still
   inserts a newline, and the queueing behaviour while running is untouched.

## Non-goals

- **No left-side send button,** no button below the input, no floating
  button outside the card.
- **No accent border/glow for the running state.** Chosen explicitly: only the
  red Stop button and the `Processing…` placeholder signal "running". The
  existing focus styling (`--accent-border` + `--focus-ring` on
  `:focus-within`) stays as it is.
- **No change to `.chat-footer`** — the `+` add menu, `ModePicker`,
  `ModelPicker`, `VariantPicker` and the context readout keep their positions
  and behaviour.
- **No change to the permission/question prompt** (`promptSlot`) or the image /
  `@mention` chips; they keep stacking above the input row inside the card.
- **No new keyboard shortcuts.** Escape keeps closing the `/`-command and
  file-mention menus; it does not gain a second meaning here.
- **No character counter, no attachment button inside the row** (attaching is
  the footer's `+` menu, already shipped in `87a90ad`).

## Current state

`src/renderer/src/components/chat/ChatInput.tsx` renders the card as a column:

1. `{promptSlot}` — permission/question prompt, in flow.
2. the `/`-command and file-mention menus.
3. `.chat-input-main` — image chips, `@mention` chips, then
   `<textarea className="chat-input-field" rows={2}>`.
4. `.chat-input-toolbar` — a `flex: 1` spacer plus, **only while running**, a
   text button `<button className="chat-input-stop">Stop</button>`.

There is no Send control anywhere: `submit()` runs from the textarea's
`onKeyDown` on plain Enter. Both classes are styled in the `/* Composer */`
block of `styles.css` (`.chat-input-toolbar` line 947, `.chat-input-stop`
line 949).

**Root cause of the height.** `rows={2}` hard-codes two text rows, and the
toolbar is its own flex line separated by the card's `gap: 0.5rem` (6px), so the
empty card is `padding 8 + field (6 + 2×18 + 6) + gap 6 + toolbar 0 + padding 8`
= **71px** — a permanent reservation of two lines of text plus a button line.
(The toolbar itself collapses to 0px at rest: its only child is the `flex: 1`
spacer, and the Stop button exists only while running.)

## Approach

**Chosen — one flex row inside the card.** `.chat-input` stays a column for
`promptSlot` + chips, and the bottom of the card becomes
`[textarea flex:1][button 24×24]`. The textarea can never render under the
button, the button sits at the card's right edge minus the card's own padding
(inside the frame), and everything that already stacks above the input keeps
working unchanged. Deleting `.chat-input-toolbar` removes a whole flex line and
its gap from the card.

**Rejected — absolutely-positioned button in the card's corner.** Smaller diff,
but long text would run underneath the button (needs a right padding fudge on
the textarea), and with chips or a prompt in the card the button would anchor to
the card's corner rather than the input row.

**Rejected — keep the toolbar line and put the button there.** That is the
current shape, and it is what makes the card tall: a full extra flex line plus
its gap for a single 24px button.

**Growth mechanism — CSS `field-sizing: content`.** `rows={1}` +
`field-sizing: content` + `max-height: 13rem` (8 lines) + `overflow-y: auto`
grows and shrinks the field with its content, with no JS in the input path and
no React state involved. Chromium in Electron 41 supports it, and the repo
already relies on modern-Chromium-only CSS (e.g. `content-visibility: auto` on
`.tool-call`, `field-sizing` is the same class of dependency).

**Fallback if it does not behave** (it must also *shrink* after send and after
deleting text): a small `autoGrow(el)` helper that writes `style.height` from
`scrollHeight`, called in `onInput`, in `submit()`, in `pickFile()` and when
`editTarget` loads. Deterministic and testable, but it adds a reflow per
keystroke. The plan's first step validates the CSS route with a screenshot at
three states; the fallback is only taken if a state fails.

## Detailed design

### JSX (`ChatInput.tsx`)

```jsx
<div className="chat-input">
  {promptSlot}
  {/* command + file menus — unchanged */}
  <div className="chat-input-main">
    {/* image chips, @mention chips — unchanged */}
    <div className="chat-input-row">
      <textarea
        ref={fieldRef}
        className={`chat-input-field mode-${mode}`}
        placeholder={running ? 'Processing...' : 'Type a message... (/ for commands)'}
        rows={1}
      />
      {showSend && (
        <button
          className="chat-input-send"
          title={editTarget ? 'Save edit (Enter)' : 'Send (Enter)'}
          aria-label={editTarget ? 'Save edit' : 'Send'}
          disabled={!hasText}
          onMouseDown={e => e.preventDefault()}
          onClick={submit}
        >
          <CornerDownLeft size={14} aria-hidden="true" />
        </button>
      )}
      {showStop && (
        <button className="chat-input-stop" title="Stop" aria-label="Stop" onClick={onStop}>
          <Square size={12} fill="currentColor" aria-hidden="true" />
        </button>
      )}
    </div>
  </div>
  <input ref={fileInputRef} type="file" hidden … />
</div>
```

(JSX attributes cannot carry comments — `onInput`, `onPaste`, `onDrop` and
`onKeyDown` keep their current bodies, except that `onInput` also updates
`hasText`, as described below.)

`.chat-input-toolbar` and `.chat-input-toolbar-spacer` are deleted from the JSX
and their CSS rules removed. The `Square` and `CornerDownLeft` icons come from
`lucide-react` (already a dependency, already imported across the chat
components).

### Which button shows

| State | Send | Stop |
|---|---|---|
| Idle, not editing | yes (disabled while the field is empty) | no |
| Running, not editing | **no** — Enter still queues the message | yes |
| Running, editing a queued message | yes (disabled while the field is empty) | **no** |
| Idle, editing a queued message | yes (disabled while the field is empty) | no |

So one button is rendered at a time, in the same slot. `showSend = !running ||
!!editTarget`, `showStop = running && !editTarget`.

`Square size={12} fill="currentColor"` is a `12px` glyph inside the `24px` box —
bulkier than a stroked 14px icon, matching the red stop square in the reference.

### Send enabled/disabled state

The textarea is **uncontrolled** on purpose (documented in
`docs/reference/11-conventions-and-pitfalls.md`: "a controlled chat input
re-rendering on every keystroke → the composer is uncontrolled (ref-based)").
The button's disabled state needs the text, so:

```js
const [hasText, setHasText] = useState(false)
// in onInput, before syncMenu/syncMentions:
setHasText(prev => { const next = raw.trim().length > 0; return prev === next ? prev : next })
```

The functional update returns the same reference when the flag does not change,
so React bails out and **no re-render happens per keystroke** — only on the
empty ↔ non-empty transition.

Every site that writes `field.value` programmatically must keep the flag true,
because such a write fires no `onInput`: `submit()` sets it back to `false` (it
clears the field), the `editTarget` effect sets it to `true`, and `pickFile()`,
`applyCommand()` and `removeMention()` each set it from the value they just
wrote (the first two always insert text, so they set `true`). Missing one of
these leaves the Send button greyed out over a non-empty field.

Disabled with an empty field matches `submit()`'s existing guard
(`if (!text) return`): images alone do not send, so the button must not look
pressable when the text is empty.

### Vertical alignment

`.chat-input-row { display: flex; align-items: flex-end; gap: 0.5rem; }` with
`.chat-input-field { flex: 1; min-width: 0 }`.

Two constraints, both met by one 3px margin on the button:

1. **At rest the button is centred on the single text line.** With
   `align-items: flex-end` the button is 24px tall against an 18px line box, so
   its centre lands 3px above the line's centre (measured from the row's bottom:
   the button's centre is `12` up, the line's is `6 + 9 = 15` up). A
   `margin-bottom: 0.25rem` on the button lifts it clear of the row's bottom
   edge by exactly that 3px, making both centres `15` from the bottom.
2. **Once the field grows the button stays pinned to the row's bottom,** not
   floating in the middle of a 150px-tall box. `align-items: flex-end` gives
   this for free, and the 3px margin keeps the same inset at every height.

The 30px field box at rest (6 + 18 + 6) is taller than the button's 27px outer
height, so the button never stretches or drives the row's height; and with 6px
below the last line (field padding) plus the 3px margin, the button's bottom
stays inside the card at every size.

Both are asserted by screenshot at 1, 3 and 8 lines (tolerance 2px) rather than
taken on trust.

### CSS

```css
.chat-input-row { display: flex; align-items: flex-end; gap: 0.5rem; }
.chat-input-field {
  flex: 1; min-width: 0; resize: none; background: transparent; color: var(--text);
  border: none; padding: 0.5rem 0.333333rem;
  font-family: var(--font-ui); font-size: 1rem; user-select: text; line-height: 1.5;
  field-sizing: content; max-height: 13rem; overflow-y: auto;
}
/* shared geometry for both buttons */
.chat-input-send, .chat-input-stop {
  flex: 0 0 auto; width: 2rem; height: 2rem; padding: 0; margin-bottom: 0.25rem;
  display: inline-flex; align-items: center; justify-content: center; line-height: 0;
  border: none; border-radius: var(--radius-sm); color: #fff; cursor: pointer;
  transition: background 120ms ease;
}
.chat-input-send { background: var(--accent); }
.chat-input-send:hover:not(:disabled) { background: var(--accent-strong); }
.chat-input-send:disabled { background: var(--accent-dim); color: var(--text-faint); cursor: default; }
.chat-input-stop { background: var(--red); }
.chat-input-stop:hover { background: #ff7479; }
```

The card itself (`.chat-input`) keeps its `--radius`, `--shadow-1`,
`--bg-chat` and `:focus-within` ring; only its `gap: 0.5rem` column spacing
stays as is.

### Resulting geometry (12px base, `box-sizing: border-box` everywhere)

| | before | after |
|---|---|---|
| empty card height | 71px (0.5 + 8 + 48 field + 6 gap + 0 toolbar + 8 + 0.5) | **47px** (0.5 + 8 + 30 field + 8 + 0.5) |
| textarea | `rows={2}`, fixed at 48px | `rows={1}`, 30px at rest, grows to 8 lines (156px), then scrolls |
| Send | does not exist | 24 × 24, `--radius-sm`, `--accent`, inside the card |
| Stop | text button on its own toolbar line | 24 × 24 square, `--red`, same slot as Send |
| placeholder | `Message Meow...  ( / for commands )` | `Type a message... (/ for commands)` / `Processing...` |

## Testing

New `tests/e2e/composer.spec.ts`, modelled on `sidebar-sessions.spec.ts`'s
gated mock LLM (it holds the response open, which is what makes the running
state assertable instead of racing an instant reply). Assertions:

1. **Rest geometry.** `.chat-input-send` is visible, is inside `.chat-input`'s
   box, and its right edge sits exactly the card's horizontal padding (10px,
   `0.833333rem`) inside the card's right edge — i.e. the button is *inside* the
   frame, at its right, not floating outside it.
2. **One line at rest.** The card measures its derived one-line height ± 1px with an empty field, and the
   Send button's centre is within 2px of the first text line's centre.
3. **Growth and shrink.** Typing 5 newlines grows the card; the card stops
   growing at the 8-line cap and the textarea reports
   `scrollHeight > clientHeight`; clearing the field returns the card to the one-line height.
   This is the assertion that catches `field-sizing` not shrinking.
4. **Send state.** Disabled with an empty field; enabled after typing; clicking
   it sends the message (the transcript shows the user row) and the field and
   card reset.
5. **Enter still sends**, and Shift+Enter adds a newline instead.
6. **Running.** With the mock response held open: Send is gone, Stop is visible,
   the placeholder is `Processing...`, Enter queues the message (a
   `.chat-queue-item` appears), and clicking Stop ends the turn and brings Send
   back.
7. **Editing a queued message while running.** Clicking the queued row loads it
   into the field, Stop disappears, Send appears (enabled regardless of text),
   and clicking Send saves the edit.

Then `npm run typecheck`, `npm test`, and the full `npm run build && npm run e2e`.

## Documentation

- `docs/reference/09-ui-guide.md` — the `ChatPanel.tsx` row (it describes
  `chat-footer` and the composer card), the `ChatInput.tsx` row (it will no
  longer be "textarea (Enter to send)" with no mention of a button), and the
  icon-button paragraph if the new buttons belong in it.
- `docs/reference/01-product-overview.md` — the composer/message-sending row if
  it describes Enter-only sending.
- `src/renderer/src/components/chat/AGENTS.md` — the `ChatInput.tsx` row gains
  the send/stop button and the auto-growing field.
- `tests/e2e/AGENTS.md` — a row for `composer.spec.ts`.
- Root `AGENTS.md` — no change (no new dependency, no structural change).

## Follow-ups (explicitly out of scope)

- **Editing a queued message has no cancel.** Today Escape only closes the
  command/mention menus, and `onEditCancel` is only reachable from `submit()`,
  so an edit that the user does not want can only be saved. This change makes
  Send the only control in that state, which sharpens the gap but does not
  create it. A visible "Esc to cancel"/cancel affordance is a separate change.
- **Drag-to-resize** of the composer, and a persisted per-user height preference.
