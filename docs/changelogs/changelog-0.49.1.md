# Changelog — Meow Coding v0.49.0 → v0.49.1

## 🐛 Bug Fixes
- Chat: a tool call whose arguments arrive malformed is now repaired before validation instead of being rejected, so the model no longer burns a turn on a failed call followed by a retry. Two shapes are covered: a field sent as a JSON-encoded string with the model still writing into it (the `question` tool's `options` swallowing `question` — the call used to fail with "expected string, received undefined"), and several argument objects concatenated into one call (`{"name":"a"}{"name":"b"}`), which lost the whole input.
- Chat: a field the tool's schema declares as an array but that arrived as a single value (e.g. `grep`'s `include`) is wrapped in a one-element array rather than rejected.
- Main: `delegations.load()` and `ensureExtensionInstalled()` could throw on a locked or read-only `userData` and reject the app-ready chain before the window was created — the app started with no window. Both are best-effort and now log and continue.

## 🧹 Internal & Docs
- New `agent/tool-input-repair.ts` wired as the `streamText` `experimental_repairToolCall` hook; the per-tool normalizers (`normalizeOptions`, the `todowrite` guard) only run after validation and never saw these shapes.
- Replayed all 17 invalid tool calls recorded in real sessions through the repair: 16 now validate.
- e2e assertions derive their rem-based metrics from the live root font-size instead of hardcoding px values that only held at the 12px root.
- Bumped version to 0.49.1.
