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
| `McpTab.tsx` | MCP server configs + connection status: redesigned with server cards (HTTP vs Stdio command), status badges, exposed tools summary chips, empty state card, test connections button, and `BaseModal` server addition form. |
| `ContextTab.tsx` | Context/compaction settings: redesigned with white background cards, 2-column grid layout, Lucide icons (`Gauge`, `Bell`, `Sliders`), toggle row selectors, and collapsible Advanced compaction tuning section. |
| `CommandsTab.tsx` | Slash-command editor (project-level). "+ Add command" button in header (top), same `agents-head` pattern as AgentsTab. |
| `PersonalizeTab.tsx` | App-wide font size control (px, default 14, range 8-40): sets `meow.fontSize` in localStorage, applied via `applyFontSize()`. |
| `UpdatesTab.tsx` | Update channel + check/install. |
| `Modal.tsx` | Inner settings modal wrapper wrapping `BaseModal` with standard Cancel/Save footer actions. |

## Conventions

- `MeowSettings` shape lives in `src/shared/types.ts`; adding a setting touches shared types + `src/main/agent/config.ts` normalize + this dialog.
- Edits go through `patch()` on a draft — nothing writes until Save; `saveSettings` returns the normalized settings.
- UI labels are English.
