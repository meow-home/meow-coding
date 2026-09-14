# Last Used Model Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the user's last selected LLM model to `meow.json` settings and default newly created sessions to it.

**Architecture:** Extend `MeowConfig` and `MeowSettings` with optional `lastUsedModel?: ModelRef`. When `setModel` is called for any session or draft session, update `lastUsedModel` in `meow.json`. When resolving model for `DRAFT_SESSION_ID`, check in-memory `draftModel`, then saved `lastUsedModel` (if valid/connected), then system `defaultProvider`.

**Tech Stack:** TypeScript, Electron Main Process, Vitest.

## Global Constraints

- Source code and documentation are written in English.
- Run `npm run typecheck && npm test` for verification.

---

### Task 1: Extend Shared Types & Config Normalization for `lastUsedModel`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/agent/config.ts`
- Test: `tests/unit/agent-config.test.ts`

**Interfaces:**
- Consumes: `ModelRef` from `src/shared/types.ts`
- Produces: `lastUsedModel?: ModelRef` in `MeowConfig` and `MeowSettings`

- [ ] **Step 1: Write failing test in `tests/unit/agent-config.test.ts`**

Add test checking `lastUsedModel` serialization in `configToSettings` and `settingsToConfig`:

```ts
it('preserves lastUsedModel in configToSettings and settingsToConfig', () => {
  const config: MeowConfig = {
    providers: [{ id: 'openai', apiKey: 'sk-123', models: ['gpt-4o'] }],
    defaultProvider: 'openai',
    lastUsedModel: { provider: 'openai', model: 'gpt-4o' }
  }
  const settings = configToSettings(config)
  expect(settings.lastUsedModel).toEqual({ provider: 'openai', model: 'gpt-4o' })

  const backToConfig = settingsToConfig(settings, config)
  expect(backToConfig.lastUsedModel).toEqual({ provider: 'openai', model: 'gpt-4o' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: FAIL due to missing property or type mismatch.

- [ ] **Step 3: Modify `src/shared/types.ts` and `src/main/agent/config.ts`**

In `src/shared/types.ts`:
Add `lastUsedModel?: ModelRef` to `MeowConfig` and `MeowSettings`.

In `src/main/agent/config.ts`:
Include `lastUsedModel: config.lastUsedModel` in `configToSettings`, and `lastUsedModel: settings.lastUsedModel ?? current.lastUsedModel` in `settingsToConfig`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/agent/config.ts tests/unit/agent-config.test.ts
git commit -m "feat(config): add lastUsedModel property to MeowConfig and MeowSettings"
```

---

### Task 2: Persist `lastUsedModel` in `MeowAgentManager` & Resolve for Draft Sessions

**Files:**
- Modify: `src/main/meow-agent-manager.ts`
- Test: `tests/unit/meow-agent-manager.test.ts`

**Interfaces:**
- Consumes: `lastUsedModel?: ModelRef` from `MeowConfig`
- Produces: Persistent `lastUsedModel` on `setModel()` and fallback resolution in `getAgentModel(DRAFT_SESSION_ID)`

- [ ] **Step 1: Write failing test in `tests/unit/meow-agent-manager.test.ts`**

Add unit test for `lastUsedModel` persistence and fallback resolution:

```ts
it('persists lastUsedModel when setModel is called and resolves it for draft sessions', async () => {
  const settings = await manager.saveSettings({
    providers: [
      { id: 'openai', apiKey: 'sk-123', models: ['gpt-4o'] },
      { id: 'anthropic', apiKey: 'sk-456', models: ['claude-3-7-sonnet'] }
    ],
    defaultProvider: 'openai'
  })

  // Set model for a session
  manager.setModel('agent-1', { provider: 'anthropic', model: 'claude-3-7-sonnet' })

  // Draft session should resolve to the last used model
  const draftModel = manager.getAgentModel(DRAFT_SESSION_ID)
  expect(draftModel).toEqual({ provider: 'anthropic', model: 'claude-3-7-sonnet' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: FAIL (draftModel is openai/gpt-4o instead of anthropic/claude-3-7-sonnet).

- [ ] **Step 3: Update `setModel` and `getAgentModel` in `src/main/meow-agent-manager.ts`**

In `setModel(agentId: string, model: ModelRef)`:
```ts
if (agentId === DRAFT_SESSION_ID) {
  this.draftModel = model
} else {
  const agent = this.agents.get(agentId)
  if (agent) {
    agent.model = `${model.provider}/${model.model}`
    agent.accountId = model.accountId
    this.agents.set(agentId, agent)
    this.runners.delete(agentId)
    this.resolved.delete(agentId)
    void this.register(agent)
  }
}
const cfg = loadMeowConfig(this.deps.configPath)
writeMeowConfig(this.deps.configPath, { ...cfg, lastUsedModel: model })
```

In `getAgentModel(agentId: string)`:
```ts
if (agentId === DRAFT_SESSION_ID) {
  if (this.draftModel) return this.draftModel
  const cfg = loadMeowConfig(this.deps.configPath)
  if (cfg.lastUsedModel && cfg.providers.some(p => p.id === cfg.lastUsedModel?.provider)) {
    return cfg.lastUsedModel
  }
  const resolved = this.resolveAgentConfig(cfg, 'New session')
  if (!resolved.provider || !resolved.model) return null
  return { provider: resolved.provider, model: resolved.model }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/meow-agent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/meow-agent-manager.ts tests/unit/meow-agent-manager.test.ts
git commit -m "feat(agent): persist lastUsedModel on setModel and resolve for draft sessions"
```
