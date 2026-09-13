# Settings Modal Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove outer left/right padding from the Settings dialog body by migrating `SettingsDialog.tsx` to `BaseModal` compound components (`<BaseModal.Header>` + `<BaseModal.Body noPadding>`), and update `.settings-sidebar` background to `var(--bg-chat)` to seamlessly match the modal background.

**Architecture:** Use `BaseModal.Header` for title + close button, `BaseModal.Body` with `noPadding={true}` for full-width sidebar layout in `SettingsDialog.tsx`, and adjust `.settings-sidebar` background color in `styles.css`.

**Tech Stack:** React 19, TypeScript, Vitest, CSS.

## Global Constraints

- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Update CSS for settings-sidebar Background in styles.css

**Files:**
- Modify: `src/renderer/src/styles.css:1120-1140`

**Interfaces:**
- Produces: CSS class `.settings-sidebar` with `background: var(--bg-chat)`.

- [ ] **Step 1: Edit styles.css to update settings-sidebar background**

Edit `src/renderer/src/styles.css` around line 1128:

Change:
```css
.settings-sidebar {
  flex: 0 0 13rem;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 0.083333rem solid var(--hairline);
  background: var(--bg-panel);
}
```

To:
```css
.settings-sidebar {
  flex: 0 0 13rem;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 0.083333rem solid var(--hairline);
  background: var(--bg-chat);
}
```

- [ ] **Step 2: Commit CSS change**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): set settings-sidebar background to match modal dialog background"
```

---

### Task 2: Refactor SettingsDialog.tsx to Use BaseModal Compound Components

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx`

**Interfaces:**
- Uses: `<BaseModal.Header>`, `<BaseModal.Body noPadding>`.

- [ ] **Step 1: Edit SettingsDialog.tsx to use BaseModal compound components**

In `src/renderer/src/components/settings/SettingsDialog.tsx`, replace the return JSX statement:

```tsx
  return (
    <BaseModal
      size="xl"
      onClose={onClose}
      className="settings-modal-dialog"
    >
      <BaseModal.Header title="Settings" onClose={onClose} />
      <BaseModal.Body noPadding>
        <div className="settings-body">
          <aside className="settings-sidebar">
            <nav className="settings-nav">
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={`settings-nav-item ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </aside>
          <div className="settings-content">
            {draft && tab === 'agents' && (
              <AgentsTab
                agents={draft.agents}
                providers={draft.providers}
                subagentModels={draft.subagentModels}
                onChangeAgents={agents => patch({ agents })}
                onChangeSubagentModels={subagentModels => patch({ subagentModels })}
              />
            )}
            {draft && tab === 'permissions' && (
              <PermissionsTab permission={draft.permission} onChange={permission => patch({ permission })} />
            )}
            {draft && tab === 'mcp' && (
              <McpTab
                mcp={draft.mcp}
                status={mcpStatus}
                onChange={mcp => patch({ mcp })}
                onReconnect={async () => {
                  const result = await window.api.reconnectMcp()
                  setMcpStatus(result)
                  return result
                }}
              />
            )}
            {draft && tab === 'providers' && (
              <ProvidersTab
                settings={draft}
                catalog={catalog}
                onChange={patch}
                onPersisted={onPersisted}
                onRefresh={() => void refresh()}
              />
            )}
            {draft && tab === 'context' && (
              <ContextTab
                maxSteps={draft.maxSteps}
                compaction={draft.compaction}
                toolOutput={draft.toolOutput}
                notifications={draft.notifications ?? { needsInput: true, onDone: true }}
                mcpOutput={draft.mcpOutput}
                resolvedContextTokens={resolvedContextTokens}
                onChange={ctx => patch(ctx)}
              />
            )}
            {tab === 'commands' && <CommandsTab projectPath={projectPath} />}
            {tab === 'remote' && <RemoteTab />}
            {tab === 'updates' && <UpdatesTab />}
            {tab === 'personalize' && <PersonalizeTab />}
          </div>
        </div>
        {saveState !== 'idle' && (
          <div className={`settings-save-pill ${saveState}`} role="status">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved ✓'}
            {saveState === 'error' && (saveError || 'Save failed')}
          </div>
        )}
      </BaseModal.Body>
    </BaseModal>
  )
```

- [ ] **Step 2: Commit SettingsDialog.tsx changes**

```bash
git add src/renderer/src/components/settings/SettingsDialog.tsx
git commit -m "refactor(ui): update SettingsDialog to use BaseModal compound components with noPadding body"
```

---

### Task 3: Verification & Test Suite Run

**Files:**
- Test: `tests/unit/base-modal.test.ts`

- [ ] **Step 1: Run typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.
