# AGENTS.md — src/renderer/src/components

The React UI layer (renderer process). Everything the user sees: the sessions of the open project
(one chat pane at a time), sidebar, status bar, title bar, and dialogs. All data flows through
`window.api` (preload) — the renderer never touches Node/Electron directly.

## Key files

| File | Responsibility |
|---|---|
| `SessionPanes.tsx` | Layout of one project's sessions: **every** session stays mounted and only the active slot is shown (`hidden` attribute on the wrapper — CSS, never an unmount) so a session that is not selected keeps streaming/answering. The active session is **controlled** by `App` (`activeId` + `onActiveChange`, remembered per project path so switching workspaces restores the session that was showing); SessionPanes reports the first session when the stored id no longer exists. |
| `Pane.tsx` | A single session pane: header + `ChatPanel`; background badge mode. |
| `PaneHeader.tsx` | Pane title bar: status dot, git info, menu (inject/log/stop/restart/Files/Processes/Open Folder/Open in VS Code/delete — the first four only on the parked PTY path; Files opens the Files overlay, Processes opens the Processes overlay); shows a confirm dialog before deleting a session. Renders the todo pill (`TodoPill`) inline in `.pane-actions`, immediately left of the action (⋮) button, when a todo list is present. |
| `processes/ProcessesOverlay.tsx` | Per-agent **Processes** overlay (pane `⋮` → Processes), the sibling of the Files overlay: lists the agent's background shells and monitors on the left (Kill button on running shells), streams the selected shell's output live on the right (store buffer + `data`/`exit` events via `onBackgroundProcData`/`onBackgroundProcExit`, never consuming the agent's `bash_output` read offset). Pools `backgroundProcsList`/`monitorsList` every ~1.5s; subscribes/unsubscribes per selected shell. Reuses `.files-overlay` layout; exports `PROCESSES_MIN_WIDTH`/`MAX`/`DEFAULT` (320/900/420). |
| `ConfirmDialog.tsx` | Reusable confirmation dialog (title, message, confirm/cancel, danger styling), built on `BaseModal`. |
| `common/BaseModal.tsx` | Reusable modal dialog overlay portaled to `document.body` with backdrop click, Escape key handling, accessibility roles, and size modifiers (`sm`, `md`, `lg`, `xl`). Used for app-wide dialogs and popups. |
| `common/BaseDropdown.tsx` | Reusable popover dropdown overlay portaled to `document.body` with smart positioning (auto-flip vertical orientation, auto-clamp horizontal boundaries, and auto max-height overflow scrolling). Used by action menus, pickers, and context dropdowns app-wide. |
| `common/BaseSelect.tsx` | Dedicated option selection control wrapper wrapping `BaseDropdown` with combobox/listbox ARIA semantics for option pickers. |
| `Sidebar.tsx` | Left sidebar: header action bar with a 2-row vertical menu ("New session" with `Plus` icon and "Add folder" with `FolderPlus` icon, no border radius or bottom border), and project list with an expand/collapse chevron per row. An expanded project lists its sessions — status dot (green running / yellow waiting / gray idle), active row highlighted, and a per-row `...` menu (Rename via inline input, Stop when running, Delete). The row `+` activates a draft session (lazy creation, materialized on first prompt); deleting a project's last session transitions the workspace to a draft session pane. Expanded state persists in `localStorage` (`meow.sidebar.expanded`). Shows a red badge (count) per project whose sessions are waiting on a permission/question prompt (`needsInput` prop). |
| `StatusBar.tsx` | Bottom status bar: redesigned with Lucide icons (`Folder`, `FolderSymlink`, `Code`, `GitBranch`, `Bot`, `Globe`, `Tag`), active indicator dot, quick "Folder" & "VS Code" action buttons, dirty count badge, interactive Git & Browser Bridge status pills, and app version display. |
| `TitleBar.tsx` | Custom window chrome (min/max/close) for frameless platforms; when sidebar is collapsed, hovering the brand section reveals a floating sidebar popover dropdown menu. |
| `PopupTitleBar.tsx` | Popup window chrome for the FileViewer/GitViewer BrowserWindows: drag region + (Linux) custom min/max/close, mirroring the main TitleBar so popups match the app theme. |
| `EmptyState.tsx` | Shown when no pane is open (workspace vs. no-workspace hint). |
| `BackgroundPanel.tsx` | Lists background agents; open/stop/delete them (delete shows a confirm dialog). |
| `UpdateDialog.tsx` | Auto-update status + install prompt. |
| `BrowserDialog.tsx` | Chrome bridge pairing + status UI: redesigned with white background cards, Lucide icons, status pill indicators, 6-digit passcode display box with copy button, and quick setup navigation. |
| `InstallGuideDialog.tsx` | Extension install steps for browser bridge: redesigned with numbered step cards (1-4), Lucide icons, copyable unpacked extension directory path box, and local security notice banner. |
| `files/FilesOverlay.tsx` | In-app Files explorer (pane `⋮` → Files), docked on the right of the pane area by default (drag its left edge to resize, 320–900px, default 420px) or expanded over the whole pane area via maximize/restore: filter + tree on the left, open-file tabs on the right, header menu (Refresh, Collapse all, Close all tabs, Copy path, Reveal in Folder, Open in VS Code), close; `Esc` and project switch close it. |
| `files/FilesTree.tsx` | Lazy tree of the overlay — lists dotfiles and `node_modules`, name filter, `?`-prefixed content search (`path:line` hits), background refresh on context changes. |
| `file-content/FileContentView.tsx` | Toolbar + body of a file (CodeMirror syntax-highlighted editor with line numbers and live auto-indent, rendered markdown preview toggle for `.md`, Save button with `● Unsaved` state, `Ctrl+S`/`Cmd+S` keyboard shortcut, Copy, Open in VS Code), shared by the popup `FileViewer` window and the overlay tab. |
| `git/` | Redesigned Git viewer popup window with resizable sidebars: Changes tab (staged/unstaged file list, file search filter, status badges, diff view toggle), History tab (commit list with search filter, author avatars, compare mode, commit detail card, diff view), Blame tab (workspace file tree, line blame annotations), and branch switcher dropdown with search filter and branch creation. |
| `chat/` | The native-agent chat UI — see its own AGENTS.md. |
| `settings/` | Settings dialog + tabs — see its own AGENTS.md. |

## Conventions

- **Never** import from `electron` or `node:*` here; use `window.api` (typed `AgentApi`).
- **Use Common Components:** UI popups, dropdown menus, context menus, and option selectors MUST use common components (`src/renderer/src/components/common/BaseDropdown.tsx`, `BaseSelect.tsx`) rather than creating custom overlay positioning or popover logic.
- `App.tsx` (parent) owns the mounted runtimes and the active session per project; components stay
  presentational-ish.
- A session that is not showing must stay mounted (see `SessionPanes`) — never conditionally render,
  key or unmount it, or its run stops.
- UI labels and system-style notices from main (with `[meow]` prefix) are English.
