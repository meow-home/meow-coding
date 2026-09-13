# Provider Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Provider Management tab (`ProvidersTab.tsx`) to feature clean white cards for connected providers and a multi-step `BaseModal` flow for searching catalog presets or setting up custom OpenAI-compatible endpoints.

**Architecture:** Replace the legacy inline search list on the main tab with a dedicated multi-step modal (`BaseModal`). Style connected provider cards with white background (`#ffffff`), status badges, quick actions (`Sync Models`, `Set Default`, `Edit`, `Disconnect`), and collapsible model chips.

**Tech Stack:** React 19, TypeScript, Lucide React icons (`Key`, `ShieldCheck`, `RefreshCw`, `Edit2`, `Trash2`, `Plus`, `Search`, `Globe`, `ChevronDown`, `ChevronRight`, `CheckCircle2`), `BaseModal`, `BaseSelect`.

## Global Constraints

- **Design System Consistency**: Cards use white background (`#ffffff`), 1px `var(--hairline)` border, `var(--radius)` rounded corners.
- **IPC & Settings Integration**: Calls existing `connectProvider`, `disconnectProvider`, `fetchProviderModels`, and `saveSettings` APIs without breaking existing behavior.
- **Standard Controls**: Use `BaseModal` and `BaseSelect` primitives.

---

### Task 1: Redesign ProvidersTab Main View & Connected Cards

**Files:**
- Modify: `src/renderer/src/components/settings/ProvidersTab.tsx`

**Interfaces:**
- Consumes: `Props` (`settings: MeowSettings`, `catalog: CatalogProviderSummary[]`, `onChange`, `onPersisted`, `onRefresh`)
- Produces: Updated connected providers card list view, empty state, and card action handlers.

- [ ] **Step 1: Update imports in `ProvidersTab.tsx`**

Import Lucide icons (`Key`, `ShieldCheck`, `RefreshCw`, `Edit2`, `Trash2`, `Plus`, `Search`, `Globe`, `ChevronDown`, `ChevronRight`, `CheckCircle2`, `Server`, `Sparkles`), `BaseModal`, and `BaseSelect`. Remove import of legacy `./Modal`.

- [ ] **Step 2: Add connected provider card state and handlers**

Add state for expanded model cards (`expandedIds: Set<string>`), testing/syncing provider IDs (`syncingId: string | null`), and helper functions for syncing models and setting default provider.

- [ ] **Step 3: Implement connected provider card rendering**

Replace the old connected provider rows with `.provider-card` containers:
- Header: Icon badge, Provider ID in monospace font, `Default Provider` badge (if `settings.defaultProvider === p.id`), `🔒 Key Vaulted` badge.
- Body: Base URL (if present), synced models count tag, actions toolbar (`Set as Default`, `Sync Models`, `Edit`, `Disconnect`).
- Collapsible model list: Toggle button to expand/collapse model chips (`p.models`).

- [ ] **Step 4: Implement Empty State**

When `connected.length === 0`, render `.provider-empty-card` with an icon, description, and `+ Connect your first provider` button.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (or minor modal props errors to resolve in Task 2)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/ProvidersTab.tsx
git commit -m "feat(settings): redesign ProvidersTab main view with provider cards"
```

---

### Task 2: Implement Multi-Step Connect & Edit Modal in ProvidersTab

**Files:**
- Modify: `src/renderer/src/components/settings/ProvidersTab.tsx`

**Interfaces:**
- Consumes: `BaseModal`, `BaseSelect`, catalog provider summary list.
- Produces: Multi-step `Connect Modal` (Preset selection step -> Configuration step) and `Edit Modal`.

- [ ] **Step 1: Define modal step state and types**

Add modal state types:
```ts
type ConnectModalStep = 'select' | 'configure'
```
Add modal open handlers:
- `openConnect()`: Sets modal mode to `connect`, step to `select`, clears inputs.
- `selectPreset(catalogItem)`: Prefills `providerId`, `baseUrl`, `providerType`, sets step to `configure`.
- `selectCustom()`: Clears prefilled values, sets step to `configure`.
- `openEdit(providerSettings)`: Sets modal mode to `edit`, step to `configure`, prefills current values.

- [ ] **Step 2: Implement Step 1 (Preset Search & Preset Grid)**

Inside `BaseModal.Body` when `step === 'select'`:
- Search input: `Search preset providers...` filtering `catalog`.
- Preset Grid: Grid of `.preset-card` items showing icon, provider name, ID, and model count. Clicking a preset calls `selectPreset`.
- Prominent button: `"Set up Custom OpenAI-compatible Endpoint"` calling `selectCustom`.

- [ ] **Step 3: Implement Step 2 (Configuration Form)**

Inside `BaseModal.Body` when `step === 'configure'`:
- Provider ID input (readonly for presets, editable for custom).
- API Key input (password type, placeholder: `isEdit ? "Leave blank to keep vaulted key" : "sk-..."`).
- Base URL input (optional).
- Provider Type selector using `BaseSelect` with options: `Auto-detect`, `DeepSeek`, `OpenAI`, `Anthropic`, `Google`.
- Manual Models input (optional).

- [ ] **Step 4: Wire Modal Actions & Connect Logic**

Implement `handleConnectSubmit()` to call `window.api.connectProvider(...)`, trigger `onRefresh()`, and close modal.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/ProvidersTab.tsx
git commit -m "feat(settings): add multi-step connect & edit provider modal"
```

---

### Task 3: Add CSS Styles & Documentation Sync

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/settings/AGENTS.md`

- [ ] **Step 1: Add CSS rules in `styles.css`**

Add CSS rules for `.providers-tab`, `.provider-card`, `.preset-grid`, `.preset-card`, `.provider-empty-card`, and badge styles:
```css
/* Provider tab */
.providers-tab { display: flex; flex-direction: column; gap: 1rem; }
.provider-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  background: #ffffff;
  border: 0.083333rem solid var(--hairline);
  border-radius: var(--radius);
  transition: border-color 150ms ease;
}
.provider-card:hover { border-color: var(--accent-border); }
.provider-card-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.5rem; max-height: 18rem; overflow-y: auto; }
.preset-card { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.6rem; background: var(--bg-input); border: 0.083333rem solid var(--hairline); border-radius: var(--radius); cursor: pointer; text-align: left; transition: background 120ms ease, border-color 120ms ease; }
.preset-card:hover { background: var(--bg-input-hover); border-color: var(--accent-border); }
```

- [ ] **Step 2: Update `AGENTS.md` documentation**

Update `src/renderer/src/components/settings/AGENTS.md` to document the redesigned `ProvidersTab.tsx`.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/settings/AGENTS.md
git commit -m "style(settings): add provider management CSS styles and update AGENTS.md"
```
