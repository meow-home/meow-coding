# Sub-agents Settings Tab Design Spec

## Overview
This specification details the refactoring of the Settings dialog's "Profiles" tab into a dedicated **"Sub-agents"** tab:
1. Rename sidebar tab label from `'Profiles'` to `'Sub-agents'` in `SettingsDialog.tsx`.
2. Remove the profile creation/management section (system prompt editing for `meow` and custom profiles, "+ Add profile" button).
3. Focus `AgentsTab.tsx` exclusively on configuring the model providers for the 3 sub-agents (`research`, `general`, `reviewer`).

---

## Component Changes

### 1. `SettingsDialog.tsx`
Update `TABS` array label:
```ts
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'agents', label: 'Sub-agents' },
  ...
]
```

### 2. `AgentsTab.tsx`
- Remove profile management logic (adding/editing/removing profile system prompts).
- Render a clean header explanation:
  `"Models used when the main session dispatches sub-agents. Leave empty to inherit the main session model."`
- Display provider & model selection rows for the 3 sub-agents (`research`, `general`, `reviewer`).

---

## Verification Plan
1. **Typecheck & Tests**:
   - `npm run typecheck`
   - `npm test`
