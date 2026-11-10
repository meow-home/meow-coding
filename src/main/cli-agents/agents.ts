import { existsSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import type {
  CliAgent,
  CliAgentsStatus,
  CliAgentStatus,
  CliDelegationSettings,
  CliRuntimeConfig,
  CliRuntimeId
} from '../../shared/types'
import { writeFileAtomic } from '../atomic-write'

export interface CliAgentsData {
  version: number
  runtimes: Record<CliRuntimeId, CliRuntimeConfig>
  agents: CliAgent[]
  defaultAgentId?: string
  delegation: CliDelegationSettings
}

export function createDefaultCliAgentsData(): CliAgentsData {
  return {
    version: 1,
    runtimes: {
      antigravity: {
        enabled: true,
        binaryPath: null,
        version: null,
        maxConcurrent: 2
      },
      opencode: {
        enabled: true,
        binaryPath: null,
        version: null,
        maxConcurrent: 3
      }
    },
    agents: [],
    defaultAgentId: undefined,
    delegation: {
      allow: true,
      maxRounds: 3,
      maxNonterminalPerAgent: 5
    }
  }
}

const FORBIDDEN_SECRET_KEYS = new Set([
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'keyring',
  'keyringblob',
  'credential',
  'credentials'
])

export function assertNoSecrets(obj: unknown, pathStr = ''): void {
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoSecrets(obj[i], `${pathStr}[${i}]`)
    }
    return
  }
  for (const [key, val] of Object.entries(obj)) {
    if (FORBIDDEN_SECRET_KEYS.has(key.toLowerCase())) {
      throw new Error(`[meow] Refusing to persist secret key "${key}" in cli-agents.json (${pathStr || key})`)
    }
    assertNoSecrets(val, pathStr ? `${pathStr}.${key}` : key)
  }
}

export interface CliAgentStoreHooks {
  onRemove?: (agentId: string) => void | Promise<void>
}

export class CliAgentStore {
  private readonly filePath: string
  private data: CliAgentsData | null = null
  private readonly hooks?: CliAgentStoreHooks

  constructor(filePathOrUserDataDir: string, hooks?: CliAgentStoreHooks) {
    if (filePathOrUserDataDir.endsWith('.json')) {
      this.filePath = filePathOrUserDataDir
    } else {
      this.filePath = path.join(filePathOrUserDataDir, 'cli-agents.json')
    }
    this.hooks = hooks
  }

  load(): CliAgentsData {
    if (this.data) return this.data
    if (!existsSync(this.filePath)) {
      this.data = createDefaultCliAgentsData()
      return this.data
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const defaults = createDefaultCliAgentsData()

      this.data = {
        version: typeof parsed.version === 'number' ? parsed.version : defaults.version,
        runtimes: {
          antigravity: {
            ...defaults.runtimes.antigravity,
            ...(parsed.runtimes?.antigravity || {})
          },
          opencode: {
            ...defaults.runtimes.opencode,
            ...(parsed.runtimes?.opencode || {})
          }
        },
        agents: Array.isArray(parsed.agents) ? parsed.agents : defaults.agents,
        defaultAgentId: typeof parsed.defaultAgentId === 'string' ? parsed.defaultAgentId : defaults.defaultAgentId,
        delegation: {
          ...defaults.delegation,
          ...(parsed.delegation || {})
        }
      }
      return this.data
    } catch {
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt`)
      } catch {
        /* best effort */
      }
      this.data = createDefaultCliAgentsData()
      return this.data
    }
  }

  save(data?: CliAgentsData): void {
    const toSave = data ?? this.data ?? createDefaultCliAgentsData()
    assertNoSecrets(toSave)
    this.data = toSave
    writeFileAtomic(this.filePath, JSON.stringify(toSave, null, 2))
  }

  getAgents(): CliAgent[] {
    return this.load().agents.map(a => ({ ...a }))
  }

  getAgent(id: string): CliAgent | null {
    const agent = this.load().agents.find(a => a.id === id)
    return agent ? { ...agent } : null
  }

  addAgent(agent: CliAgent): CliAgent {
    const data = this.load()
    if (data.agents.some(a => a.id === agent.id)) {
      throw new Error(`[meow] Agent already exists with id: ${agent.id}`)
    }

    assertNoSecrets(agent)

    const newAgent: CliAgent = { ...agent }

    if (newAgent.runtime === 'antigravity' && newAgent.kind === 'google') {
      const existingGoogle = data.agents.filter(a => a.runtime === 'antigravity' && a.kind === 'google')
      if (existingGoogle.length === 0) {
        newAgent.active = true
      } else if (newAgent.active) {
        for (const existing of existingGoogle) {
          existing.active = false
        }
      } else {
        newAgent.active = false
      }
    }

    data.agents.push(newAgent)

    if (!data.defaultAgentId) {
      data.defaultAgentId = newAgent.id
    }

    this.save(data)
    return { ...newAgent }
  }

  updateAgent(id: string, updates: Partial<CliAgent>): CliAgent {
    const data = this.load()
    const index = data.agents.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error(`[meow] Agent not found with id: ${id}`)
    }

    assertNoSecrets(updates)

    const current = data.agents[index]
    const updated: CliAgent = { ...current, ...updates, id: current.id }

    if (updated.runtime === 'antigravity' && updated.kind === 'google' && updates.active === true) {
      for (const a of data.agents) {
        if (a.runtime === 'antigravity' && a.kind === 'google' && a.id !== id) {
          a.active = false
        }
      }
    }

    data.agents[index] = updated
    this.save(data)
    return { ...updated }
  }

  async removeAgent(id: string): Promise<void> {
    const data = this.load()
    const index = data.agents.findIndex(a => a.id === id)
    if (index === -1) return

    const removed = data.agents[index]
    data.agents.splice(index, 1)

    if (data.defaultAgentId === id) {
      data.defaultAgentId = data.agents.length > 0 ? data.agents[0].id : undefined
    }

    if (removed.runtime === 'antigravity' && removed.kind === 'google' && removed.active) {
      const remainingGoogle = data.agents.filter(a => a.runtime === 'antigravity' && a.kind === 'google')
      if (remainingGoogle.length > 0) {
        remainingGoogle[0].active = true
      }
    }

    this.save(data)
    if (this.hooks?.onRemove) {
      try {
        await this.hooks.onRemove(id)
      } catch {
        /* best effort */
      }
    }
  }

  activateAgent(id: string): void {
    const data = this.load()
    const agent = data.agents.find(a => a.id === id)
    if (!agent) {
      throw new Error(`[meow] Agent not found with id: ${id}`)
    }

    if (agent.runtime === 'antigravity' && agent.kind === 'google') {
      for (const a of data.agents) {
        if (a.runtime === 'antigravity' && a.kind === 'google') {
          a.active = a.id === id
        }
      }
      this.save(data)
    }
  }

  setDefaultAgent(id: string): void {
    const data = this.load()
    if (!data.agents.some(a => a.id === id)) {
      throw new Error(`[meow] Agent not found with id: ${id}`)
    }
    data.defaultAgentId = id
    this.save(data)
  }

  setAgentStatus(id: string, status: CliAgentStatus): CliAgent {
    return this.updateAgent(id, { status })
  }

  getRuntimeConfig(runtime: CliRuntimeId): CliRuntimeConfig {
    return { ...this.load().runtimes[runtime] }
  }

  setRuntimePath(runtime: CliRuntimeId, binaryPath: string | null): void {
    const data = this.load()
    data.runtimes[runtime].binaryPath = binaryPath
    this.save(data)
  }

  setRuntimeDetection(runtime: CliRuntimeId, detection: { binaryPath: string | null; version: string | null }): void {
    const data = this.load()
    data.runtimes[runtime].binaryPath = detection.binaryPath
    data.runtimes[runtime].version = detection.version
    this.save(data)
  }

  setRuntimeEnabled(runtime: CliRuntimeId, enabled: boolean): void {
    const data = this.load()
    data.runtimes[runtime].enabled = enabled
    this.save(data)
  }

  getDelegationSettings(): CliDelegationSettings {
    return { ...this.load().delegation }
  }

  updateDelegationSettings(updates: Partial<CliDelegationSettings>): CliDelegationSettings {
    const data = this.load()
    data.delegation = { ...data.delegation, ...updates }
    this.save(data)
    return { ...data.delegation }
  }

  getStatus(): CliAgentsStatus {
    const data = this.load()
    return {
      runtimes: {
        antigravity: { ...data.runtimes.antigravity },
        opencode: { ...data.runtimes.opencode }
      },
      agents: data.agents.map(a => ({ ...a })),
      defaultAgentId: data.defaultAgentId,
      delegation: { ...data.delegation }
    }
  }
}
