# Modal and Settings Page Background Alignment Design Spec

## Overview
Adjust the background colors of all popup modals (`.dialog`) and the settings page (`.settings-screen`, `.settings-sidebar`, `.settings-screen-back`, `.settings-row`, `.settings-section`, `.settings-save-pill`) to match the dropdown menu background color (`var(--bg-chat)`), rendering pure white (`#ffffff`) in Light Theme and dark (`#0a0a0b`) in Dark Theme.

## Problem Statement
Currently:
- Dropdown menus (`.dropdown-menu`, `.model-menu`, `.command-menu`, `.sidebar-menu-dropdown`, etc.) use `background: var(--bg-chat);`, which renders as pure white (`#ffffff`) in Light Theme.
- Popup modals (`.dialog`, used by `ConfirmDialog`, `BrowserDialog`, `InstallGuideDialog`, `UpdateDialog`, `Modal`, `.subagent-live`, `.git-switch-dialog`, etc.) use `background: var(--bg-raised);` (`#e8e8e8` in Light Theme).
- Settings page containers and rows (`.settings-screen`, `.settings-sidebar`, `.settings-screen-back`, `.settings-row`, `.settings-section`, `.settings-save-pill`) use `background: var(--bg-panel);` (`#f3f3f3` in Light Theme) or `var(--bg-raised);`.

This visual mismatch makes modals and settings page sections look gray rather than matching the crisp white background of dropdown menus.

## Proposed Changes

### CSS Token Application in `src/renderer/src/styles.css`

1. **Popup Modals (`.dialog`)**:
   - Change `.dialog` background from `var(--bg-raised)` to `var(--bg-chat)`.
   - Affected components:
     - `ConfirmDialog`
     - `BrowserDialog`
     - `InstallGuideDialog`
     - `UpdateDialog`
     - Sub-modals (`Modal.tsx`, e.g., edit agent, edit provider, add provider)
     - `GitViewer` branch switcher modal (`.git-switch-dialog`)
     - Subagent live inspection modal (`.subagent-live`)

2. **Settings Page (`.settings-*`)**:
   - `.settings-screen`: Change background from `var(--bg-panel)` to `var(--bg-chat)`.
   - `.settings-sidebar`: Change background from `var(--bg-panel)` to `var(--bg-chat)`.
   - `.settings-screen-back`: Change background from `var(--bg-panel)` to `var(--bg-chat)`.
   - `.settings-row`: Change background from `var(--bg-panel)` to `var(--bg-chat)`.
   - `.settings-section`: Change background from `var(--bg-panel)` to `var(--bg-chat)`.
   - `.settings-save-pill`: Change background from `var(--bg-raised)` to `var(--bg-chat)`.

## Verification & Testing
1. Run `npm run typecheck` to verify no compilation errors.
2. Run `npm test` to ensure unit/integration tests pass.
3. Verify visual alignment across Light theme and Dark theme.
