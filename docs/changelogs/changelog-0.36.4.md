# Changelog — Meow Coding v0.36.2 → v0.36.4

## 🚀 New Features & Enhancements

- **Lazy Session Initialization**: Deferred native agent backend creation until the first message, reducing initial load overhead when switching or opening sessions.
- **Direct Folder Picker**: Simplified project onboarding by opening the OS native folder picker directly upon clicking "Add Folder" or "Add Project".
- **Slash Command Normalization**: Removed the legacy `sp-` prefix from built-in system slash commands for cleaner and shorter command names.
- **Collapsed Sidebar Popover**: Added hover popover menu on title bar brand section when sidebar is collapsed, allowing quick access to project sessions.
- **Sidebar Header Redesign**: Updated sidebar header layout to a clean 2-row vertical menu structure.

## 🎨 UI & Aesthetics

- **Sidebar Dividers & Title Bar Surfaces**: Restored hairline right dividers for sidebar and brand title bar; adjusted collapsed title bar brand background to match the chat pane surface (`var(--bg)`).
- **Slash Command Menu Font**: Standardized slash command suggestion popup font stack to `var(--font-ui)`.
- **Window Control Surface Sync**: Synchronized window control button overlays with main chat pane surface color.

## 🐛 Bug Fixes

- **Slash Command Image Attachments**: Fixed image attachments getting dropped when messages start with slash commands (`/command`).
- **Sidebar Z-Index Hierarchy**: Resolved dropdown stacking issues by raising z-index on sidebar dropdown menus.

## 📱 Mobile Remote Control — Coming Soon

- Remote control interface via WebSocket relay, session pairing code, and real-time event sync.
- Stay tuned — mobile remote integration is coming soon! 🚧

## 🧹 Internal & Docs

- Added comprehensive design specs and implementation plans for Files overlay, title bar layout, and slash command UI.
- Updated renderer AGENTS.md and UI guide reference documentation.
- Bumped version to 0.36.4.
