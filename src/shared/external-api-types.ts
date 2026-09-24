import type { DelegationStatus } from './types'

export const EXTERNAL_SOURCE_ID = 'external:claude'
export const EXTERNAL_SOURCE_NAME = 'Claude (external)'

export function isExternalPeer(agentId: string): boolean {
  return agentId.startsWith('external:')
}

export interface CreateTaskBody {
  cwd: string
  planKey: string
  title?: string
  task: string
  sessionId?: string
}

export interface TaskDto {
  id: string
  status: DelegationStatus
  sessionId: string
  projectPath: string
  planKey: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: string
  resultTruncated?: boolean
  error?: string
  touchedFiles: string[]
}

export interface ExternalApiStatus {
  enabled: boolean
  listening: boolean
  port: number | null
  error?: string
  cliPath: string | null
  configPath: string
}
