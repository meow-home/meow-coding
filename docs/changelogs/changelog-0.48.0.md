# Changelog — Meow Coding v0.47.0 → v0.48.0

## 🚀 New Features

### Manual `/compact`
- New `/compact [focus]` command summarizes older context on demand; text after the command tells the summary what to keep (e.g. `/compact keep the auth flow details`).
- Idle sessions compact right away; during a running turn, compaction happens at the next step without stopping the turn.
- Works even with auto-compaction turned off. Prompts sent while compacting are queued, and a second `/compact` reports `[meow] Compaction already in progress.`
- The chat shows `[meow] Nothing to compact yet.` or `[meow] Compaction saved little context — the recent steps are most of it.` when there is little to gain.

### Compaction that keeps up with long autonomous turns
- A single long turn can now be summarized: older tool steps become the summary while your original request stays verbatim.
- Compaction keeps running as long as each pass frees at least 20% of the context, instead of stopping after two per turn.
- When a turn alone exceeds the window, the oldest steps are dropped as a last resort while the request and latest step are kept.

## 📱 Mobile Remote Control — Coming Soon
- Developing WS relay, pairing code, and mobile chat sync.
- Stay tuned — mobile companion app is in active development 🚧.

## 🐛 Bug Fixes
- Providers: Ollama Cloud and other OpenAI-compatible providers now report token usage, so the context readout and cost show real numbers.
- Agent: stale token usage no longer triggers an extra compaction right after one just ran.
- Agent: idle auto-compaction no longer skips the summary because of the previous turn's state, and no longer races a session that just became busy.
- Delegation: a session delegated to while it was compacting no longer waits until an unrelated turn ends.

## 🧹 Internal & Docs
- New pure helpers `planCompaction` / `splitWithinTurn` and step-aware `hardTruncate` in `compact.ts`; new `notice` chat event.
- Spec and implementation plan for manual compaction; updated agent-runtime, IPC, providers, architecture reference pages and the affected `AGENTS.md` files.
