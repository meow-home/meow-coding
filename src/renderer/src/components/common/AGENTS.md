# AGENTS.md — src/renderer/src/components/common

Shared, reusable UI primitives used across the renderer process.

## Conventions & Global Rules

- **Use Common Components:** Any new or refactored UI popover, dropdown menu, or value picker MUST use these common components (`BaseDropdown`, `BaseSelect`) instead of creating custom overlay or positioning logic.
- All popover overlays must be portaled to `document.body` and positioned via `computeDropdownPosition` to prevent clipping or layout scrolling issues.

## Key files

| File | Responsibility |
|---|---|
| `BaseDropdown.tsx` | Reusable popover dropdown overlay portaled to `document.body` with smart positioning (auto-flip vertical orientation, auto-clamp horizontal boundaries, and auto max-height overflow scrolling). Used by action menus and context dropdowns app-wide. |
| `BaseSelect.tsx` | Reusable option selection control wrapper wrapping `BaseDropdown` with `role="combobox"` and `role="listbox"` ARIA semantics for option pickers (e.g., `ModePicker`, `VariantPicker`). |
