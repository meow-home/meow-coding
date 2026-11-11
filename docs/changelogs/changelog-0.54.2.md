# Changelog — Meow Coding v0.54.1 → v0.54.2

## 🚀 New Features

### Tasks panel badges what is running
- Every card now opens with an identity badge — the Meow logo for a session agent, the Antigravity logo for an `agy` CLI run, Terminal for a shell, Users for a sub-session, RefreshCw for a poll — and the row-level state dot is gone, since the status chip already carries the state.
- A delegation card can tell an Antigravity CLI run from a sub-session (`antigravity · <target>`), and the CLI settings card uses the Antigravity logo too.

### External delegation picks a model
- `meow-delegate models` lists every configured model, marking the default one and the account it belongs to, and `--model` on `start`/`send` delegates the task on a requested model.
- A requested model is resolved the same way `delegate_session` resolves one (`provider/model`, an exact id, or a name like `opus`), and `GET /v1/models` plus the installable Claude skill describe the new flow.

## 🐛 Bug Fixes
- Git: the Changes panel lists untracked files one row per file with a diff, instead of collapsing a new directory into a single unnamed row; the status bar counts files rather than folders.

## 🧹 Internal & Docs
- README rewritten for the current release — panels, tools, skills, commands, settings, sources and build/release notes — and `docs/index.html` updated to match (version, tool/skill/command counts, Superpowers removed, repository links).
- Reference docs and unit/integration tests updated for the tasks badge and the external-delegation model selection.
