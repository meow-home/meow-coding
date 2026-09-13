# Settings Sidebar Active Style Design

## Goal
Update the active state styling of navigation items in the Settings screen sidebar to match the gray background active style used by project and session item rows in the app.

## Proposed Changes

### CSS Styling (`src/renderer/src/styles.css`)
Update `.settings-nav-item.active`:
- **Current**:
  ```css
  .settings-nav-item.active { background: var(--accent); color: #ffffff; border-left-color: var(--accent); }
  ```
- **New**:
  ```css
  .settings-nav-item.active { background: var(--bg-active); color: var(--text-strong); }
  ```

### Visual Outcome
- Hover state remains `.settings-nav-item:hover { background: var(--bg-hover); color: var(--text); }`.
- Active state uses subtle gray background `var(--bg-active)` (`#242428` in dark mode, `#d4d4d4` in light mode) and high contrast text `var(--text-strong)`, replacing the bright blue accent background.

## Verification & Testing Plan
- Run `npm run typecheck` to verify no syntax errors.
- Run `npm test` to ensure test suite passes.
