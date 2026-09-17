# Changelog — Meow Coding v0.37.2 → v0.37.3

## 🚀 New Features

### Agent Loop Reliability & Process Monitoring
- **Process Monitoring**: Enhanced background shell watching and command polling in the `monitor` tool with improved regex pattern matching, lifecycle state cleanup, and robust timeout handling.
- **Text Matching**: Added robust exact text matching (`text-match.ts`) to improve file editing tool accuracy.
- **Repetition Safeguards**: Refined repetition detection in the agent loop to prevent false positives while avoiding agent loop wedging.

## 🧹 Internal & Docs
- Added design specs and implementation plans for agent loop reliability (`docs/superpowers/specs/2026-09-17-agent-loop-reliability-design.md`, `docs/superpowers/plans/2026-09-17-agent-loop-reliability.md`).
- Added Phase 1 design spec for IDE extension (`docs/superpowers/specs/2026-09-17-meow-ide-extension-phase1-design.md`).
- Updated system reference documentation (`docs/reference/03-agent-runtime.md`, `docs/reference/04-tool-catalog.md`).
- Bumped application version to `v0.37.3`.
