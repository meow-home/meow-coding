# Design Spec: Project Drag and Drop Reorder

Status: pending review

## Context & Goal
In Meow Coding, projects (workspaces) are listed in the sidebar. Currently, the order of projects is determined solely by the order they were added to `userData/workspaces.json`. The user requested the ability to drag and drop project items in the sidebar (in both expanded `project-list` view and collapsed `project-rail` view) to reorder projects manually. Newly added projects must continue to default to the bottom of the list.

## Approved Approach
Implement native HTML5 drag and drop on project items in `Sidebar.tsx`, and persist the reordered project list to `userData/workspaces.json` via a new `WorkspaceReorder` IPC channel and backend `WorkspaceStore.reorder` method.

### Backend Changes (`src/main/workspace-store.ts` & `src/main/index.ts`)
1. **`WorkspaceStore.reorder(projectPaths: string[]): WorkspaceSummary[]`**:
   - Accepts an array of project paths representing the new ordered list.
   - Reorders the internal `Workspace[]` array so that elements match the order of `projectPaths`. Any workspace not mentioned in `projectPaths` remains at the end in its existing relative order.
   - Saves the updated array to `userData/workspaces.json`.
   - Returns the updated `WorkspaceSummary[]` list (`this.list()`).
2. **IPC Handler in `src/main/index.ts`**:
   - Register handler for `Channels.WorkspaceReorder` (`workspace:reorder`).
   - Calls `workspaceStore.reorder(projectPaths)` and broadcasts workspace state update if needed, returning `workspaceStore.list()`.

### Data Models & IPC Contract (`src/shared/ipc.ts` & `src/preload/index.ts`)
1. Add `WorkspaceReorder: 'workspace:reorder'` to `Channels` in `src/shared/ipc.ts`.
2. Add `reorderWorkspaces(projectPaths: string[]): Promise<WorkspaceSummary[]>` to `AgentApi` in `src/shared/ipc.ts`.
3. Implement `reorderWorkspaces` in `src/preload/index.ts` using `ipcRenderer.invoke(Channels.WorkspaceReorder, projectPaths)`.

### Frontend Behavior (`src/renderer/src/components/Sidebar.tsx`)
1. **Drag & Drop Handlers**:
   - HTML5 `draggable` on project items (`<li>` in both expanded `project-list` and collapsed `project-rail`).
   - State variables:
     - `draggedPath: string | null`: Stores the `projectPath` of the item currently being dragged.
     - `dropTarget: { path: string; position: 'above' | 'below' } | null`: Stores the current hovered drop target and indicator position.
   - Events handled on project item containers:
     - `onDragStart`: Sets `draggedPath` and `e.dataTransfer.effectAllowed = 'move'`.
     - `onDragOver`: Prevents default behavior (`e.preventDefault()`), calculates whether pointer is in the top or bottom half of the item bounding rect, and updates `dropTarget`.
     - `onDragLeave`: Resets `dropTarget` if leaving the target item.
     - `onDrop`: Prevents default behavior, calculates new project path order array based on `draggedPath`, `dropTarget.path`, and `dropTarget.position`. Performs optimistic UI update and invokes `window.api.reorderWorkspaces(newPaths)`.
     - `onDragEnd`: Resets `draggedPath` and `dropTarget` states.
2. **Visual Indicators**:
   - Apply CSS class `.drop-target-above` or `.drop-target-below` to project list item containers when hovered during a drag operation, displaying an accent top/bottom indicator line.
   - Set cursor styling and opacity for dragging state (`opacity: 0.5` on the dragged element).
3. **New Project Defaulting**:
   - Existing `WorkspaceStore.add(projectPath, name)` pushes new workspaces to the end of the `all` array (`all.push(ws)`), ensuring newly added projects automatically appear at the bottom of the list.

### Testing Strategy
- **Unit Tests (`tests/unit/workspace-store.test.ts`)**:
  - Test `workspaceStore.reorder([pathB, pathA])` reorders workspaces correctly in memory and in JSON file.
- **IPC Contract Test (`tests/unit/ipc-contract.test.ts`)**:
  - Add `reorderWorkspaces` to IPC contract test to verify main and preload implementation match.
- **Verification**:
  - Run `npm run typecheck` and `npm test`.

## Self-Review
1. **Placeholder scan:** None.
2. **Internal consistency:** Matches requirement for both expanded & collapsed sidebar, drag from anywhere on project item, and preserving new project bottom default.
3. **Scope check:** Focused on project drag-and-drop ordering and persistence.
4. **Ambiguity check:** Clear IPC contract, UI drag handling, and backend store API.
