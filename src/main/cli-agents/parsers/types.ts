import type { CliTaskStatus, CliTranscriptItem, TokenUsage } from '../../../shared/types'

export interface CliTerminalResult {
  status: CliTaskStatus
  text: string
  usage?: TokenUsage
  deniedActions?: string[]
  error?: string
}

export interface CliParseResult {
  items: CliTranscriptItem[]
  conversationId?: string
  usage?: TokenUsage
  terminal?: CliTerminalResult
}
