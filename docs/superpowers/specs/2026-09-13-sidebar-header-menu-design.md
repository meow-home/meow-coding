# Sidebar Header Menu Design Spec

Status: approved

## 1. Overview
The sidebar header (`sidebar-head`) currently displays a "Projects" text title and a small "Add Project" button. This spec removes the title text and button, replacing them with a streamlined action header bar matching the style of the project list rows.

## 2. Goals & Non-Goals
### Goals
- Remove "Projects" text title and "Add Project" button from `Sidebar.tsx`.
- Add a `.sidebar-header-actions` bar containing two icon buttons styled like standard `.icon-btn` elements:
  1. `Plus` icon button: Creates a new chat session for the first project in the workspace list (`workspaces[0]`). If no project is currently open, triggers folder picker.
  2. `FolderPlus` icon button: Triggers native folder picker to add a new project workspace.

### Non-Goals
- Changing session execution, project storage, or PTY management logic.

## 3. Detailed Component & Styling Design
1. **`Sidebar.tsx`**:
   - Import `FolderPlus` from `lucide-react`.
   - Remove `<div className="panel-head sidebar-head">...</div>`.
   - Add `<div className="sidebar-header-actions">`:
     ```tsx
     <div className="sidebar-header-actions">
       <button
         className="icon-btn"
         title="New session"
         aria-label="New session"
         onClick={() => {
           if (workspaces.length > 0) {
             onNewSession(workspaces[0].projectPath)
           } else {
             void handleAddProjectDirect()
           }
         }}
       >
         <Plus size={14} aria-hidden="true" />
       </button>
       <button
         className="icon-btn"
         title="Add project folder"
         aria-label="Add project folder"
         onClick={() => void handleAddProjectDirect()}
       >
         <FolderPlus size={14} aria-hidden="true" />
       </button>
     </div>
     ```

2. **`styles.css`**:
   - `.sidebar-header-actions`: `display: flex; align-items: center; justify-content: flex-end; gap: 0.333333rem; padding: 0.333333rem 0; border-bottom: 0.083333rem solid var(--hairline);`

## 4. Verification & Testing
- Typecheck: `npm run typecheck` passes.
- Unit/Integration Tests: `npm test` passes.
