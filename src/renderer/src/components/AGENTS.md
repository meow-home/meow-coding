# AGENTS.md — src/renderer/src/components

The React UI layer (renderer process). Everything the user sees: the sessions of the open project
(one chat pane at a time), sidebar, status bar, title bar, and dialogs. All data flows through
`window.api` (preload) — the renderer never touches Node/Electron directly.

## Key files

| File | Responsibility |
|---|---|
| `SessionPanes.tsx` | Layout of one project's sessions: **every** session stays mounted and only the active slot is shown (`hidden` attribute on the wrapper — CSS, never an unmount) so a session that is not selected keeps streaming/answering. The active session is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the session that was showing); SessionPanes reports the first session when the stored id no longer exists. |
| `Pane.tsx` | A single session pane: header + `ChatPanel`; background badge mode. |
| `PaneHeader.tsx` | Pane title bar: status dot, git info, menu (inject/log/stop/restart/background/delete — the first four only on the parked PTY path); shows a confirm dialog before deleting a session. |
| `ConfirmDialog.tsx` | Reusable confirmation dialog (title, message, confirm/cancel, danger styling). Rendered through a React portal into `document.body` so its `position: fixed` backdrop always covers the whole window, regardless of any transformed ancestor. |
| `Sidebar.tsx` | Left sidebar: project list with an expand/collapse chevron per row. An expanded project lists its sessions — status dot (green running / yellow waiting / gray idle), active row highlighted, and a per-row `...` menu (Rename via inline input, Stop when running, Delete). The row `+` creates a native session and activates it; deleting a project's last session immediately creates a fresh one. Expanded state persists in `localStorage` (`meow.sidebar.expanded`). Shows a red badge (count) per project whose sessions are waiting on a permission/question prompt (`needsInput` prop). |
| `StatusBar.tsx` | Bottom bar: workspace name, git branch, running count, app version (via IPC). |
| `TitleBar.tsx` | Custom window chrome (min/max/close) for frameless platforms; when sidebar is collapsed, hovering the brand section reveals a floating sidebar popover dropdown menu. |
| `PopupTitleBar.tsx` | Popup window chrome for the FileViewer/GitViewer BrowserWindows: drag region + (Linux) custom min/max/close, mirroring the main TitleBar so popups match the app theme. |
| `EmptyState.tsx` | Shown when no pane is open (workspace vs. no-workspace hint). |
| `BackgroundPanel.tsx` | Lists background agents; open/stop/delete them (delete shows a confirm dialog). |
| `UpdateDialog.tsx` | Auto-update status + install prompt. |
| `BrowserDialog.tsx` | Chrome bridge pairing + status UI. |
| `InstallGuideDialog.tsx` | Extension install steps for the browser bridge. |
| `chat/` | The native-agent chat UI — see its own AGENTS.md. |
| `settings/` | Settings dialog + tabs — see its own AGENTS.md. |

## Conventions

- **Never** import from `electron` or `node:*` here; use `window.api` (typed `AgentApi`).
- `App.tsx` (parent) owns the mounted runtimes and the active session per project; components stay
  presentational-ish.
- A session that is not showing must stay mounted (see `SessionPanes`) — never conditionally render,
  key or unmount it, or its run stops.
- UI labels and system-style notices from main (with `[meow]` prefix) are English.
