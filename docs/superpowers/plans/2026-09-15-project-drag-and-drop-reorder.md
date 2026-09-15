# Project Drag and Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to reorder projects in the sidebar via drag-and-drop in both expanded and collapsed views, persisting the new order to `workspaces.json`, while keeping newly added projects defaulting to the bottom.

**Architecture:** Add `reorder` method to `WorkspaceStore` and expose it via IPC (`workspace:reorder`). Implement HTML5 drag-and-drop handlers in `Sidebar.tsx` for both `project-list` and `project-rail`, updating UI optimistically and calling `window.api.reorderWorkspaces`.

**Tech Stack:** React 19, TypeScript, Electron IPC, HTML5 Drag and Drop API.

## Global Constraints

- Follow established IPC contract patterns in `src/shared/ipc.ts`.
- Retain new projects defaulting to the bottom (`all.push(ws)`).
- Support drag and drop on both expanded `project-list` and collapsed `project-rail`.
- No new third-party dependencies.

---

### Task 1: Backend Store & IPC Contract

**Files:**
- Modify: `src/main/workspace-store.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/workspace-store.test.ts`
- Test: `tests/unit/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStore` in `src/main/workspace-store.ts`, IPC contract in `src/shared/ipc.ts`.
- Produces: `WorkspaceStore.reorder(projectPaths: string[]): WorkspaceSummary[]`, IPC Channel `Channels.WorkspaceReorder`, `window.api.reorderWorkspaces(projectPaths: string[]): Promise<WorkspaceSummary[]>`.

- [ ] **Step 1: Write failing unit test for `WorkspaceStore.reorder`**

Add test to `tests/unit/workspace-store.test.ts`:
```ts
  it('reorders workspaces by path order', () => {
    store.add('/proj/a', 'Project A')
    store.add('/proj/b', 'Project B')
    store.add('/proj/c', 'Project C')
    const reordered = store.reorder(['/proj/c', '/proj/a', '/proj/b'])
    expect(reordered.map(w => w.projectPath)).toEqual(['/proj/c', '/proj/a', '/proj/b'])
    expect(store.list().map(w => w.projectPath)).toEqual(['/proj/c', '/proj/a', '/proj/b'])
  })
```

- [ ] **Step 2: Run unit tests to verify failure**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: FAIL with "store.reorder is not a function"

- [ ] **Step 3: Implement `WorkspaceStore.reorder` in `src/main/workspace-store.ts`**

In `src/main/workspace-store.ts`:
```ts
  reorder(projectPaths: string[]): WorkspaceSummary[] {
    const all = this.store.load()
    const map = new Map(all.map(w => [w.projectPath, w]))
    const reordered: Workspace[] = []
    for (const path of projectPaths) {
      const ws = map.get(path)
      if (ws) {
        reordered.push(ws)
        map.delete(path)
      }
    }
    // Append any remaining workspaces not explicitly included in projectPaths
    for (const ws of map.values()) {
      reordered.push(ws)
    }
    this.store.save(reordered)
    return this.list()
  }
```

- [ ] **Step 4: Run unit tests to verify `WorkspaceStore.reorder` passes**

Run: `npx vitest run tests/unit/workspace-store.test.ts`
Expected: PASS

- [ ] **Step 5: Add `WorkspaceReorder` channel and `reorderWorkspaces` to IPC contract in `src/shared/ipc.ts`**

In `src/shared/ipc.ts`:
Add `WorkspaceReorder: 'workspace:reorder',` to `Channels` object.
Add `reorderWorkspaces(projectPaths: string[]): Promise<WorkspaceSummary[]>` to `AgentApi` interface.

- [ ] **Step 6: Update `src/preload/index.ts` to implement `reorderWorkspaces`**

In `src/preload/index.ts`, expose `reorderWorkspaces`:
```ts
reorderWorkspaces: (projectPaths) => ipcRenderer.invoke(Channels.WorkspaceReorder, projectPaths),
```

- [ ] **Step 7: Register IPC handler in `src/main/index.ts`**

In `src/main/index.ts`:
```ts
ipcMain.handle(Channels.WorkspaceReorder, async (_evt, projectPaths: string[]) => {
  const summaries = this.workspaces.reorder(projectPaths)
  this.broadcastState()
  return summaries
})
```

- [ ] **Step 8: Update `tests/unit/ipc-contract.test.ts`**

In `tests/unit/ipc-contract.test.ts`:
Add `'reorderWorkspaces'` to the `required` array in `it('defines all channels used by the preload api')`, add stub implementation `reorderWorkspaces: async () => [],` to `api`, and add `expect(Channels.WorkspaceReorder).toBe('workspace:reorder')` in `it('maps event channel names to the AgentApi method names')`.

- [ ] **Step 9: Run Vitest to verify all backend & contract unit tests pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit Task 1 changes**

```bash
git add src/main/workspace-store.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts tests/unit/workspace-store.test.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(ipc): add workspace reorder backend method and IPC channel"
```

---

### Task 2: Frontend Drag and Drop UI & Styling

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api.reorderWorkspaces(projectPaths: string[])`.
- Produces: Drag and drop reordering in Sidebar UI for expanded (`project-list`) and collapsed (`project-rail`) modes.

- [ ] **Step 1: Add `onReorder` prop to `Sidebar.tsx` and wire in `App.tsx`**

In `src/renderer/src/components/Sidebar.tsx`:
Add `onReorder?: (newPaths: string[]) => void` to `Sidebar` `Props`.

In `src/renderer/src/App.tsx`:
Add handler `handleReorderWorkspaces`:
```ts
const handleReorderWorkspaces = async (newPaths: string[]) => {
  setWorkspaces(prev => {
    const map = new Map(prev.map(w => [w.projectPath, w]))
    return newPaths.map(p => map.get(p)).filter((w): w is WorkspaceSummary => Boolean(w))
  })
  try {
    const updated = await window.api.reorderWorkspaces(newPaths)
    setWorkspaces(updated)
  } catch (err) {
    console.error('Failed to reorder workspaces:', err)
  }
}
```
Pass `onReorder={handleReorderWorkspaces}` to `<Sidebar ... />`.

- [ ] **Step 2: Add Drag and Drop state and helper logic to `Sidebar.tsx`**

In `src/renderer/src/components/Sidebar.tsx`:
Add drag states:
```ts
const [draggedPath, setDraggedPath] = useState<string | null>(null)
const [dropTarget, setDropTarget] = useState<{ path: string; position: 'above' | 'below' } | null>(null)
```

Add handler functions:
```ts
const handleDragStart = (e: React.DragEvent, path: string) => {
  setDraggedPath(path)
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', path)
}

const handleDragOver = (e: React.DragEvent, path: string) => {
  e.preventDefault()
  if (!draggedPath || draggedPath === path) return
  const rect = e.currentTarget.getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  const position = e.clientY < midY ? 'above' : 'below'
  setDropTarget(prev => {
    if (prev?.path === path && prev?.position === position) return prev
    return { path, position }
  })
}

const handleDragLeave = (e: React.DragEvent, path: string) => {
  if (dropTarget?.path === path) {
    setDropTarget(null)
  }
}

const handleDrop = (e: React.DragEvent, path: string) => {
  e.preventDefault()
  if (!draggedPath || draggedPath === path) {
    setDraggedPath(null)
    setDropTarget(null)
    return
  }

  const currentPaths = workspaces.map(w => w.projectPath)
  const fromIndex = currentPaths.indexOf(draggedPath)
  if (fromIndex === -1) return

  const filtered = currentPaths.filter(p => p !== draggedPath)
  const targetIndex = filtered.indexOf(path)
  if (targetIndex === -1) return

  const insertIndex = dropTarget?.position === 'below' ? targetIndex + 1 : targetIndex
  filtered.splice(insertIndex, 0, draggedPath)

  setDraggedPath(null)
  setDropTarget(null)
  onReorder?.(filtered)
}

const handleDragEnd = () => {
  setDraggedPath(null)
  setDropTarget(null)
}
```

- [ ] **Step 3: Attach drag events and drop indicator classes to `project-rail` and `project-list` items**

In `Sidebar.tsx`:
In `project-rail` (`collapsed` mode):
```tsx
<li
  key={ws.projectPath}
  draggable
  onDragStart={(e) => handleDragStart(e, ws.projectPath)}
  onDragOver={(e) => handleDragOver(e, ws.projectPath)}
  onDragLeave={(e) => handleDragLeave(e, ws.projectPath)}
  onDrop={(e) => handleDrop(e, ws.projectPath)}
  onDragEnd={handleDragEnd}
  className={[
    isActive ? 'active' : '',
    draggedPath === ws.projectPath ? 'dragging' : '',
    dropTarget?.path === ws.projectPath ? `drop-target-${dropTarget.position}` : ''
  ].filter(Boolean).join(' ')}
>
```

In `project-list` (`expanded` mode):
```tsx
<li
  key={ws.projectPath}
  draggable
  onDragStart={(e) => handleDragStart(e, ws.projectPath)}
  onDragOver={(e) => handleDragOver(e, ws.projectPath)}
  onDragLeave={(e) => handleDragLeave(e, ws.projectPath)}
  onDrop={(e) => handleDrop(e, ws.projectPath)}
  onDragEnd={handleDragEnd}
  className={[
    isActive ? 'active' : '',
    draggedPath === ws.projectPath ? 'dragging' : '',
    dropTarget?.path === ws.projectPath ? `drop-target-${dropTarget.position}` : ''
  ].filter(Boolean).join(' ')}
>
```

- [ ] **Step 4: Add Drag & Drop indicator styles in `src/renderer/src/styles.css`**

Add CSS rules for drop targets and dragging items to `src/renderer/src/styles.css`:
```css
.project-list li.dragging,
.project-rail li.dragging {
  opacity: 0.4;
}

.project-list li.drop-target-above,
.project-rail li.drop-target-above {
  border-top: 2px solid var(--accent);
}

.project-list li.drop-target-below,
.project-rail li.drop-target-below {
  border-bottom: 2px solid var(--accent);
}
```

- [ ] **Step 5: Run typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 type errors and all tests passing.

- [ ] **Step 6: Commit Task 2 changes**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat(ui): implement project drag and drop reordering in sidebar"
```
