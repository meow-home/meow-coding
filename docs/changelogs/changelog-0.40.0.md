# Changelog — Meow Coding v0.39.1 → v0.40.0

## 🚀 New Features

### Superpowers skills synced to v6.4.1
- Added the **`diagnosing-superpowers`** skill (with `prompts/`, `references/` and `templates/`) to investigate why a Superpowers skill isn't behaving as expected, and registered it as a `/diagnosing-superpowers` slash command.
- **`executing-plans`** now supports native plan execution with `task-start`/`task-done` scripts.
- **`subagent-driven-development`** gained continuous execution and upgraded review/task scripts (review-package, sdd-workspace, task-brief).
- Refreshed **`brainstorming`** (visual-companion frame template + server), **`writing-plans`**, **`writing-skills`**, **`requesting-code-review`** (+ `code-reviewer.md`), **`test-driven-development`** and **`finishing-a-development-branch`**.

## 🧹 Internal & Docs
- Updated the bundled skill set while keeping meow's harness-specific customizations: the `using-superpowers` platform list stays scoped to Codex/Pi/Antigravity, and skill scripts continue to run as bare `./scripts` paths (no interpreter prefix) since meow's bash tool already routes them through Git Bash.
- Registered the new skill command and updated the bundled-skill test and agent-runtime reference page.
