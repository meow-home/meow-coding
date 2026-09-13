# Sub-agents Tab BaseSelect Grid Layout & Truncation Design Spec

## Overview
Update the sub-agent provider and model field layout in `src/renderer/src/components/settings/AgentsTab.tsx` and `src/renderer/src/styles.css` to use a 2-column grid structure (`1fr 1fr`), enforce text truncation (`...`) on long trigger labels, and ensure dropdown menu items occupy 100% full width of the dropdown menu container.

## Motivation & Context
Previously, `.submodel-fields` used flex wrapping which allowed field widths to shift based on text length. Using CSS Grid ensures equal 50/50 distribution for Provider and Model dropdowns. Long model names are cleanly truncated with `...` while dropdown options stretch 100% full width inside the popover menu.

## User Interface & CSS Changes
1. **Grid Container (`.submodel-fields`):**
   ```css
   .submodel-fields {
     display: grid;
     grid-template-columns: 1fr 1fr;
     gap: 0.666667rem;
     width: 100%;
   }
   ```
2. **Select Container & Trigger Truncation:**
   ```css
   .submodel-fields .base-dropdown-container {
     min-width: 0;
     display: flex;
     width: 100%;
   }
   .submodel-fields .dropdown-trigger {
     width: 100%;
     justify-content: space-between;
     gap: 0.5rem;
     min-width: 0;
     overflow: hidden;
   }
   .select-value-label {
     white-space: nowrap;
     overflow: hidden;
     text-overflow: ellipsis;
     flex: 1;
     min-width: 0;
     text-align: left;
   }
   ```
3. **Dropdown Menu Items Full Width:**
   ```css
   .select-menu .menu-item {
     width: 100%;
     box-sizing: border-box;
   }
   ```

## Verification Plan
1. **Type Check:** Run `npm run typecheck` to ensure full TypeScript compliance.
2. **Unit Tests:** Run `npm test` to verify all unit test suites pass without regression.
