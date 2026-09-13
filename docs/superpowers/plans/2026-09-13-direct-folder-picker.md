# Direct Native OS Folder Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the intermediate `AddProjectDialog` React modal with direct native OS folder selection when clicking "Add Project" (Sidebar) or "Add Folder" (Composer `+` menu).

**Architecture:** Update `Sidebar.tsx` and `App.tsx` event handlers to call `window.api.pickFolder()` directly, automatically derive the project name from the selected folder path, add the workspace via `window.api.addWorkspace()`, and navigate to it. Delete the unused `AddProjectDialog.tsx` component.

**Tech Stack:** React 19, TypeScript, Electron IPC

## Global Constraints

- Clicking "Add Project" or "Add Folder" must immediately open the native OS folder picker dialog.
- Canceling the folder picker dialog should do nothing gracefully without error.
- All tests (`npm test`) and typechecks (`npm run typecheck`) must pass.

---

### Task 1: Update `App.tsx` and `Sidebar.tsx` for direct folder picking and remove `AddProjectDialog`

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Delete: `src/renderer/src/components/AddProjectDialog.tsx`

- [ ] **Step 1: Update `src/renderer/src/App.tsx`**

In `src/renderer/src/App.tsx`:
- Remove `import AddProjectDialog from './components/AddProjectDialog'`
- Remove `const [showAddProject, setShowAddProject] = useState(false)`
- Update `appActions`:
```typescript
  const handleAddFolderDirect = useCallback(async () => {
    try {
      const folderPath = await window.api.pickFolder()
      if (!folderPath) return
      const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
      await window.api.addWorkspace(folderPath, name)
      await refreshWorkspaces()
      openWorkspace(folderPath)
    } catch {
      /* ignore cancel or failure */
    }
  }, [refreshWorkspaces, openWorkspace])

  const appActions = useMemo(() => ({ addFolder: handleAddFolderDirect }), [handleAddFolderDirect])
```
- Remove `handleAddProject` and `<AddProjectDialog ... />` rendering in `App.tsx`.

- [ ] **Step 2: Update `src/renderer/src/components/Sidebar.tsx`**

In `src/renderer/src/components/Sidebar.tsx`:
- Remove `import AddProjectDialog from './AddProjectDialog'`
- Remove `const [showAddProject, setShowAddProject] = useState(false)`
- Update `handleAddProject`:
```typescript
  const handleAddProjectDirect = async () => {
    try {
      const folderPath = await window.api.pickFolder()
      if (!folderPath) return
      const name = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
      await window.api.addWorkspace(folderPath, name)
      setError('')
      onRefresh()
      onOpen(folderPath)
    } catch (err) {
      setError(String(err))
    }
  }
```
- Update "Add Project" button `onClick`: `onClick={() => void handleAddProjectDirect()}`
- Remove `{showAddProject && (<AddProjectDialog ... />)}` in JSX.

- [ ] **Step 3: Delete `src/renderer/src/components/AddProjectDialog.tsx`**

Remove file `src/renderer/src/components/AddProjectDialog.tsx`.

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git rm src/renderer/src/components/AddProjectDialog.tsx
git add src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx
git commit -m "feat(renderer): open OS folder picker directly on Add Project / Add Folder"
```

---

### Task 2: Update AGENTS.md documentation

**Files:**
- Modify: `src/renderer/AGENTS.md`
- Modify: `src/renderer/src/components/AGENTS.md`

- [ ] **Step 1: Update `src/renderer/AGENTS.md`**

Remove `AddProjectDialog` from the key components list in `src/renderer/AGENTS.md`.

- [ ] **Step 2: Update `src/renderer/src/components/AGENTS.md`**

Remove `AddProjectDialog.tsx` row from the key files table in `src/renderer/src/components/AGENTS.md`.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit documentation updates**

```bash
git add src/renderer/AGENTS.md src/renderer/src/components/AGENTS.md
git commit -m "docs(renderer): update AGENTS.md after removing AddProjectDialog"
```
