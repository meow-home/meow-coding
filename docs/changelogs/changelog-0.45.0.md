# Changelog — Meow Coding v0.44.2 → v0.45.0

## 🚀 New Features

### External delegation (Claude Code → Meow)
- New **Settings → Controls & Context → External delegation** tab: enable a loopback API (off by default) that lets Claude Code hand plan tasks to Meow.
- Ships a dependency-free `meow-delegate` CLI (copied to `userData/bin/`): `start`, `send`, `status`, `cancel`. It blocks until the task ends, so Claude's background shell wakes the model with the result block and exit code.
- Each plan gets its own visible `[claude] <plan>` session; later tasks and Claude's feedback land in the same session, and the project is added to the sidebar automatically when missing.
- **Install Claude skill** writes a `meow-delegate` skill to `~/.claude/skills/` that tells Claude to delegate task by task, verify the diff and tests itself, and send at most 3 feedback rounds.
- New delegated sessions start on your last used model (falling back to the default provider); a reused session keeps its own model.
- Copy the API token to the clipboard or regenerate it from the tab; the CLI picks up a new token automatically.
- Incoming delegated messages are labelled `From: Claude (external)`.

## 🐛 Bug Fixes
- Delegation: stopping a running delegated turn now settles it as `cancelled` instead of `completed` with a previous turn's answer.
- Delegation: a turn's result only uses assistant text produced during that turn.
- External API: queued external tasks resume after an app restart.
- External API: the server falls back to a free port when the preferred one is in a Windows excluded range (`EACCES`).

## 🧹 Internal & Docs
- Loopback server hardening: bearer token with constant-time compare, `Origin` requests rejected, 64 KiB body cap, token file mode `0600` on POSIX.
- `SessionDelegationService` gains external-source records, `createExternal`, and `cancel` for running work; `MeowAgentManager` gains `ensureAgent` and `defaultSessionModel`.
- New `workspace:changed` event so sessions created from the main process appear in the sidebar live.
- Added the external delegation spec and plan, reference pages (IPC, storage, integrations, UI), and `src/main/external-api/AGENTS.md`.
