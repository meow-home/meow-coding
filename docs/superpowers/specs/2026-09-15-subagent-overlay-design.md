# Design Spec: Subagent Overlay Pane

**Date:** 2026-09-15  
**Status:** Approved  
**Topic:** Subagent Detail Docked Overlay Pane  

## Overview
Replace the centered popup modal (`BaseModal`) for viewing live/completed sub-agent task details with a docked overlay pane (`SubagentOverlay`) positioned side-by-side with the chat view, matching the layout, UX, and resizing behaviors of `FilesOverlay` and `ProcessesOverlay`.

## Requirements & Behavior

### 1. Panel Layout & Resizing
- **Docked Mode:** Rendered to the right of the active chat panel inside `ChatPanel`.
- **Resizable Width:** Includes a resizer border on the left edge with mouse-drag resizing between `320px` (min width) and `900px` (max width). Default width is `420px`, persisted to `localStorage` under `meow.subagent.width`.
- **Full Mode (Maximize):** Supports toggling full mode (`full`), expanding over the chat pane while maintaining title bar and outer window chrome.
- **Escape Key & Close:** Can be closed via the close (`X`) button in the header or pressing `Escape`.

### 2. Header Elements
- Icon (Bot / Subagent symbol) + Subagent label: `sub-agent (${subagentType})`.
- Background status badge: Shows `background` pill if running in background mode.
- Status indicator: `running` (blue/animated), `completed` (green), or `error` (red).
- Controls: Maximize/Restore button (`Maximize2` / `Minimize2`) and Close button (`X`).

### 3. Body Content
- **Tools List:** List of tools used by the subagent rendered as code pills.
- **Live Output Text:** Monospace/pre-wrap stream box displaying the subagent prompt/logs/thinking text. Auto-scrolls to bottom while `running`.
- **Result Block:** Displayed at the bottom when `result` is present (completed/error output).

### 4. Integration
- Replaces `<BaseModal>` in `src/renderer/src/components/chat/ChatPanel.tsx`.
- Create new component `src/renderer/src/components/chat/SubagentOverlay.tsx`.
- Update `src/renderer/src/styles.css` with matching `.subagent-overlay` styles based on `.files-overlay`.

## Self-Review Verification
- **Placeholders:** None.
- **Contradictions:** None.
- **Scope:** Narrowed strictly to replacing subagent live modal with docked overlay pane.
