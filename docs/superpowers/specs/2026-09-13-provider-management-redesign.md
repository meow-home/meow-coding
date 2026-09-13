# Provider Management Redesign Spec

## Overview
Redesign the Provider Management tab (`ProvidersTab.tsx`) and the connection flow in Meow Coding. The main view focuses exclusively on connected providers with white-background cards, clear status badges, and streamlined actions. The catalog provider search and custom API endpoint setup are unified inside a multi-step modal (`BaseModal`) opened via `+ Connect Provider`.

## Key Objectives
1. **Remove Catalog Search from Main View**: Hide the catalog search bar from the main settings tab to clean up the UI.
2. **Card-Based Connected List**: Render connected providers in clean white-background cards (`#ffffff`) matching the design system of `Sub-agents`, `Permissions`, `Context`, and `MCP` tabs.
3. **Preset & Custom Multi-Step Modal**: When clicking `+ Connect Provider`, open a modal with preset search, preset grid selection, and a Custom API Endpoint button.
4. **Interactive Actions**: Support `Set Default`, `Sync Models`, `Edit`, `Disconnect`, and collapsible synced model previews directly on each provider card.
5. **Modern Primitives**: Use `BaseModal` and `BaseSelect` components with Lucide icons.

## Detailed Architecture & Flow

### 1. Main View (`ProvidersTab.tsx`)
- **Header**: Contains title/hint and the primary `+ Connect Provider` button (`btn primary small`).
- **Connected Providers List**:
  - Displays cards for all configured providers in `settings.providers`.
  - Each card includes:
    - **Header**: Icon badge, provider ID (monospace font), `Default Provider` badge (if default), `🔒 Key Vaulted` badge.
    - **Body**: Base URL (if custom), synced models count, actions toolbar.
    - **Action Toolbar**:
      - `Sync Models` button with loading state.
      - `Set as Default` button (disabled / badge if already default).
      - `Edit` button (opens Edit Modal).
      - `Disconnect` button (`icon-btn danger` or `btn danger small`).
    - **Collapsible Models List**: Clicking a toggle expands the list of synced model IDs formatted as chips/code badges.
- **Empty State**: If `connected.length === 0`, display a centered empty card with an icon inviting the user to connect a provider.

### 2. Connect Modal Flow (`BaseModal`)
- **Step 1 (Select Preset / Custom)**:
  - Search input at the top: `Search preset providers (OpenAI, Anthropic, DeepSeek, Google...)`.
  - Preset provider cards grid displaying name, ID, and catalog model count.
  - Prominent "Set up Custom OpenAI-compatible Endpoint" button.
- **Step 2 (Configuration Form)**:
  - Header showing selected provider (e.g. `Connect OpenAI` or `Connect Custom Provider`).
  - Inputs:
    - `Provider ID` (prefilled for preset, editable for custom).
    - `API Key` (password input with keychain note).
    - `Base URL` (optional text input).
    - `Manual Models` (optional textarea / text input).
    - `Provider Type` dropdown using `BaseSelect` (`Auto-detect`, `DeepSeek`, `OpenAI`, `Anthropic`, `Google`).
  - Buttons: `Back` (return to step 1) and `Connect` (submit IPC call).

### 3. Edit Modal Flow (`BaseModal`)
- Opens directly to the Configuration Form prefilled with current provider settings.
- API Key placeholder explains: `Leave blank to keep current vaulted key`.
- Submit button: `Save Changes`.

## Data & IPC Interfaces
Uses existing IPC channels on `window.api`:
- `connectProvider(id, apiKey, baseUrl, modelList, providerType)`
- `disconnectProvider(id)`
- `fetchProviderModels(id)`
- `saveSettings(settings)`
- `getSettings()`

## Self-Review Checklist
- [x] No placeholders or TBDs.
- [x] Interfaces match existing `@shared/types` (`ProviderSettings`, `MeowSettings`, `CatalogProviderSummary`).
- [x] Clear design boundaries and step transitions.
