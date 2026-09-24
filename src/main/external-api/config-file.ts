import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '../atomic-write'

export interface ExternalApiConfig {
  enabled: boolean
  port: number | null
  token: string
  cliPath: string | null
}

const defaultToken = (): string => randomBytes(32).toString('hex')

export class ExternalApiConfigFile {
  constructor(readonly filePath: string, private randomToken: () => string = defaultToken) {}

  load(): ExternalApiConfig {
    let raw: Partial<ExternalApiConfig> = {}
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ExternalApiConfig>
    } catch {
      raw = {}
    }
    const cfg: ExternalApiConfig = {
      enabled: raw.enabled === true,
      port: typeof raw.port === 'number' ? raw.port : null,
      token: typeof raw.token === 'string' && raw.token.length >= 32 ? raw.token : this.randomToken(),
      cliPath: typeof raw.cliPath === 'string' ? raw.cliPath : null
    }
    if (cfg.token !== raw.token) this.write(cfg)
    return cfg
  }

  update(patch: Partial<Omit<ExternalApiConfig, 'token'>>): ExternalApiConfig {
    const next = { ...this.load(), ...patch }
    this.write(next)
    return next
  }

  regenerateToken(): ExternalApiConfig {
    const next = { ...this.load(), token: this.randomToken() }
    this.write(next)
    return next
  }

  private write(cfg: ExternalApiConfig): void {
    writeFileAtomic(this.filePath, JSON.stringify(cfg, null, 2))
  }
}
