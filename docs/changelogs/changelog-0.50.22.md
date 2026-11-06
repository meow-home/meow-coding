# Changelog — Meow Coding v0.50.21 → v0.50.22

## 🚀 New Features

### Context panel
- The context readout in the composer footer is a button now: clicking the ring opens a panel instead of the old hover tooltip.
- The panel shows what fills the context window, one total per bucket: system prompt, project instructions, memory rules, memory index, skills, mode, tools, MCP tools, messages and free space, each with its token count and share of the window.
- A stacked bar above the rows draws the same composition against the window limit, so the used span and the free tail are visible at a glance.
- The panel refreshes when it opens, so the breakdown follows the transcript; `Escape` or a click outside closes it.

## 🧹 Internal & Docs
- New `agent/context-report.ts` measures the next request the way the runner builds it — the same prompt sections, the runner's own tool map (including `task` / `delegate_session` / `revert` / `lsp`), each tool by name + description + JSON schema (zod converted via `z.toJSONSchema`), MCP tools split on the `mcp__` prefix, and the transcript through the compaction estimate.
- `ContextInfo` gains `sections` + `estimatedTotal`; `MeowAgentManager.getContextInfo` fills them and keeps the last runner tool map per agent.
- The context readout is portaled through `BaseDropdown`, and the e2e spec was reworked for the click-to-open panel (it also drops two assertions that had gone stale on master).
