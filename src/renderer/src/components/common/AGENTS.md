# AGENTS.md — src/renderer/src/components/common

Shared, reusable UI primitives used across the renderer process.

## Conventions & Global Rules

- **Use Common Components:** Any new or refactored UI popover, modal dialog, dropdown menu, or value picker MUST use these common components (`BaseDropdown`, `BaseSelect`, `BaseModal`) instead of creating custom overlay or positioning logic.
- All popover and modal overlays must be portaled to `document.body` to prevent clipping or layout scrolling issues.
- **Native browser panel occlusion:** the built-in browser is a `WebContentsView` that paints above all HTML. `BaseModal` and `BaseDropdown` (while `open`) call `useBrowserOcclusion`; `BaseDropdown` only counts once its measured menu rect intersects the `.browser-viewport` placeholder (`overlapsBrowserViewport`), and `BaseModal` always counts. Any new fixed overlay that can cover the panel must call the same hook (or `beginOcclusion`/`endOcclusion` for pointer drags) — never call `browserPanelFreeze`/`Unfreeze` directly. Main owns the hidden state across tab switches (only `attach`/`detach`/`unfreeze` clear it), so the renderer never re-freezes on tab changes. Reasons are independent and order does not matter; the module does nothing when no panel is attached.

## Key files

| File | Responsibility |
|---|---|
| `BaseModal.tsx` | Reusable modal dialog overlay portaled to `document.body` with backdrop click, Escape key handling, accessibility roles, and size modifiers (`sm`, `md`, `lg`, `xl`). Supports compound sub-components (`BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`) with border dividers and optional `noPadding` for full-bleed content, as well as automatic fallback wrapping for legacy props (`title`, `actions`, `children`). Used for app-wide dialogs and popups. |
| `BaseDropdown.tsx` | Reusable popover dropdown overlay portaled to `document.body` with smart positioning (auto-flip vertical orientation, auto-clamp horizontal boundaries, and auto max-height overflow scrolling). Supports `containerClassName` and `containerStyle` props for layout integration inside flex/grid containers. Used by action menus and context dropdowns app-wide. |
| `useBrowserOcclusion.ts` | Occlusion controller for the native browser panel: module-level reason set (`overlay` needs a frozen image, `cover` hides without a capture), 0→1 freeze / 1→0 unfreeze, generation-guarded stale results, image-first hide, and the React hook + `overlapsBrowserViewport` helper. |
| `PanelHeader.tsx` | The one header of every right-side panel (Browser, Terminal, Files, Processes, Sub-agents): tabs instead of a title, an optional `+`, panel-specific actions, expand and close. A tab can replace its X (Processes uses a Kill square). |
| `BaseSelect.tsx` | Reusable option selection control wrapper wrapping `BaseDropdown` with `role="combobox"` and `role="listbox"` ARIA semantics for option pickers (e.g., `ModePicker`, `VariantPicker`). Supports `className` for container styling and defaults to bottom placement. |
