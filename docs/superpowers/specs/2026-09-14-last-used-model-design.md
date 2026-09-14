# Last Used Model Persistence Design

Remembering the user's last selected LLM model across sessions and application restarts.

## Goals

- **Persistence**: Save the user's last selected model (`provider`, `model`, `accountId`) to `meow.json` settings whenever they select a model in any session.
- **Default for New Sessions**: Automatically default newly created sessions (draft sessions) to the last used model.
- **Fallback Safety**: If the last used model belongs to a disconnected or removed provider, fall back seamlessly to the system's `defaultProvider` and its default model.

## Architecture & Data Flow

### 1. Data Model (`src/shared/types.ts` & `src/main/agent/config.ts`)

- Extend `MeowConfig` and `MeowSettings` interfaces with an optional field:
  ```ts
  lastUsedModel?: ModelRef
  ```
  where `ModelRef` is `{ provider: string; model: string; accountId?: string }`.
- Update `loadMeowConfig`, `writeMeowConfig`, and `settingsToConfig` in `src/main/agent/config.ts` to deserialize and serialize `lastUsedModel`.

### 2. Updating Last Used Model (`src/main/meow-agent-manager.ts`)

- When `setModel(agentId: string, model: ModelRef)` is invoked:
  - If `agentId === DRAFT_SESSION_ID`: set `this.draftModel = model`.
  - In all cases: persist `lastUsedModel: model` into `meow.json` config via `writeMeowConfig`.

### 3. Resolving Model for Draft Sessions (`getAgentModel(DRAFT_SESSION_ID)`)

Resolution order for `DRAFT_SESSION_ID`:
1. In-memory `this.draftModel` (if user explicitly selected a model in the active draft session before sending).
2. Saved `lastUsedModel` from `meow.json` (if its provider is still configured/connected).
3. System `defaultProvider` and first model (standard fallback).

## Testing & Verification

- Unit test in `tests/unit/meow-agent-manager.test.ts`:
  - Setting a model updates `lastUsedModel` in `meow.json`.
  - Creating a new session resolves to `lastUsedModel`.
  - Disconnecting the provider of `lastUsedModel` correctly falls back to `defaultProvider`.
