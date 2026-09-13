# Remove `sp-` Prefix from Default System Commands Design

## Context & Motivation
Currently, default Superpowers slash commands in Meow Coding are generated with an `sp-` prefix (e.g. `/sp-brainstorming`, `/sp-using-superpowers`), while non-Superpowers built-in commands use exact names like `/init`, `/review`, `/new`, and `/frontend-design`.
To make command names cleaner and directly aligned with Superpowers skill names, all built-in Superpowers slash commands will drop the `sp-` prefix so their command names match their skill names (e.g. `/brainstorming`, `/using-superpowers`).

## Goal
Remove the `sp-` prefix from built-in Superpowers slash commands in code, tests, and documentation, directly replacing them with exact skill names without legacy aliases.

## Changes

### 1. `src/main/agent/commands.ts`
- Modify `SUPERPOWERS_COMMANDS` array construction so each command uses `name: name` instead of `name: \`sp-${name}\``.
- Update doc comments referencing `sp-*.md` or `sp-*`.

### 2. Tests
- `tests/unit/agent-commands.test.ts`: Update command name expectations (`sp-using-superpowers` -> `using-superpowers`, `sp-brainstorming` -> `brainstorming`).
- `tests/unit/meow-agent-manager.test.ts`: Update tests invoking `/sp-brainstorming` to `/brainstorming`.

### 3. Documentation & AGENTS.md
- `src/main/agent/AGENTS.md`: Update command table references.
- `README.md`: Update `/sp-*` reference to match the new command names without `sp-`.
- `docs/reference/01-product-overview.md`: Update `/sp-*` reference.
- `docs/reference/03-agent-runtime.md`: Update `/sp-<name>` entry to `/<name>`.
- `docs/reference/11-conventions-and-pitfalls.md`: Update `/sp-*` reference.

## Non-Goals
- Keeping `/sp-*` as backward-compatibility aliases (user requested direct replacement).
- Modifying custom user-defined commands.
