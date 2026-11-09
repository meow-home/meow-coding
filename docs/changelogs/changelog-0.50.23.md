# Changelog — Meow Coding v0.50.22 → v0.50.23

## 🚀 New Features

### Built-in browser panel
- The built-in browser is the default backend: a right-side panel (docked or expanded) with tabs, a toolbar, a console/network drawer and a live viewport, next to the Chrome extension backend.
- The agent can drive the page: per-site approval for click, type and select, a shield overlay with the agent cursor and target ring, and `browser_handoff` for signing in or paying.
- Loopback URLs in terminal output open in the panel, `Alt+Left/Right` walk the history, and app shortcuts keep working while a page has focus.
- Settings gained the backend choice, the built-in status pill and clearing browsing data.

### Files panel
- In-app explorer docked beside the chat: lazy tree with name filter and `?` content search, open files as preview or pinned tabs, a per-file bar, and file-type icons with git state.
- `Ctrl/Cmd+S` saves; an unsaved tab shows a dot and closing it (or the panel) asks before discarding. The editor gutter sends a selected line to the chat.

### Title bar and session chrome
- The active session's status dot, name and `⋮` menu moved into the window title bar; the pane header row is gone, so the chat starts at the top.
- The title bar shares the chat surface and closes with a hairline; collapsing the sidebar shrinks the brand strip so the title sits next to the expand button.
- Panel toggles live in the title bar, every right-side panel keeps its tabs in its header, and dragging the column stops before the chat is squeezed below its minimum width.

### Sidebar, theme and menus
- Projects and sessions are separated: a project row is a group header with `+` (new session) and `…` (project menu), its sessions are indented rows with a status dot, and the new session picks its project from the composer footer.
- Right-side panels are one flush, square surface with a single column splitter.
- Dark theme retuned to a neutral charcoal palette; dialogs lost their header/footer rules and got tighter chrome; floating menus have no outline and paint a dedicated `--bg-menu` surface in both themes.
- The app logo is a new flat cat-terminal mark.

## 🐛 Bug Fixes
- UI: the new-session project picker is a proper menu again — it was missing the shared menu surface, so the list rendered transparent over the composer.
- UI: a long session name no longer pushes the session menu under the right-side panel.
- Browser: the native view hides behind overlays and menus, re-freezes while hidden, and restores visibility on placement and tab switches; closing the panel unmounts it.
- Browser: popups keep the working tab, crash recovery and frame policy are handled, and the viewport is measured after position-only moves.
- Browser: a loopback URL cut by a terminal line wrap is no longer linked; `Ctrl+Left/Right` stays with the page.
- Browser: sensitive fields refuse typing and offer the handoff instead; snapshots are marked as untrusted web content and stuck commands time out.
- Files: the file bar spans the panel and the tree stays mounted across tab switches.

## 🧹 Internal & Docs
- New built-in browser stack: Electron tab host, CDP commands, an Electron-free `BrowserTab`, a per-session backend router and shared AX snapshot code.
- Reference docs, specs and plans updated for the browser panel, the files panel and the UI changes; new test suites cover the right panels, the browser panel, the session title and menu surfaces.
