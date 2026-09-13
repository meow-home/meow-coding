# Sub-agents Tab BaseSelect Alignment Design Spec

## Overview
Align the sub-agent provider and model select dropdowns in `src/renderer/src/components/settings/AgentsTab.tsx` with the standardized visual styling used by `ModePicker` and `VariantPicker`.

## Motivation & Context
While `BaseSelect` provides the core trigger structure and popup container, the menu items inside `SingleSelect` in `AgentsTab.tsx` used custom unstyled class names (`select-item`) instead of standard `.menu-item`, `.menu-item-label`, and `.menu-item-check`. Additionally, the select containers in `.submodel-fields` lacked full-width flex styling, resulting in visual misalignment compared to other pickers in the application.

## User Interface & Behavior Changes
1. **Standard Menu Item Styling:**
   - Option items use `className="menu-item ${isSelected ? 'active' : ''}"`.
   - Option label is wrapped in `<span className="menu-item-label">`.
   - Option checkmark icon is wrapped in `<span className="menu-item-check">`.
2. **Layout & Flex Width Alignment:**
   - In `src/renderer/src/styles.css`, update `.submodel-fields` to style `.base-dropdown-container` with `flex: 1; min-width: 0; display: flex;`.
   - Ensure `.submodel-fields .dropdown-trigger` stretches to `width: 100%` and uses `justify-content: space-between` so the provider and model selects split row space 50/50 evenly.
3. **Disabled Trigger State:**
   - Render disabled state using standard `.dropdown-trigger.select-trigger` styling.

## Verification Plan
1. **Type Check:** Run `npm run typecheck` to ensure full TypeScript compliance.
2. **Unit Tests:** Run `npm test` to verify all unit test suites pass without regression.
