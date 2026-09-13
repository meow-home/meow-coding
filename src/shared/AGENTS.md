# AGENTS.md — src/shared

Shared contract between main / preload / renderer.

- `types.ts` — pure data models (Workspace, AgentConfig, AgentState, GitStatus, LogLevel, LogSource, ...).
  JSON-serializable only: **no** classes, no functions, no Node/Electron imports.
- `log-helpers.ts` — pure helpers `formatLogArg`/`safeJson`/`formatConsoleArgs` dùng cho system logger (main + renderer). `formatConsoleArgs` interpolates printf-style `%s`/`%d`/`%o`/`%c` console arguments (React/devtools log `console.error('%s', message, stack)`), so renderer log lines carry the real message + stack instead of literal `%s`.
- `ipc.ts` — `Channels` (all channel strings) + `AgentApi` (API interface) + event payload types
  (`AgentStateEvent`, `GitStatusEvent`).
- `image.ts` — image extension list (`IMAGE_EXTENSIONS`) and MIME mapping helper (`imageMimeType`).
- `browser-types.ts` — types specific to the browser bridge (pairing, snapshot).
- `text.ts` — pure text helpers (append stream delta, ...).
- `usage.ts` — pure helpers for computing context/token usage.

## Conventions

- **DO NOT** hardcode channel strings elsewhere; only use `Channels`.
- Changing the contract requires updating 4 places in sync: main handler (`src/main/index.ts`), preload
  (`src/preload/index.ts`), renderer (`window.api`), and test `tests/unit/ipc-contract.test.ts`.
- Adding a new push event: add an `Event*` channel + payload interface + subscribe method in `AgentApi`,
  then implement it in preload and forward it in main.
- `Channels.WorkspaceActivate` (`workspace:activate`) is a lightweight re-activation
  for an already-loaded workspace: repoints `activeProject` + git/file pollers,
  but does NOT re-register agents or re-run workspace preparation.
- `listChatTranscript(agentId, opts?)` returns `{ items, hasMore }` (a `TranscriptWindow`
  tail of `limit`, default 50); pass `beforeId` to page older items.
- Files here are used by the main, preload, renderer builds and tests → do not pull in external dependencies.