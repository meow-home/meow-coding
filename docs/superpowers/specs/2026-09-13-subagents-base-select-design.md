# Sub-agents Tab BaseSelect Refactor Design Spec

## Overview
Refactor the sub-agent provider and model select inputs in `src/renderer/src/components/settings/AgentsTab.tsx` from native `<select>` HTML elements to the standardized `BaseSelect` common UI component.

## Motivation & Context
`AGENTS.md` and `src/renderer/src/components/common/AGENTS.md` mandate that all option selection dropdowns MUST use common components (`BaseSelect` / `BaseDropdown`). The sub-agents tab currently uses native HTML `<select>` elements, which causes visual inconsistency with the rest of the application's dropdown design.

## User Interface & Behavior Changes
1. **Replacement of Native Selects:**
   - Both Provider select and Model select dropdowns for each sub-agent role (`research`, `general`, `reviewer`) will use `BaseSelect`.
2. **Provider Selection:**
   - Trigger shows selected provider ID or `(inherit main session model)`.
   - Selecting `(inherit main session model)` resets the sub-agent role's `ModelRef` to `undefined`.
   - Selecting a provider sets `provider` and defaults `model` to the first model in that provider's `models` list.
3. **Model Selection:**
   - Disabled when no provider is selected for the role.
   - Trigger shows selected model ID.
   - Selecting a model updates the sub-agent role's `model`.
4. **Dropdown Styling:**
   - Menu items show a checkmark (`Check` icon from `lucide-react`) next to the active option.
   - Clicking an option selects the value and closes the dropdown menu.

## Component Design
Inside `AgentsTab.tsx`, implement a reusable helper `SingleSelect` component built on top of `BaseSelect`:
```tsx
interface SingleSelectOption {
  value: string
  label: string
}

interface SingleSelectProps {
  value: string
  placeholder: string
  disabled?: boolean
  options: SingleSelectOption[]
  onChange: (value: string) => void
}
```

## Verification Plan
1. **Type Check:** Run `npm run typecheck` to ensure full TypeScript compliance.
2. **Unit Tests:** Run `npm test` to verify all unit test suites pass without regression.
