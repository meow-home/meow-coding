# Sub-agents Settings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Settings sidebar tab from "Profiles" to "Sub-agents" and update `AgentsTab.tsx` to only render the configuration UI for the 3 sub-agents (`research`, `general`, `reviewer`), removing profile system prompt editing and "+ Add profile".

**Architecture:** Update `TABS` array in `SettingsDialog.tsx` for the tab label. In `AgentsTab.tsx`, strip out profile management state/methods and render only the sub-agents provider/model selectors.

**Tech Stack:** React 19, TypeScript, Vitest.

## Global Constraints

- Must pass `npm run typecheck` and `npm test`.

---

### Task 1: Update Settings Sidebar Tab Label in SettingsDialog.tsx

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsDialog.tsx:18-28`

- [ ] **Step 1: Update TABS label in SettingsDialog.tsx**

In `src/renderer/src/components/settings/SettingsDialog.tsx`:

Change:
```ts
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Profiles' },
  { id: 'permissions', label: 'Permissions' },
```

To:
```ts
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Sub-agents' },
  { id: 'permissions', label: 'Permissions' },
```

- [ ] **Step 2: Commit changes**

```bash
git add src/renderer/src/components/settings/SettingsDialog.tsx
git commit -m "refactor(ui): rename Profiles settings tab to Sub-agents"
```

---

### Task 2: Simplify AgentsTab.tsx for Sub-agents Only

**Files:**
- Modify: `src/renderer/src/components/settings/AgentsTab.tsx`

- [ ] **Step 1: Edit AgentsTab.tsx to remove profile management UI**

Update `src/renderer/src/components/settings/AgentsTab.tsx`:

```tsx
import type { AgentSettings, MeowSettings, ModelRef, SubagentType } from '@shared/types'

const SUBMODEL_ROLES = ['research', 'general', 'reviewer'] as const

interface Props {
  agents: AgentSettings[]
  providers: MeowSettings['providers']
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
  onChangeAgents: (agents: AgentSettings[]) => void
  onChangeSubagentModels: (models?: Partial<Record<SubagentType, ModelRef>>) => void
}

export default function AgentsTab({ providers, subagentModels, onChangeSubagentModels }: Props) {
  const setRole = (role: SubagentType, ref: ModelRef | undefined) => {
    const next = { ...(subagentModels ?? {}) }
    if (ref) next[role] = ref
    else delete next[role]
    onChangeSubagentModels(Object.keys(next).length > 0 ? next : undefined)
  }

  return (
    <div className="settings-tab agents-tab">
      <div className="settings-section">
        <h4 className="settings-section-header">Sub-agent Models</h4>
        <p className="settings-hint">
          Models used when the main session dispatches sub-agents. Leave empty to inherit the main session model.
        </p>

        <div className="subagent-models-grid">
          {SUBMODEL_ROLES.map(role => {
            const current = subagentModels?.[role]
            const selectedProvider = current?.providerId ?? ''
            const selectedModel = current?.modelId ?? ''
            const providerObj = providers.find(p => p.id === selectedProvider)
            const availableModels = providerObj?.models ?? []

            return (
              <div key={role} className="subagent-model-row">
                <div className="subagent-model-header">
                  <span className="subagent-role-name">{role}</span>
                  {current && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setRole(role, undefined)}
                    >
                      Use main session model
                    </button>
                  )}
                </div>

                <div className="subagent-model-controls">
                  <select
                    className="input select"
                    value={selectedProvider}
                    onChange={e => {
                      const pid = e.target.value
                      if (!pid) {
                        setRole(role, undefined)
                        return
                      }
                      const firstModel = providers.find(p => p.id === pid)?.models[0]?.id ?? ''
                      setRole(role, { providerId: pid, modelId: firstModel })
                    }}
                  >
                    <option value="">(inherit main session model)</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>

                  <select
                    className="input select"
                    disabled={!selectedProvider}
                    value={selectedModel}
                    onChange={e => {
                      if (!selectedProvider) return
                      setRole(role, { providerId: selectedProvider, modelId: e.target.value })
                    }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit AgentsTab.tsx changes**

```bash
git add src/renderer/src/components/settings/AgentsTab.tsx
git commit -m "refactor(ui): update AgentsTab to focus exclusively on sub-agent model selection"
```

---

### Task 3: Verification & Test Suite Run

**Files:**
- Test: `tests/unit/base-modal.test.ts` (and full suite)

- [ ] **Step 1: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.
