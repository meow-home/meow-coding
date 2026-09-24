import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ExternalApiStatus } from '../../shared/external-api-types'
import type { ExternalApiConfigFile } from './config-file'
import { ExternalApiServer, type ExternalApiHandler } from './server'
import { installClaudeSkill } from './claude-skill'

export interface ExternalApiManagerDeps {
  config: ExternalApiConfigFile
  handler: ExternalApiHandler
  cliSource: string
  skillTemplate: string
  binDir: string
  claudeSkillsDir: string
  preferredPort?: number
  onStatus?: (s: ExternalApiStatus) => void
  log?: (msg: string) => void
}

export class ExternalApiManager {
  private server: ExternalApiServer | null = null
  private error: string | undefined
  private cliError: string | undefined
  private cliPath: string | null = null

  constructor(private deps: ExternalApiManagerDeps) {}

  async start(): Promise<void> {
    try {
      this.installCli()
    } catch (err) {
      this.cliError = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`[meow] external API CLI install failed: ${this.cliError}`)
    }
    if (this.deps.config.load().enabled) await this.listen()
    this.emit()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await server.stop()
    this.deps.config.update({ port: null })
  }

  async setEnabled(enabled: boolean): Promise<ExternalApiStatus> {
    this.deps.config.update({ enabled })
    if (enabled) await this.listen()
    else {
      await this.stop()
      this.error = undefined
      this.deps.config.update({ port: null })
    }
    this.emit()
    return this.getStatus()
  }

  regenerateToken(): ExternalApiStatus {
    this.deps.config.regenerateToken()
    this.emit()
    return this.getStatus()
  }

  getToken(): string {
    return this.deps.config.load().token
  }

  installClaudeSkill(): string {
    if (!this.cliPath) this.installCli()
    return installClaudeSkill({
      templatePath: this.deps.skillTemplate,
      cliPath: this.cliPath!,
      skillsDir: this.deps.claudeSkillsDir
    })
  }

  getStatus(): ExternalApiStatus {
    const cfg = this.deps.config.load()
    const error = this.error ?? this.cliError
    return {
      enabled: cfg.enabled,
      listening: this.server !== null,
      port: this.server?.port ?? null,
      ...(error ? { error } : {}),
      cliPath: this.cliPath ?? cfg.cliPath,
      configPath: this.deps.config.filePath
    }
  }

  notifyChanged(taskId: string): void {
    this.server?.notifyChanged(taskId)
  }

  private installCli(): void {
    mkdirSync(this.deps.binDir, { recursive: true })
    const target = path.join(this.deps.binDir, 'meow-delegate.mjs')
    copyFileSync(this.deps.cliSource, target)
    this.cliPath = target
    this.cliError = undefined
    this.deps.config.update({ cliPath: target })
  }

  private async listen(): Promise<void> {
    if (this.server) return
    const server = new ExternalApiServer({
      handler: this.deps.handler,
      getToken: () => this.deps.config.load().token,
      preferredPort: this.deps.preferredPort
    })
    try {
      const port = await server.start()
      this.server = server
      this.error = undefined
      this.deps.config.update({ port })
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.deps.log?.(`[meow] external API failed to start: ${this.error}`)
    }
  }

  private emit(): void {
    this.deps.onStatus?.(this.getStatus())
  }
}
