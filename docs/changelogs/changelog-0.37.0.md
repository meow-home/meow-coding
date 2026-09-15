# Changelog — Meow Coding v0.36.17 → v0.37.0

## 🚀 New Features

### Summary-First Compaction
- **Summarize instead of prune**: Crossing the context threshold now always folds the history into a summary, instead of pruning old tool outputs first and skipping the summary whenever pruning alone brought the estimate back under budget.
- **No more lost context**: Previously prune kept winning cycle after cycle on long sessions with large tool outputs, so no summary was ever produced and the model permanently lost what those outputs carried — it had to re-run tools to recover the information.
- **Single strategy**: The prune path was removed entirely; summarization is now the only compaction strategy, matching Claude CLI / Claude desktop.

### Subagent Overlay Pane
- **Docked detail pane**: Sub-agent task details now open in an overlay docked beside the chat (matching Files and Processes) instead of a centered modal popup.
- **Resizable**: Drag the left edge between 320px and 900px, default 420px, with the width persisted to `localStorage` under `meow.subagent.width`.
- **Full mode**: Maximize/restore over the chat pane, close via the header `X` or the `Escape` key.
- **Status at a glance**: Running/completed/error indicator, a `background` pill for background runs, the tools the sub-agent used, live output, and the final result block.

### Row-First Multi-Panel Layout
- **Vertical stacking**: With two right-side panels open (e.g. Files and Processes) they now stack top/bottom rather than splitting left/right, which keeps the chat pane at full width.
- **Smarter grid**: Layout follows `rows = ceil(sqrt(N))`, `cols = ceil(N / rows)` for any number of open panels.

## 📱 Mobile Remote Control — Coming Soon
- Mobile relay control and pairing features are under active development.
- Stay tuned — mobile companion release coming soon! 🚧

## 🐛 Bug Fixes
- **Chat**: The feed no longer stops following new messages on its own while a turn streams. Detaching now requires a real scroll gesture (mouse wheel, touch, keyboard nav, or a scrollbar drag) instead of any scroll event observed off the bottom — the DOM growing on its own (streamed deltas, content-visibility rows resolving their height, history paging) used to trigger it. Clicking "Scroll to end" and the start of a session always re-arm following.

## 🧹 Internal & Docs
- Added design specs and implementation plans for summary-first compaction, the subagent overlay pane, the row-first multi-panel grid, and gesture-driven chat follow.
- Added a unit-tested `scrollEventAction` classifier so the follow/detach rule is decided in one pure place.
- Updated module `AGENTS.md` files and system reference documentation.
- Bumped application version to `v0.37.0`.
