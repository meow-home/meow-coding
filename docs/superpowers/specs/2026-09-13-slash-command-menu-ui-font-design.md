# Slash Command Menu UI Font Specification

## Summary
Update the slash command suggestion popup font stack to UI sans-serif (`var(--font-ui)`), replacing the current monospace font (`var(--font-mono)`) on `.command-name`.

## Context & Motivation
Currently, when typing `/` or `@` in the chat composer input, the autocomplete suggestion menu (`.command-menu`) renders slash command names (`.command-name`) using `var(--font-mono)`. To provide visual consistency across renderer UI controls and menus, the popup and its command names should use the primary UI font family (`var(--font-ui)`).

## Requirements
1. The `.command-menu` container and command names (`.command-name`) must use `var(--font-ui)`.
2. `.command-name` font weight must be set to `var(--fw-semibold)` to maintain title prominence and readability.
3. Command descriptions (`.command-desc`) and overflow items (`.command-more`) continue using `var(--font-ui)` with appropriate dim/faint styling.
4. No changes to popup layout, positioning, border radius, or color palette.

## Detailed CSS Changes

File: `src/renderer/src/styles.css`

```css
.command-menu {
  /* ... existing properties ... */
  font-family: var(--font-ui);
}

.command-name {
  font-family: var(--font-ui);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  font-size: var(--fs-md);
}
```

## Verification
- Run `npm run typecheck` to ensure build integrity.
- Run `npm test` to confirm test suite health.
