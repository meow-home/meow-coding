# AGENTS.md — src/renderer/src/components/chat

The native-agent chat panel: message feed, streaming deltas, tool-call cards, permission/question
prompts, message queue, and the composer (input + image attach + @-mention). Renders `ChatEvent`s
pushed from main over IPC (`window.api.onChatEvent`).

## Key files

| File | Responsibility |
|---|---|
| `ChatPanel.tsx` | Main container: subscribes to chat events, owns feed state (items/todos/queue/pendingPrompt), rAF-batches stream deltas, renders feed + composer + context footer. Transient status lines (compaction, retry) live only in feed state — never written to the transcript. The retry line shows `(attempt N/M)` for rate limits and `(attempt N — waiting for the network/API to recover)` for unbounded retries. On mount it restores an in-flight permission/question prompt via `window.api.getPendingPrompt` so a remounted panel doesn't leave the agent hanging. The prompt box is rendered in-flow at the top of the chat input card (never overlays the chat history), with a header + collapse toggle (keeps a one-line summary while collapsed). The composer's bottom row (`chat-footer`) places the context readout on the left and the mode/model/variant selectors on the right. Older history is paged in 50-item windows as the feed nears the top; that auto-page is suppressed while the session-load pin is settling (`isPinning()`), because the pin writes `scrollTop` on every frame and a mid-pin read looks like "the user is at the top" — paging there prepended a window the pin could not compensate for, leaving the feed far above the bottom of its window. Memoized. |
| `useChatScroll.ts` | Feed scroll controller: follow/anchored/manual modes, turn-top anchoring, jump-to-end, jump button, and `isPinning()` (whether the session-load pin's settle loop is still running, so callers can tell a transitional scroll write from a user gesture). `chat-scroll-geometry.ts` holds the pure geometry helpers. |
| `ChatInput.tsx` | Composer: textarea (Enter to send), paste/drop image chips (≤4, ≤5MB), `@` file-mention dropdown + chips, edit-queued flow. Memoized. |
| `parseCommandInput.ts` | `parseCommandInput(raw)` → `{ isCommand, prefix }` for the `/`-command menu. |
| `ToolCallCard.tsx` | Renders a tool call: input JSON, diff (for edit/apply-patch), output/error. Memoized. |
| `MarkdownText.tsx` | Markdown rendering via `marked` + `DOMPurify.sanitize`. |
| `DiffView.tsx` | Inline diff view for edit tool calls. |
| `ContextFooter.tsx` | Context readout — a 24 × 24 icon-button ring (20px, 2.5px stroke, `--radius-xs`, `--bg-hover` on hover). Hover-only: no click handler. Hovering shows a popover with session tokens in/out + cost. |
| `ModelPicker.tsx` | Model selector for the agent. |
| `VariantPicker.tsx` | Variant selector (reasoning effort etc.) for the agent. |
| `ModePicker.tsx` | Build/Plan mode selector (dropdown) in the composer footer. |
| `Dropdown.tsx` | Reusable dropdown menu (used by ModelPicker/VariantPicker/ModePicker). |
| `questionAnswer.ts` | `buildQuestionAnswer` — helper for permission/question answers. |
| `markdownTable.ts` | `normalizeMarkdownTables` — repairs markdown table pipes before rendering. |
| `ChatErrorBoundary.tsx` | Error boundary wrapping `<ChatPanel>` in `Pane.tsx` (a render/lifecycle error in the chat pane used to unmount the whole React root — a black, unresponsive window). Catches it to a contained card (Reload remounts ChatPanel via a bumped key) and logs the full stack to the system log. |

## Conventions

- Feed updates are batched per animation frame (`flushDeltas`) to avoid input lag — keep streaming hot paths cheap.
- `FeedMessage`/`ToolCallCard` are memoized; update copy-on-write (never mutate items in place) so memo works.
- Message queue: prompts sent while a turn runs are queued in main; renderer shows `queued` badge rows and supports remove/edit via `window.api.removeQueued/editQueued`.
- Images travel as dataURL strings in `ImageAttachment`; only image/* accepted.
