# Changelog — Meow Coding v0.48.1 → v0.49.0

## 🚀 New Features

### Retryable error cards
- A failed turn is now saved to the transcript and rendered as an error card, so it survives a reload instead of disappearing with the session.
- When the failure is retryable the card offers **Retry**, which drops the error and resumes the turn where it stopped — no need to retype your request.
- Non-retryable failures (a blocked hook, a missing API key) show the reason without a Retry button.

### Redesigned thinking step
- The reasoning block is now a quiet margin note — a hairline rule in the gutter with a `Thought` label and a word count — instead of a boxed card that competed with tool calls and errors.
- The word count stays visible while the note is open, and a `Show` hint fades in on hover so a collapsed feed stays calm.
- Fixed the caret, which was nearly invisible on the light theme.

## 🐛 Bug Fixes
- Chat: one thought no longer splits into two blocks when a tool call interrupts the reasoning stream — the second half used to land after the tool, cut off from the first.
- UI: borders drawn with `--hairline-strong` now render; the token was referenced by five rules but never declared, so they silently computed to `0px` (the todo pill menu, the tool-cluster count pills, and card hover states).

## 🧹 Internal & Docs
- Removed the unfinished mobile remote-control feature (relay server, pairing, `RemoteTab`, IPC channels) — it was never shipped and the mobile client does not exist.
- Removed the last remnant of the retired trace feature — the startup purge of a legacy `userData/traces` directory — along with its reference docs and design specs.
- Default app font size is now 13px, with 12px kept as the `Small` preset.
- New `countWords` helper and a `reasoning.ts` module; updated chat, renderer and settings `AGENTS.md` files plus the UI reference page.
