# Direct Native OS Folder Picker for Add Project / Add Folder Design

## Context & Motivation
Currently, clicking "Add Project" in the Sidebar or "Add Folder" in the Composer `+` menu opens a React modal dialog (`AddProjectDialog.tsx`). In this dialog, the user must click "Browse" to open the OS folder picker, then click "Add" to confirm.
To streamline user experience, clicking "Add Project" or "Add Folder" will directly trigger the OS native folder picker dialog, auto-deriving the project name from the selected directory name and adding it as a workspace immediately.

## Goal
Replace the intermediate `AddProjectDialog` modal with direct native OS directory selection for "Add Project" and "Add Folder" actions.

## User Flow
1. User clicks "Add Project" (Sidebar header) or "Add Folder" (Composer `AddMenu`).
2. Native OS folder selection dialog opens immediately (`window.api.pickFolder()`).
3. If user selects a directory:
   - Extract project name from the folder path: `folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath`.
   - Call `window.api.addWorkspace(folderPath, name)`.
   - Refresh workspace list and open/activate the newly added project workspace.
4. If user cancels the folder selection dialog:
   - Do nothing (no error shown).

## Component & Documentation Changes
- `src/renderer/src/components/Sidebar.tsx`:
  - Update "Add Project" button `onClick` to call an inline async handler that triggers `pickFolder()` -> `addWorkspace()` -> `onOpen()`.
  - Remove `showAddProject` state and `<AddProjectDialog />` component call.
- `src/renderer/src/App.tsx`:
  - Update `appActions.addFolder` implementation to directly trigger `pickFolder()` -> `addWorkspace()` -> `refreshWorkspaces()` -> `openWorkspace()`.
  - Remove `showAddProject` state and `<AddProjectDialog />` component call.
- `src/renderer/src/components/AddProjectDialog.tsx`:
  - Delete file as it is rendered redundant.
- `src/renderer/AGENTS.md` and `src/renderer/src/components/AGENTS.md`:
  - Update component list and documentation to remove `AddProjectDialog.tsx`.
