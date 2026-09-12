# AGENTS.md — tests/e2e

Playwright end-to-end smoke tests that launch the real Electron app (`_electron.launch({ args: ['.'] })`)
with a temp `MEOW_USER_DATA`. Run after `npm run build` via `npm run e2e`; single file:
`npx playwright test tests/e2e/<file>.spec.ts`.

## Key files

| File | Responsibility |
|---|---|
| `smoke.spec.ts` | App launches, sidebar/status-bar (incl. version), native chat panel sends a message, mode selector toggles build/plan, settings connects a provider + syncs models (its rem-derived paddings are asserted as a ratio against the live root font-size, since the base font is user-configurable). |
| `prompt.spec.ts` | Permission prompt: click allow, keyboard `1`, prompt is rendered inside the chat input card, prompt does not overlay the chat feed. |
| `context-footer.spec.ts` | Context footer shows real token usage, persists across reload, resets on new session; danger state past auto-compact threshold; the readout's geometry (24 × 24 box, 3px radius, `--bg-hover` when hovered) and its popover (offsetWidth ≥ 216 against the old 200px floor, one line box per row, `white-space: nowrap`). Every readout lookup goes through the file's `pane(window)` helper (`.pane-slot:not([hidden])`), because `SessionPanes` keeps the other sessions mounted — a bare `.context-footer-wrap` matches the kept-alive session too and trips strict mode. |
| `chat-scrollbar.spec.ts` | Chat feed scroll: opening a session lands the feed at the bottom of its window (`waitForHeightSettle` first, so the app's ~60-frame pin loop can't make a mid-settle read look correct), paging the whole transcript in via the top edge then reporting a real scrollHeight (no content-visibility collapse), and the new-turn anchor at the 20px inset holding under manual scroll and reduced motion (`anchorTop` measures from inside the feed, since the optimistic row is replaced once the transcript reloads). |
| `sidebar-sessions.spec.ts` | Sidebar session rows: create via the project row `+`, switching does not stop a running session (exactly one pane visible), status dot idle/running/waiting, delete via the row menu; also sidebar icon-button geometry (24 × 24, 3px radius). |
| `selectors.spec.ts` | Selector triggers and rows: the shared `.dropdown-caret` and its `aria-expanded`-driven rotation (0° closed, 180° open); a selected row is `--bg-active` with `border-left-width: 0` and a right-aligned `.menu-item-check` (10px from the row edge, 16px wide, reserved on unselected rows). Also covers `GitBranchSwitcher` in its popup window, which needs a real git repo seeded. VariantPicker and the ModelPicker's rows are unreachable with a bare `userData` (see the note in the file). |
| `menus.spec.ts` | Dropdown menu visual language: shared metric set (32px rows, 10px container radius, `gap: 0`) across a sidebar menu and a picker; action menus carry 16px icons, `.menu-sep` dividers and the project path header; pickers are asserted leading-icon-free (row starts with `.menu-item-label`, never an icon) and separator-free. |

## Conventions

- Each test uses an isolated temp userData + temp project; writes `workspaces.json` directly.
- **Requires `npm run build` first** — e2e launches the built app in `out/`.
- Use locator auto-wait (e.g. `toHaveText`/`toContainText`) for async UI (IPC round-trips, streaming).
- After touching IPC/UI, add/extend a smoke assertion so regressions are caught here.
