# Status Bar Font Alignment Design Spec

**Date:** 2026-09-13  
**Status:** Approved  
**Topic:** Align Status Bar font stack with Sidebar font stack

## 1. Goal

Change the typography of all items in the bottom status bar (`StatusBar.tsx`) from the monospace font stack (`var(--font-mono)`) to the main UI font stack (`var(--font-ui)`), matching the typography used throughout the sidebar and primary interface elements.

## 2. Requirements

- All text elements in the status bar (workspace name, git branch info, running session count, browser bridge status, version string) must use `var(--font-ui)`.
- Numeric content in the status bar (such as session counts and git dirty file count) must use tabular numbers (`font-variant-numeric: tabular-nums`) to prevent horizontal layout shifts when numbers change.
- Hover states and visual styling (colors, borders, gaps) of status bar buttons (`.sb-git`, `.sb-browser`) remain unchanged.

## 3. Implementation Details

- In `src/renderer/src/styles.css`:
  Update `.status-bar .sb-mono` (or `.status-bar .sb-item`) font rules:
  ```css
  .status-bar .sb-mono {
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
    color: #ffffff;
  }
  ```

## 4. Verification

- Run `npm run typecheck` to verify TypeScript types.
- Run `npm test` to run unit and integration tests.
