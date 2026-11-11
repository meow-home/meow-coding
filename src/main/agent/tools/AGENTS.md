# AGENTS.md — src/main/agent/tools

The tool registry for the native Meow agent. Each file exports a `ToolDefinition`
(`name`, `description`, `schema` (zod), `run`) — see `types.ts`. Tools are executed by
`SessionRunner` (`../loop.ts`) and permission-gated via `decidePermission` (`../permission.ts`).

## Key files

| File | Responsibility |
|---|---|
| `types.ts` | `ToolDefinition` interface + `ToolSchema` type — the contract every tool implements. `concurrencySafe?: boolean` marks read-only tools that may run in parallel (default: runs alone). |
| `registry.ts` | `createDefaultTools()` — the default tool map handed to `MeowAgentManager`. |
| `bash.ts` | Runs shell commands (`bashTool`, `bashOutputTool`, `killShellTool`). Windows: wraps via git-bash fallback; kills process tree on timeout/abort; supports `run_in_background` to spawn long-lived processes managed via `BackgroundProcessStore`. `bash_output` blocks up to `wait_s` (default 15, max 300) via `BackgroundProcessStore.waitForNew`, returning early on new/matching output, exit, or abort. |
| `monitor.ts` | `monitorTool` — async watch over a background shell or polled command; returns immediately (`background: true`) by default, or with `wait: true` awaits up to 60 seconds and returns an immediate/buffered resolution through the tool result without a duplicate feed notification. With only `id` and no `until_*` condition it waits on an already-registered monitor (`MonitorStore.has`), which is how a `delegate_session` id is watched. |
| `edit.ts` | Line-based file edit (old_string/new_string) with safety checks. |
| `write.ts` | Write/overwrite a file. |
| `read.ts` | Read a file (size-capped). |
| `apply-patch.ts` | Apply unified diff via `../apply-patch.ts`. |
| `glob.ts` | Glob file listing. |
| `grep.ts` | Text search with regex. |
| `git.ts` | Git operations (status/diff/commit...). |
| `question.ts` | Ask the user a question (blocks on `prompt-request`). Normalizes malformed `options` (e.g. a string instead of an array) to a valid array or drops it so the renderer never receives a non-array to `.map` over. Sanitizes the model-authored action labels (`submitLabel` / `skipLabel` / `customLabel`; trim, collapse whitespace, 24-char cap, defaults `Submit` / `Skip` / `Type your own answer`) before they reach the renderer. Returns the answer in `metadata.answer` so the loop can echo it into the transcript as a user message. |
| `todowrite.ts` | Persist a todo list for the session (`todo-updated` events). Sanitizes a malformed `todos` input (e.g. the model emitting a JSON-encoded string instead of an array) to an empty array so a bad value never persists and crashes the renderer's Todo List on load. Resets the stored list to `[]` once every item is `completed`/`cancelled` (the finished list has served its purpose), telling the model the list was cleared in the tool output. While items remain open, the output restates the per-item rule (complete the `in_progress` item before the next) and flags two or more items newly completed in one call (compared against `ctx.getTodos()`). The description forbids items that only wait on the user. |
| `task.ts` | Spawn a subagent (`createTaskTool`). Runs under a permission context derived from the parent (narrow-only), bubbles `ask` decisions to the parent UI, denies them when running in background (a background subagent's `ctx.ask` returns `null` instead of parking a pending prompt), snapshots its edits under the parent's agent id, and reports `state="incomplete"` when it runs out of steps. Fires `SubagentStop` hooks when a subagent finishes; a block resumes it (bounded by `MAX_SUBAGENT_STOP_BLOCKS = 3`). |
| `delegate-session.ts` | `createDelegateSessionTool` — `delegate_session({ task, title?, model? })`. Creates a new persistent sub-session in the same project for a focused task (vs the isolated ephemeral `task` subagent); no target session is named. Requires a user-origin run context; calls the injected `createDelegation` adapter, returns `metadata: { delegationId }` so cards never parse prose. The sub-session is monitored from creation under the delegation id, and its result is read with `delegate_result`. `model` is a free-form request resolved by the manager (the source's model when omitted); an ambiguous/unknown value fails with the available model refs. |
| `delegate-result.ts` | `createDelegateResultTool` — `delegate_result({ id })`. Reads the stored delegation record (status, result/error, `resultTruncated`, touched files) and returns the body as tool output, so a sub-session's text reaches the model as data instead of a user turn. Refuses a record owned by another session; a nonterminal record reports its status. Registered only when `deps.delegation.get` exists. |
| `delegate-cli.ts` | `createDelegateCliTool` — `delegate_cli({ task })`. Delegates a focused task to the Antigravity CLI (`agy`). Requires a user-origin run context, refuses when the injected `checkCli` reports the CLI is not ready, returns `metadata: { delegationId, cliAgentId }`. |
| `revert.ts` | Revert files via snapshot store. |
| `skill.ts` | Load a skill into context. |
| `websearch.ts` / `webfetch.ts` | Web search / page fetch (need API keys). |
| `browser.ts` | `browser_*` tools over a `BrowserRouterLike`: owner is `snapshotAgentId ?? agentId` (no owner → `browser: no session context`), `browser_start` can switch the session between `builtin` (default) and `chrome`; `browser_console`/`browser_network` accept an optional `tabId`; `browser_handoff` hands the tab to the user (built-in only). |
| `office.ts` | Create/read/edit Office documents via the officecli CLI. |
| `lsp.ts` | LSP diagnostics for a file (via `../lsp/`). |
| `snapshot-util.ts` | Snapshot helpers for tools. |

## Conventions

- Each tool is a plain object matching `ToolDefinition`; `schema` is a zod type with a `.parse()`.
- Never spawn/kill processes directly from the renderer — only tools in this folder (main process) may do so.
- `bash` on Windows: prefer Git Bash (`gitBashPath`/`buildShellCommand`), fall back to `cmd.exe` — do not break that logic.
- Add new tools to `registry.ts` and to `DEFAULT_MEOW_CONFIG.permission` in `../config.ts`.
- Subagents never receive `todowrite`: their runner has no `setTodos` sink.
- A subagent may only be given tools that already exist in the map passed to `createTaskTool`; `task` is not in that map, so subagents cannot nest.
- `delegate_session` and `delegate_cli` are registered per-runner by `MeowAgentManager`, not in `registry.ts`, so subagents and unrelated runners never receive them.
- Mark a new tool `concurrencySafe: true` only if it never writes files, spawns a foreground process, or prompts the user; everything else runs alone, in model order. `task` is the deliberate exception: subagents are meant to run in parallel.
