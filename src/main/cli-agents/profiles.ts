import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

export interface VaultLike {
  saveSecret(ref: string, secret: string): void
  saveSecretObject(ref: string, secret: unknown): void
  getSecret(ref: string): string | null
  getSecretObject<T>(ref: string): T | null
  hasSecret(ref: string): boolean
  deleteSecret(ref: string): void
}

export class CliProfileManager {
  constructor(
    private readonly userDataDir: string,
    private readonly vault: VaultLike
  ) {}

  getVaultRef(agentId: string): string {
    return `cli:agent:${agentId}`
  }

  getOpenCodeProfileDir(agentId: string): string {
    return path.join(this.userDataDir, 'cli-profiles', 'opencode', agentId)
  }

  getRelativeOpenCodeProfileDir(agentId: string): string {
    return path.posix.join('cli-profiles', 'opencode', agentId)
  }

  ensureOpenCodeProfileDir(agentId: string): string {
    const dir = this.getOpenCodeProfileDir(agentId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    return dir
  }

  saveAgentSecret(agentId: string, secret: string): void {
    this.vault.saveSecret(this.getVaultRef(agentId), secret)
  }

  saveAgentSecretObject(agentId: string, secret: unknown): void {
    this.vault.saveSecretObject(this.getVaultRef(agentId), secret)
  }

  getAgentSecret(agentId: string): string | null {
    return this.vault.getSecret(this.getVaultRef(agentId))
  }

  getAgentSecretObject<T>(agentId: string): T | null {
    return this.vault.getSecretObject<T>(this.getVaultRef(agentId))
  }

  hasAgentSecret(agentId: string): boolean {
    return this.vault.hasSecret(this.getVaultRef(agentId))
  }

  deleteAgentSecret(agentId: string): void {
    this.vault.deleteSecret(this.getVaultRef(agentId))
  }

  removeProfile(agentId: string): void {
    this.deleteAgentSecret(agentId)

    const dir = this.getOpenCodeProfileDir(agentId)
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  }
}
