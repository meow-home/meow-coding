# Changelog — v0.36.5

## 🐛 Bug Fixes

- **Draft Session Model Selection**: Fixed draft session model picker defaulting to empty state and reverting to system default model upon creating a session. Draft session now pre-fills with system default model and respects user-selected model when creating a session.
- **Slash Commands in Draft Sessions**: Fixed slash commands in new/draft sessions bypassing session materialization (`onSendDraftMessage`) and silently failing. Slash commands in draft sessions now correctly materialize the session before executing the command.

## 🧹 Internal & Tests

- Added unit tests for `DRAFT_SESSION_ID` model pre-filling and agent materialization in `tests/unit/meow-agent-manager.test.ts`.
- Updated `src/main/AGENTS.md` documentation for draft session model handling.
- Bumped application version to 0.36.5.
