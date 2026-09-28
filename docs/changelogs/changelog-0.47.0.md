# Changelog — Meow Coding v0.46.2 → v0.47.0

## 🚀 New Features

### Automatic recovery from looping models
- A model that starts repeating itself no longer ends the turn with "The model could not make progress". The looping output is discarded and the step is re-run with a short `[meow]` nudge to act now.
- Recovery escalates over three levels: a nudge, then anti-repetition sampling, then a context compaction. The chat shows `[meow] Model started repeating itself — recovering (n/3)`.
- Three clean steps in a row reset the ladder, so long turns with occasional stumbles keep running.
- When automatic recovery is exhausted, the session pauses and asks: **Continue**, **Stop**, or type guidance that is sent as your message.
- Repeated identical tool calls and repetition after tool calls go through the same recovery; cut responses (too many tool calls, writing after tool calls) never end a turn.
- Each recovery step logs a `[meow] recovery …` line (model, kind, level, tail of the output) to the daily log.

## 📱 Mobile Remote Control — Coming Soon
- Developing WS relay, pairing code, and mobile chat sync.
- Stay tuned — mobile companion app is in active development 🚧.

## 🐛 Bug Fixes
- Agent: long turns were stopped after the third stumble anywhere in the run, even with many clean steps in between.
- Agent: the anti-repetition retry replayed the same looped context and usually looped again.
- Delegation / external API: a session that exhausts recovery now waits for an answer in the Meow UI (like permission prompts) instead of returning `stuck` immediately.

## 🧹 Internal & Docs
- New `recovery-policy.ts` (sliding-window ladder) replaces `MAX_LOOP_BREAKS` and the consecutive-cut counter.
- Spec and implementation plan for the recovery ladder; updated agent-runtime, IPC, providers, UI reference pages and the affected `AGENTS.md` files.
