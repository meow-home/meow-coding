# Remove `sp-` Prefix from Default System Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `sp-` prefix from built-in Superpowers slash commands so command names match their skill names directly (e.g. `/brainstorming`, `/using-superpowers`).

**Architecture:** Update command definition generation in `src/main/agent/commands.ts`, update unit tests, and update documentation files following AGENTS.md conventions.

**Tech Stack:** TypeScript, Electron, Vitest

## Global Constraints

- Command names for Superpowers built-ins must match skill names directly without `sp-` prefix.
- No backward compatibility aliases (direct replace).
- All unit tests (`npm test`) and type checks (`npm run typecheck`) must pass.

---

### Task 1: Update command generator in `src/main/agent/commands.ts` and unit tests

**Files:**
- Modify: `src/main/agent/commands.ts`
- Modify: `tests/unit/agent-commands.test.ts`
- Modify: `tests/unit/meow-agent-manager.test.ts`

- [ ] **Step 1: Update tests to expect command names without `sp-` prefix**

In `tests/unit/agent-commands.test.ts`:
- Change `sp-using-superpowers` to `using-superpowers`
- Change `sp-brainstorming` to `brainstorming`
- Update temporary file paths in test fixtures if named `sp-using-superpowers.md` to `using-superpowers.md`

In `tests/unit/meow-agent-manager.test.ts`:
- Change `sp-brainstorming` to `brainstorming` in test descriptions and expectations.

- [ ] **Step 2: Run unit tests to confirm failure**

Run: `npx vitest run tests/unit/agent-commands.test.ts tests/unit/meow-agent-manager.test.ts`
Expected: FAIL due to missing `using-superpowers` and `brainstorming` commands (which still have `sp-` prefix).

- [ ] **Step 3: Modify `src/main/agent/commands.ts` to remove `sp-` prefix**

In `src/main/agent/commands.ts`:
Change:
```typescript
export const SUPERPOWERS_COMMANDS: Command[] = SUPERPOWERS.map(({ name, context }) => ({
  name: `sp-${name}`,
  description: `Invoke the Superpowers ${name} skill`,
  template: ...
}))
```
To:
```typescript
export const SUPERPOWERS_COMMANDS: Command[] = SUPERPOWERS.map(({ name, context }) => ({
  name,
  description: `Invoke the Superpowers ${name} skill`,
  template: ...
}))
```
And update top comments in `src/main/agent/commands.ts` that mention `sp-*.md`.

- [ ] **Step 4: Run unit tests to confirm pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/main/agent/commands.ts tests/unit/agent-commands.test.ts tests/unit/meow-agent-manager.test.ts
git commit -m "refactor(agent): remove sp- prefix from default system commands"
```

---

### Task 2: Update project documentation and AGENTS.md

**Files:**
- Modify: `src/main/agent/AGENTS.md`
- Modify: `README.md`
- Modify: `docs/reference/01-product-overview.md`
- Modify: `docs/reference/03-agent-runtime.md`
- Modify: `docs/reference/11-conventions-and-pitfalls.md`

- [ ] **Step 1: Update `src/main/agent/AGENTS.md`**

Change table row:
`| commands.ts | Slash commands: built-ins (init/review/sp-*) + user store (commands.json) ... |`
to:
`| commands.ts | Slash commands: built-ins (init/review/Superpowers skills) + user store (commands.json) ... |`

- [ ] **Step 2: Update `README.md`**

Change:
`(`/sp-*`), plus custom commands`
to:
`(`Superpowers commands`), plus custom commands`

- [ ] **Step 3: Update `docs/reference/01-product-overview.md`**

Change:
`14 /sp-* Superpowers commands`
to:
`14 Superpowers commands`

- [ ] **Step 4: Update `docs/reference/03-agent-runtime.md`**

Change:
`| /sp-<name> | Bundled Superpowers slash command ... |`
to:
`| /<skill-name> | Bundled Superpowers slash command ... |`

- [ ] **Step 5: Update `docs/reference/11-conventions-and-pitfalls.md`**

Change:
`mirrored by the bundled /sp-* commands:`
to:
`mirrored by the bundled Superpowers commands:`

- [ ] **Step 6: Verify docs and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit doc updates**

```bash
git add src/main/agent/AGENTS.md README.md docs/reference/
git commit -m "docs: update default command references after removing sp- prefix"
```
