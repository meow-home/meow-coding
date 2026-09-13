# Settings Modal Migration to BaseModal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `SettingsDialog.tsx` from a full-screen view into a centered modal dialog backed by `BaseModal` (`size="xl"` / 55rem width).

**Architecture:** Wrap `SettingsDialog` in `<BaseModal title="Settings" onClose={onClose} size="xl" className="settings-modal-dialog">`, remove full-screen `<section className="settings-screen">` backdrop, and adjust CSS styles to fit inside a centered 75vh modal dialog with internal scrolling.

**Tech Stack:** React 19, TypeScript (strict), Vitest (unit testing), Electron 41.

## Global Constraints

- **Modal Component:** Use `BaseModal` portaled to `document.body` with `size="xl"`.
- **Keyboard Handling:** Escape closes settings via `BaseModal`.
- **Documentation Sync:** Update `AGENTS.md` in `src/renderer/src/components/settings/AGENTS.md`.
- **Git Commit Rules:** No `Co-Authored-By` trailer in commit messages.

---

### Task 1: Update Settings Modal CSS Rules in `styles.css`

**Files:**
- Modify: `src/renderer/src/styles.css:1120-1175`

- [ ] **Step 1: Replace .settings-screen CSS with .settings-modal-dialog CSS**

In `src/renderer/src/styles.css`, replace the full-screen `.settings-screen` rules with container rules for `.settings-modal-dialog`:

```css
/* Settings dialog modal */
.dialog.settings-modal-dialog {
  height: 75vh;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1.25rem;
}
.settings-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 0;
}
.settings-sidebar {
  flex: 0 0 13rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 1rem;
  border-right: 0.083333rem solid var(--hairline);
  overflow-y: auto;
  border-radius: 0;
}
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.833333rem;
  font-size: var(--fs-md);
  color: var(--text-dim);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, color 120ms ease;
}
.settings-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
}
.settings-nav-item.active {
  background: var(--bg-active);
  color: var(--accent);
  font-weight: var(--fw-semibold);
}
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 0 0 0 1.25rem;
}
.settings-save-pill {
  position: absolute;
  bottom: 1rem;
  right: 1.25rem;
  z-index: 10;
  padding: 0.333333rem 0.833333rem;
  font-size: var(--fs-sm);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  border: 0.083333rem solid var(--hairline);
  color: var(--text-dim);
}
.settings-save-pill.saving { color: var(--yellow); border-color: var(--yellow); }
.settings-save-pill.saved { color: var(--green); border-color: var(--green); }
.settings-save-pill.error { color: var(--red); border-color: var(--red); }
```

- [ ] **Step 2: Commit CSS updates**

```bash
git add src/renderer/src/styles.css
git commit -m "style(ui): update settings dialog CSS for BaseModal centered layout"
```

---

### Task 2: Refactor `SettingsDialog.tsx` to Use `BaseModal`

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx`

- [ ] **Step 1: Import BaseModal and refactor SettingsDialog JSX**

In `src/renderer/src/components/settings/SettingsDialog.tsx`:
1. Import `BaseModal` from `../common/BaseModal`.
2. Replace `createPortal(<section className="settings-screen">...)` with `<BaseModal title="Settings" onClose={onClose} size="xl" className="settings-modal-dialog">`.
3. Remove unused `backButtonRef` and `ArrowLeft` icon import.
4. Simplify keyboard trap / focus management (since `BaseModal` handles Escape and backdrop clicks).

Updated `SettingsDialog.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogProviderSummary, McpServerStatus, MeowSettings } from '@shared/types'
import BaseModal from '../common/BaseModal'
import AgentsTab from './AgentsTab'
import PermissionsTab from './PermissionsTab'
import McpTab from './McpTab'
import ContextTab from './ContextTab'
import CommandsTab from './CommandsTab'
import RemoteTab from './RemoteTab'
import UpdatesTab from './UpdatesTab'
import ProvidersTab from './ProvidersTab'
import PersonalizeTab from './PersonalizeTab'

export type TabId = 'agents' | 'permissions' | 'mcp' | 'context' | 'commands' | 'remote' | 'updates' | 'providers' | 'personalize'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Profiles' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP' },
  { id: 'providers', label: 'Providers' },
  { id: 'context', label: 'Context' },
  { id: 'commands', label: 'Commands' },
  { id: 'updates', label: 'Updates' },
  { id: 'personalize', label: 'Personalize' }
]

interface Props {
  onClose: () => void
  projectPath?: string
  initialTab?: TabId
  agentId?: string
}

export default function SettingsDialog({ onClose, projectPath, initialTab = 'agents', agentId }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [draft, setDraft] = useState<MeowSettings | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([])
  const [resolvedContextTokens, setResolvedContextTokens] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const draftRef = useRef<MeowSettings | null>(null)
  const lastPersistedRef = useRef('')

  const refresh = useCallback(async () => {
    try {
      const [settings, mcps, nextCatalog] = await Promise.all([
        window.api.getSettings(),
        window.api.getMcpStatus(),
        window.api.listProviderCatalog()
      ])
      lastPersistedRef.current = JSON.stringify(settings)
      setDraft(settings)
      setMcpStatus(mcps)
      setCatalog(nextCatalog)
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    void window.api.getAgentResolvedContextTokens(agentId).then(tokens => {
      if (!cancelled) setResolvedContextTokens(tokens)
    })
    return () => { cancelled = true }
  }, [agentId])

  const patch = useCallback((partial: Partial<MeowSettings>) => {
    setDraft(prev => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const onPersisted = useCallback((updated: MeowSettings) => {
    lastPersistedRef.current = JSON.stringify(updated)
    setDraft(updated)
  }, [])

  const doSave = useCallback(async () => {
    if (!draftRef.current || savingRef.current) return
    const current = draftRef.current
    if (JSON.stringify(current) === lastPersistedRef.current) return

    savingRef.current = true
    setSaveState('saving')
    try {
      const result = await window.api.saveSettings(current)
      if (draftRef.current === current) {
        draftRef.current = result
        lastPersistedRef.current = JSON.stringify(result)
        setDraft(result)
      }
      setMcpStatus(await window.api.getMcpStatus())
      setSaveState('saved')
    } catch (err) {
      setSaveError(String(err))
      setSaveState('error')
    } finally {
      savingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void doSave()
      }
    }
  }, [])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!draft) return
    if (JSON.stringify(draft) === lastPersistedRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setSaveState('idle')
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void doSave()
    }, 500)
  }, [draft, doSave])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      const current = draftRef.current
      if (current && JSON.stringify(current) !== lastPersistedRef.current) {
        void window.api.saveSettings(current)
      }
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const id = window.setTimeout(() => setSaveState('idle'), 2000)
    return () => window.clearTimeout(id)
  }, [saveState])

  return (
    <BaseModal
      title="Settings"
      onClose={onClose}
      size="xl"
      className="settings-modal-dialog"
    >
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
    </BaseModal>
  )
}
```

- [ ] **Step 2: Commit SettingsDialog refactor**

```bash
git add src/renderer/src/components/settings/SettingsDialog.tsx
git commit -m "refactor(ui): migrate SettingsDialog to BaseModal size xl"
```

---

### Task 3: Verification & Documentation Sync

**Files:**
- Modify: `src/renderer/src/components/settings/AGENTS.md`

- [ ] **Step 1: Update AGENTS.md**

Update `src/renderer/src/components/settings/AGENTS.md` to document that `SettingsDialog.tsx` uses `BaseModal` (`size="xl"`).

- [ ] **Step 2: Run test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit documentation**

```bash
git add src/renderer/src/components/settings/AGENTS.md
git commit -m "docs: update settings component AGENTS.md for BaseModal migration"
```
