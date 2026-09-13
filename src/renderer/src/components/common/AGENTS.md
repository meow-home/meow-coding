# AGENTS.md — src/renderer/src/components/common

Shared, reusable UI primitives used across the renderer process.

## Conventions & Global Rules

- **Use Common Components:** Any new or refactored UI popover, modal dialog, dropdown menu, or value picker MUST use these common components (`BaseDropdown`, `BaseSelect`, `BaseModal`) instead of creating custom overlay or positioning logic.
- All popover and modal overlays must be portaled to `document.body` to prevent clipping or layout scrolling issues.

## Key files

| File | Responsibility |
|---|---|
| `BaseModal.tsx` | Reusable modal dialog overlay portaled to `document.body` with backdrop click, Escape key handling, accessibility roles, and size modifiers (`sm`, `md`, `lg`, `xl`). Supports compound sub-components (`BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`) with border dividers and optional `noPadding` for full-bleed content, as well as automatic fallback wrapping for legacy props (`title`, `actions`, `children`). Used for app-wide dialogs and popups. |
| `BaseDropdown.tsx` | Reusable popover dropdown overlay portaled to `document.body` with smart positioning (auto-flip vertical orientation, auto-clamp horizontal boundaries, and auto max-height overflow scrolling). Supports `containerClassName` and `containerStyle` props for layout integration inside flex/grid containers. Used by action menus and context dropdowns app-wide. |
| `BaseSelect.tsx` | Reusable option selection control wrapper wrapping `BaseDropdown` with `role="combobox"` and `role="listbox"` ARIA semantics for option pickers (e.g., `ModePicker`, `VariantPicker`). Supports `className` for container styling and defaults to bottom placement. |
