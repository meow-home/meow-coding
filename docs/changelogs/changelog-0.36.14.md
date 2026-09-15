# Changelog — Meow Coding v0.36.13 → v0.36.14

## 🚀 New Features

### Extended Lifecycle Hooks Engine
- **5 New Hook Events**: Added `UserPromptSubmit`, `SessionStart`, `SubagentStop`, `PreCompact`, and `SessionEnd` events to the lifecycle hook engine.
- **Hook Fire Sites**: Fired automatically on prompt submission, session creation/deletion, subagent execution completion, and prior to transcript compaction.

### Command Polling in Monitor Tool
- **Command Polling Mode**: Added support for polling arbitrary CLI commands at intervals (`command` mode) in addition to watching background process IDs.
- **`PollMonitorStore` Integration**: Interval command polling monitors command output for expected regex patterns until resolution or timeout.
- **Background Steering Hints**: Updated system prompts and foreground timeout error messages to steer the agent toward `run_in_background` and `monitor`.

## 🐛 Bug Fixes & Improvements

- **Pruned Output Handling**: Tool output truncation and pruning now surface context-saving notifications as benign notes rather than tool errors, preventing agent derailment.
- **Chat Follow Mode**: Refined auto-scroll behavior to disable follow mode immediately on manual scroll-up and re-enable only when reaching true bottom.
- **Dark Mode Card Styling**: Fixed card backgrounds in update notifications and settings tab cards to use theme-aware CSS variables (`var(--bg-raised)`).

## 🧹 Internal & Docs
- Added design specs and implementation plans for extended lifecycle hook events and monitor command polling mode.
- Updated system documentation and module `AGENTS.md` files.
- Bumped application version to `v0.36.14`.
