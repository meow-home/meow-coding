# AGENTS.md — src/renderer/src/components/settings

The Settings dialog: a centered popup modal (size `xl`, `BaseModal` shell) editing the non-provider parts of the `meow.json`-backed `MeowSettings` object.
Reads via `window.api.getSettings()`, saves via `saveSettings(settings)`; changes propagate to the
main process config.

## Key files

| File | Responsibility |
|---|---|
| `SettingsDialog.tsx` | Centered modal popup (size `xl` via `BaseModal` shell): loads settings/MCP status/provider catalog, vertical tab switching, `patch()` draft state, save flow. Debounced auto-save (`saveSettings` can be slow — it reloads agents/MCP), and the normalized save result is only adopted if the draft hasn't changed while the save was in flight so edits made during a save are never clobbered. |
| `ProvidersTab.tsx` | Provider management tab: redesigned with white background cards for connected providers (`Default` & `OS Vaulted` badges, `Sync Models`, `Set Default`, `Edit`, `Disconnect`, collapsible model chips), empty state card, and a multi-step `BaseModal` (Preset provider search grid vs Custom OpenAI-compatible endpoint). |
| `AgentsTab.tsx` | Per-agent config (name, system prompt, provider/model). |
| `PermissionsTab.tsx` | Tool permission rules (allow/ask/deny). |
| `McpTab.tsx` | MCP server configs + connection status: redesigned with server cards (HTTP vs Stdio command), status badges, exposed tools summary chips, empty state card, test connections button, server editing modal, JSON header paste import, and transport mode selection (Auto SSE/HTTP, SSE, Streamable HTTP). |
| `ContextTab.tsx` | Context/compaction settings: redesigned with white background cards, 2-column grid layout, Lucide icons (`Gauge`, `Bell`, `Sliders`), toggle row selectors, and collapsible Advanced compaction tuning section. |
| `CommandsTab.tsx` | Slash-command editor (project-level). "+ Add command" button in header (top), same `agents-head` pattern as AgentsTab. Displays delete button only for custom user commands (`!builtIn` and not `system`). |
| `PersonalizeTab.tsx` | App-wide font size & theme controls: theme-compatible background cards, Lucide icons (`Type`, `Sparkles`, `Palette`, `Moon`, `Sun`), Color Theme selector (Dark vs Light mode), font size preset buttons (10px–20px), and live text preview box. |
| `UpdatesTab.tsx` | Update channel + check/install: redesigned with white background card, Lucide icons (`DownloadCloud`, `CheckCircle2`, `RefreshCw`, `ArrowUpCircle`, `AlertCircle`, `Sparkles`), status badges, progress bar, and version info. |
| `ExternalTab.tsx` | External delegation tab ("Controls & Context" group): enable/disable the loopback API, status line, config file path, CLI path, copy token (clipboard write happens in main, the token is never sent to the renderer), regenerate token (shows a confirmation notice), and install the Claude skill. Uses `window.api.getExternalApiStatus/setExternalApiEnabled/copyExternalApiToken/regenerateExternalApiToken/installClaudeSkill/onExternalApiStatus`. |
| `Modal.tsx` | Inner settings modal wrapper wrapping `BaseModal` with standard Cancel/Save footer actions. |

## Conventions

- `MeowSettings` shape lives in `src/shared/types.ts`; adding a setting touches shared types + `src/main/agent/config.ts` normalize + this dialog.
- Edits go through `patch()` on a draft — nothing writes until Save; `saveSettings` returns the normalized settings.
- UI labels are English.
