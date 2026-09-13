# Sidebar Header Menu Design Spec

Status: approved

## 1. Overview
The sidebar header currently has no title text. This spec updates the sidebar top section to feature a vertical 2-row menu (matching standard menu items with icons and text labels), replacing the horizontal icon bar.

## 2. Goals & Non-Goals
### Goals
- Display a vertical menu `.sidebar-header-menu` at the top of `Sidebar.tsx` with 2 full-width menu item buttons:
  1. Dòng 1: `Plus` icon + "New session" (Creates a new session for `workspaces[0]`, or triggers folder picker if no workspace is active).
  2. Dòng 2: `FolderPlus` icon + "Add folder" (Triggers native folder picker to add a new project workspace).
- Style `.sidebar-header-menu` and `.sidebar-menu-item` like clean, interactive menu items with hover state and subtle spacing.

### Non-Goals
- Changing session execution, project storage, or PTY management logic.

## 3. Detailed Component & Styling Design
1. **`Sidebar.tsx`**:
   - Render `.sidebar-header-menu`:
     ```tsx
     <div className="sidebar-header-menu">
       <button
         type="button"
         className="sidebar-header-item"
         onClick={() => {
           if (workspaces.length > 0) {
             onNewSession(workspaces[0].projectPath)
           } else {
             void handleAddProjectDirect()
           }
         }}
       >
         <Plus size={14} aria-hidden="true" />
         <span>New session</span>
       </button>
       <button
         type="button"
         className="sidebar-header-item"
         onClick={() => void handleAddProjectDirect()}
       >
         <FolderPlus size={14} aria-hidden="true" />
         <span>Add folder</span>
       </button>
     </div>
     ```

2. **`styles.css`**:
   - `.sidebar-header-menu`: `display: flex; flex-direction: column; gap: 0.166667rem; padding-bottom: 0.5rem; border-bottom: 0.083333rem solid var(--hairline);`
   - `.sidebar-header-item`: full-width button with icon + span label, `display: flex; align-items: center; gap: 0.5rem; padding: 0.333333rem 0.5rem; border-radius: var(--radius-sm); color: var(--text-dim); cursor: pointer; text-align: left; background: transparent; border: none; font-size: var(--font-size-sm);`
   - Hover state: `.sidebar-header-item:hover`: `color: var(--text-strong); background: var(--bg-hover);`

## 4. Verification & Testing
- Typecheck: `npm run typecheck` passes.
- Unit/Integration Tests: `npm test` passes.
