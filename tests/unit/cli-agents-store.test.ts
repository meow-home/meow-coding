import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CliAgent } from '../../src/shared/types'
import { CliAgentStore } from '../../src/main/cli-agents/agents'
import { CliProfileManager, type VaultLike } from '../../src/main/cli-agents/profiles'

class MemoryVault implements VaultLike {
  private secrets = new Map<string, string>()

  saveSecret(ref: string, secret: string): void {
    this.secrets.set(ref, secret)
  }

  saveSecretObject(ref: string, secret: unknown): void {
    this.secrets.set(ref, JSON.stringify(secret))
  }

  getSecret(ref: string): string | null {
    return this.secrets.get(ref) ?? null
  }

  getSecretObject<T>(ref: string): T | null {
    const raw = this.secrets.get(ref)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  hasSecret(ref: string): boolean {
    return this.secrets.has(ref)
  }

  deleteSecret(ref: string): void {
    this.secrets.delete(ref)
  }
}

describe('CLI Agents — Store & Profiles', () => {
  let tmpDir = ''

  function createTmp(): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'meow-cli-store-test-'))
    return tmpDir
  }

  function cleanupTmp(): void {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      tmpDir = ''
    }
  }

  it('loads default data when file does not exist', () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)
    const data = store.load()

    expect(data.version).toBe(1)
    expect(data.runtimes.antigravity.enabled).toBe(true)
    expect(data.runtimes.antigravity.maxConcurrent).toBe(2)
    expect(data.runtimes.opencode.enabled).toBe(true)
    expect(data.runtimes.opencode.maxConcurrent).toBe(3)
    expect(data.agents).toEqual([])
    expect(data.defaultAgentId).toBeUndefined()
    expect(data.delegation.allow).toBe(true)
    expect(data.delegation.maxRounds).toBe(3)

    cleanupTmp()
  })

  it('supports agent CRUD operations', async () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    const agent1: CliAgent = {
      id: 'agy_personal',
      runtime: 'antigravity',
      kind: 'google',
      label: 'Antigravity · Personal',
      email: 'user@example.com',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    }

    const created = store.addAgent(agent1)
    expect(created.id).toBe('agy_personal')
    expect(created.active).toBe(true)
    expect(store.load().defaultAgentId).toBe('agy_personal')

    expect(store.getAgents()).toHaveLength(1)
    expect(store.getAgent('agy_personal')?.label).toBe('Antigravity · Personal')
    expect(store.getAgent('non_existent')).toBeNull()

    // Update
    const updated = store.updateAgent('agy_personal', { label: 'Antigravity · Work', mode: 'full' })
    expect(updated.label).toBe('Antigravity · Work')
    expect(updated.mode).toBe('full')
    expect(store.getAgent('agy_personal')?.label).toBe('Antigravity · Work')

    // Disallow duplicates
    expect(() => store.addAgent(agent1)).toThrow('already exists')

    // Remove
    await store.removeAgent('agy_personal')
    expect(store.getAgents()).toHaveLength(0)
    expect(store.load().defaultAgentId).toBeUndefined()

    cleanupTmp()
  })

  it('returns defensive copies from getAgents', () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    store.addAgent({
      id: 'agent_immut',
      runtime: 'antigravity',
      kind: 'google',
      label: 'Original Label',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    })

    const list1 = store.getAgents()
    list1[0].label = 'Mutated Label'
    list1.push({} as never)

    const list2 = store.getAgents()
    expect(list2).toHaveLength(1)
    expect(list2[0].label).toBe('Original Label')

    cleanupTmp()
  })

  it('reassigns defaultAgentId when the default agent is removed', async () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    store.addAgent({
      id: 'agent_1',
      runtime: 'antigravity',
      kind: 'google',
      label: 'Agent 1',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    })

    store.addAgent({
      id: 'agent_2',
      runtime: 'opencode',
      kind: 'profile',
      label: 'Agent 2',
      mode: 'edit',
      status: 'ready',
      createdAt: 2000
    })

    expect(store.load().defaultAgentId).toBe('agent_1')

    // Remove agent 1
    await store.removeAgent('agent_1')
    expect(store.load().defaultAgentId).toBe('agent_2')

    // Remove agent 2
    await store.removeAgent('agent_2')
    expect(store.load().defaultAgentId).toBeUndefined()

    cleanupTmp()
  })

  it('manages Antigravity active account bookkeeping', async () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    // First Google agent is active by default
    const a1 = store.addAgent({
      id: 'agy_1',
      runtime: 'antigravity',
      kind: 'google',
      label: 'Agy 1',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    })
    expect(a1.active).toBe(true)

    // Second Google agent is inactive by default
    const a2 = store.addAgent({
      id: 'agy_2',
      runtime: 'antigravity',
      kind: 'google',
      label: 'Agy 2',
      mode: 'edit',
      status: 'ready',
      createdAt: 2000
    })
    expect(a2.active).toBe(false)
    expect(store.getAgent('agy_1')?.active).toBe(true)

    // Activate second agent
    store.activateAgent('agy_2')
    expect(store.getAgent('agy_2')?.active).toBe(true)
    expect(store.getAgent('agy_1')?.active).toBe(false)

    // Gemini API key agent does not affect Google active account
    const a3 = store.addAgent({
      id: 'agy_key',
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agy Key',
      mode: 'edit',
      status: 'ready',
      createdAt: 3000
    })
    expect(a3.active).toBeUndefined()
    expect(store.getAgent('agy_2')?.active).toBe(true)

    // When the active Google agent is removed, another Google agent becomes active
    await store.removeAgent('agy_2')
    expect(store.getAgent('agy_1')?.active).toBe(true)

    cleanupTmp()
  })

  it('refuses to persist secrets in cli-agents.json', () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    const agentWithSecret = {
      id: 'leak_agent',
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Leak',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000,
      apiKey: 'AIzaSySecretKey'
    } as unknown as CliAgent

    expect(() => store.addAgent(agentWithSecret)).toThrow('Refusing to persist secret key')

    // Verify on disk that the file was not written with secret
    const filePath = path.join(dir, 'cli-agents.json')
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('AIzaSySecretKey')
    }

    cleanupTmp()
  })

  it('handles corrupted JSON store gracefully', () => {
    const dir = createTmp()
    const filePath = path.join(dir, 'cli-agents.json')
    writeFileSync(filePath, '{ corrupt json !!!')

    const store = new CliAgentStore(dir)
    const data = store.load()

    expect(data.version).toBe(1)
    expect(data.agents).toEqual([])
    expect(existsSync(`${filePath}.corrupt`)).toBe(true)

    cleanupTmp()
  })

  it('manages OpenCode profiles and vault secrets with removal cleanup', () => {
    const dir = createTmp()
    const vault = new MemoryVault()
    const profiles = new CliProfileManager(dir, vault)

    // OpenCode profile dir
    const profileDir = profiles.ensureOpenCodeProfileDir('oc_work')
    expect(existsSync(profileDir)).toBe(true)
    expect(profiles.getRelativeOpenCodeProfileDir('oc_work')).toBe('cli-profiles/opencode/oc_work')

    // Vault secret
    profiles.saveAgentSecret('oc_work', 'anthropic_api_token_123')
    expect(profiles.hasAgentSecret('oc_work')).toBe(true)
    expect(profiles.getAgentSecret('oc_work')).toBe('anthropic_api_token_123')

    // Removal wipes both profile dir and vault secret
    profiles.removeProfile('oc_work')
    expect(existsSync(profileDir)).toBe(false)
    expect(profiles.hasAgentSecret('oc_work')).toBe(false)
    expect(profiles.getAgentSecret('oc_work')).toBeNull()

    cleanupTmp()
  })

  it('integrates removal cleanup with CliAgentStore hook', async () => {
    const dir = createTmp()
    const vault = new MemoryVault()
    const profiles = new CliProfileManager(dir, vault)

    const store = new CliAgentStore(dir, {
      onRemove: (id) => profiles.removeProfile(id)
    })

    store.addAgent({
      id: 'oc_test',
      runtime: 'opencode',
      kind: 'profile',
      label: 'OC Test',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    })

    const pDir = profiles.ensureOpenCodeProfileDir('oc_test')
    profiles.saveAgentSecret('oc_test', 'test_key')
    expect(existsSync(pDir)).toBe(true)
    expect(profiles.hasAgentSecret('oc_test')).toBe(true)

    // Removing agent triggers profile cleanup
    await store.removeAgent('oc_test')
    expect(existsSync(pDir)).toBe(false)
    expect(profiles.hasAgentSecret('oc_test')).toBe(false)

    cleanupTmp()
  })

  it('persists runtime detection results and clears when binary not found', () => {
    const dir = createTmp()
    const store = new CliAgentStore(dir)

    store.setRuntimeDetection('antigravity', {
      binaryPath: 'C:\\bin\\agy.exe',
      version: '1.5.4'
    })

    let config = store.getRuntimeConfig('antigravity')
    expect(config.binaryPath).toBe('C:\\bin\\agy.exe')
    expect(config.version).toBe('1.5.4')

    // Reload from disk to verify persistence
    const reloaded = new CliAgentStore(dir)
    config = reloaded.getRuntimeConfig('antigravity')
    expect(config.binaryPath).toBe('C:\\bin\\agy.exe')
    expect(config.version).toBe('1.5.4')

    // Clear when not found
    store.setRuntimeDetection('antigravity', {
      binaryPath: null,
      version: null
    })
    config = store.getRuntimeConfig('antigravity')
    expect(config.binaryPath).toBeNull()
    expect(config.version).toBeNull()

    cleanupTmp()
  })

  it('awaits async onRemove hook during removeAgent', async () => {
    const dir = createTmp()
    let asyncCleaned = false

    const store = new CliAgentStore(dir, {
      onRemove: async () => {
        await new Promise((r) => setTimeout(r, 10))
        asyncCleaned = true
      }
    })

    store.addAgent({
      id: 'agent_async',
      runtime: 'opencode',
      kind: 'profile',
      label: 'Async Clean',
      mode: 'edit',
      status: 'ready',
      createdAt: 1000
    })

    await store.removeAgent('agent_async')
    expect(asyncCleaned).toBe(true)

    cleanupTmp()
  })
})
