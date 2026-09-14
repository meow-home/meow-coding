# Changelog — v0.36.10

## ⚙️ Settings & Auto-Save

- **Settings Auto-Save Optimization**: Fixed debounced auto-save queueing when saves are in-flight, and added instant flush on dialog close (`unmount`) to prevent loss of unsaved changes when closing the Settings popup.
- **Unmounted State Guarding**: Guarded state updates in `SettingsDialog` with `mountedRef` to eliminate React unmounted state warnings.

## 🔌 Integrations & MCP

- **Streamable HTTP Transport**: Added support for Streamable HTTP transport mode in MCP Server management (`auto`, `sse`, `streamable-http`).
- **MCP UI Enhancements**: Added transport selector controls and test connection functionality in `McpTab`.

## 🧹 Maintenance

- Bumped application version to `v0.36.10`.
