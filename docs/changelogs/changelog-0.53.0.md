# Changelog — Meow Coding v0.52.1 → v0.53.0

## 🚀 New Features

### Delegate tasks to the Antigravity CLI
- Meow can hand a focused task to the Antigravity CLI (`agy`) with the new `delegate_cli` tool — just ask for it in chat. It works like `delegate_session`: the task is queued, and the result lands back in the chat with a `CLI result` label and wakes Meow.
- There is nothing to set up. Meow uses the `agy` install and sign-in already on the machine, and keeps no accounts, profiles or sessions of its own. `delegate_cli` takes just `{ task }`.
- Each call is a fresh headless run in the session's project folder, one at a time. File writes, commands and URL reads follow Meow's own permission rules, and the child process only gets an allowlisted environment.
- **Settings → Antigravity CLI** is a readiness page, not a config screen. It checks that `agy` is installed and new enough (1.5.0+), has a **Run test** button that sends a one-line prompt to prove the sign-in works, and shows the install command with a Copy button when `agy` is missing.

### `delegate_session` spawns a sub-session
- `delegate_session` now creates a new persistent sub-session for the task instead of targeting an existing one. The sub-session keeps its own transcript, mode, permissions, hooks and tools, and returns its result to the caller.
- Sub-sessions are listed in the sidebar nested under the session that delegated them; removing a session removes its sub-sessions.
- Optional `title` sets the sidebar title (default: the task's first line), and optional `model` runs the sub-session on another model — an exact `provider/model` or a name like `opus`. An ambiguous or unknown value fails with the available models so the agent can retry.
- A session may have at most five delegations in flight.

## 🐛 Bug Fixes
- Session: adding a project no longer creates a default Meow session.

## 🧹 Internal & Docs
- The CLI agents work was first built as a general runtime/accounts/sessions system (OpenCode, Google and Gemini-key accounts, PTY sign-in, CLI sessions in the sidebar) and then cut down to the Antigravity-only delegation above before release; none of that surface ships.
- New `src/main/cli-agents/` module (`AntigravityCli`, binary check, policy, run manager, stream-json parser) and a single `cli:check` / `cli:test` IPC pair; `docs/reference` §8.5 and the module `AGENTS.md` files describe the final design.
- New `model-select.ts` resolves free-form model requests for `delegate_session`; the same-project peer roster in the turn reminder is gone.
- Reference docs (tool catalog, data and storage, UI guide, IPC contract), the delegation design notes and the module `AGENTS.md` files updated alongside.
