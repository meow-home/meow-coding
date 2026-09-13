# Settings Modal Migration to BaseModal Design Spec

## Overview
Refactor `SettingsDialog.tsx` from a full-screen view (`.settings-screen`, `inset: 2.833rem 0 0`) into a centered modal dialog backed by `BaseModal` (`size="xl"` / 55rem width). This makes settings behave consistently with all other modals in the application while retaining the vertical sidebar navigation tab layout.

---

## 1. Component Refactoring: `SettingsDialog.tsx`

### Key Changes
- Wrap `SettingsDialog` in `<BaseModal title="Settings" onClose={onClose} size="xl" className="settings-modal-dialog">`.
- Remove full-screen backdrop and container wrapper (`<section className="settings-screen">`).
- Remove "Back to app" button header since `BaseModal` handles close via top-right ✕ button, Escape key, or backdrop click.
- Retain internal state (`tab`, `draft`, `mcpStatus`, `catalog`, auto-save timer/status) and child tabs (`AgentsTab`, `PermissionsTab`, `McpTab`, etc.).
- Position auto-save pill notification (`Settings saved ✓`, `Saving...`) fixed/floating within the modal bottom region.

---

## 2. Layout & Styles (`src/renderer/src/styles.css`)

### CSS Rule Updates
- Remove full-screen `.settings-screen` rules (`position: fixed; inset: 2.833333rem 0 0; z-index: 100`).
- Update `.settings-modal-dialog`:
  - `width: 55rem` (inherited from `.dialog-xl`).
  - `height: 75vh` / `max-height: 75vh`.
  - `display: flex; flex-direction: column; overflow: hidden;`.
- Adjust `.settings-body` and `.settings-sidebar`:
  - `.settings-body`: `display: flex; flex: 1; min-height: 0; overflow: hidden;`.
  - `.settings-sidebar`: `flex: 0 0 13rem; border-right: 0.0833rem solid var(--hairline); overflow-y: auto;`.
  - `.settings-content`: `flex: 1; min-width: 0; overflow-y: auto; padding: 1rem 1.25rem;`.

---

## 3. Verification & Test Plan

- Unit & integration tests pass (`npm test`).
- Typecheck passes cleanly (`npm run typecheck`).
- Settings dialog opens in centered modal, tab switching works, settings save cleanly, and Escape / close button closes the modal.
