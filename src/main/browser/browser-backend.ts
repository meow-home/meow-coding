import type { QuestionPrompt } from '../../shared/types'
import type { BrowserCommandName, BrowserCommandResult, BrowserStatusInfo } from '../../shared/browser-types'
import type { ToolRunResult } from '../agent/tools/types'

export interface BrowserBridgeLike {
  getStatus(): BrowserStatusInfo
  execute(name: BrowserCommandName, params?: Record<string, unknown>, timeoutMs?: number): Promise<BrowserCommandResult>
  waitForPaired(timeoutMs: number): Promise<boolean>
  getConsoleLogs(limit?: number): unknown[]
  getNetworkLogs(limit?: number): unknown[]
}

export interface BrowserLauncherLike {
  openChrome(): Promise<void>
  openExtensionFolder(): Promise<void>
  showInstallGuide(): Promise<void>
}

export interface BrowserCall {
  /** `ctx.snapshotAgentId ?? ctx.agentId`: a subagent drives its parent's tabs. */
  ownerId: string
  ask(question: QuestionPrompt): Promise<string | null>
  signal?: AbortSignal
}

export interface BrowserBackend {
  start(call: BrowserCall): Promise<ToolRunResult>
  execute(name: BrowserCommandName, params: Record<string, unknown>, call: BrowserCall, timeoutMs?: number): Promise<BrowserCommandResult>
  getConsoleLogs(call: BrowserCall, limit?: number, tabId?: number): unknown[]
  getNetworkLogs(call: BrowserCall, limit?: number, tabId?: number): unknown[]
}

export interface BrowserRouterLike {
  backendFor(ownerId: string): BrowserBackend
  select(ownerId: string, target: 'builtin' | 'chrome'): void
}
