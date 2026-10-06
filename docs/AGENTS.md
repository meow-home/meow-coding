# AGENTS.md — docs

Documentation following the Superpowers workflow.

- `superpowers/brainstorms/` — brainstorm session notes.
- `superpowers/specs/` — design specs: goals, decisions, scope, architecture, data flow, error
  handling, testing, success criteria. Written **before** code.
- `superpowers/plans/` — step-by-step implementation plans, guiding from spec to execution.
- `superpowers/notes/` — technical notes / ad-hoc decisions.
- `reference/` — full system reference for agents/LLMs: product, architecture, agent runtime, tools,
  IPC, storage, providers, integrations, UI, build/release, conventions. Start at `reference/README.md`.
- `design/` — UI mockup galleries, one directory per redesign (`todo-popup-mockups/`,
  `landing-directions/`). Each holds an `index.html` chooser with live previews of every direction
  plus one self-contained HTML file per direction. Scratch, not shipped: once a direction is chosen
  it is folded into the real UI (`docs/index.html` for the landing page) and the gallery stays as a
  record of the alternatives.

## Conventions

- File naming: `YYYY-MM-DD-slug.md` (e.g. `2026-08-04-meow-coding-agent-console.md`).
- First line states the status (e.g. `Status: pending review`).
- Process: brainstorm → spec → plan → execute. Update spec/plan when decisions change.
- When writing a new spec/plan, refer to existing specs/plans to keep the format consistent.
- Language: all documentation (specs, plans, notes, reference pages) is written in English.