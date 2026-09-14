# Auto-Open First Project and New Session on Startup Design

## Overview
When opening the Meow Coding application, the chat pane area previously remained blank because no workspace path was active (`activePath === null`). This design updates the application startup flow so that if workspaces exist, the first workspace in the list is automatically opened and initialized with a fresh `New session` (`DRAFT_SESSION_ID`), providing an immediate input prompt without a blank screen.

## Goals
1. Prevent a blank chat pane upon launching the application when projects exist.
2. Automatically activate the first workspace in the workspace list on startup.
3. Automatically set the active session of that workspace to a `New session` (`DRAFT_SESSION_ID`).
4. Keep empty state behavior if no workspaces exist yet.

## Non-Goals
- Persistence of active project across app restarts beyond defaulting to the first workspace when unassigned.
- Creating a materialized session in SQLite/store before user sends their first message (remains lazy draft).

## Proposed Changes

### `src/renderer/src/App.tsx`
- Update `refreshWorkspaces` or initial loading effect:
  - After fetching `workspaces`, if `activePath` is `null` and `list.length > 0`:
    - Pick `firstPath = list[0].projectPath`.
    - Initialize `activeSessionByPath` for `firstPath` to `DRAFT_SESSION_ID` if not already set.
    - Call `openWorkspace(firstPath)` to open and display the first project with a fresh draft session.

## User Interface & Experience
- Upon launching the app with existing projects:
  - The first project is selected in the sidebar.
  - The chat pane renders `New session` ready for typing immediately.
- Upon launching the app with zero projects:
  - `EmptyState` remains rendered prompting the user to add a folder.

## Verification & Testing
- Unit tests: verify workspace activation and draft session initialization logic.
- Typecheck: `npm run typecheck`
- Test suite: `npm test`
