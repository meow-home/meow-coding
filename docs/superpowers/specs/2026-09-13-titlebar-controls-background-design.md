# TitleBar Controls Background Design Spec

Status: approved

## 1. Overview
This spec sets the background color of the window control buttons (minimize, maximize, close) in `.title-bar-controls` and `.title-bar-btn` to match the chat pane background (`var(--bg)`).

## 2. Goals & Non-Goals
### Goals
- Set `background: var(--bg)` on `.title-bar-controls` and `.title-bar-btn` in `src/renderer/src/styles.css`.
- Preserve hover states (`.title-bar-btn:hover` -> `var(--bg-hover)`, `.title-bar-btn-close:hover` -> `#e81123`).

### Non-Goals
- Modifying Electron window control IPC or button event handlers.

## 3. Detailed Component & Styling Design
In `src/renderer/src/styles.css`:
```css
.title-bar-controls {
  display: flex;
  height: 100%;
  background: var(--bg);
  -webkit-app-region: no-drag;
}
.title-bar-btn {
  width: 3.833333rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 0;
  transition: background 120ms ease, color 120ms ease;
}
```

## 4. Verification & Testing
- Typecheck: `npm run typecheck` passes.
- Unit/Integration Tests: `npm test` passes.
