export type BrowserStatus = 'idle' | 'listening' | 'pending' | 'paired' | 'disconnected' | 'error'

export interface PendingExtensionInfo {
  extensionId: string
  version?: string
  requestedAt: number
}

export interface BrowserStatusInfo {
  status: BrowserStatus
  port: number
  paired: boolean
  pairingCode?: string
  pairingExpiresAt?: number
  pendingExtension?: PendingExtensionInfo
}

export interface TrustedExtension {
  id: string
  version?: string
  approvedAt: number
}

export type BrowserReadMode = 'interactive' | 'full'

export interface SnapshotNode {
  role: string
  name?: string
  ref?: string
  children?: SnapshotNode[]
}

export interface BrowserTabInfo {
  id?: number
  title?: string
  url?: string
  active: boolean
  windowId?: number
  groupId?: number
  groupTitle?: string
}

export type BrowserCommandName =
  | 'navigate' | 'openTab' | 'switchTab' | 'closeTab' | 'reload' | 'listTabs'
  | 'click' | 'type' | 'select' | 'scroll' | 'read' | 'screenshot'
  | 'waitFor' | 'watchStart' | 'watchStop' | 'getConsoleLogs' | 'getNetworkLogs'

export interface BrowserCommand {
  id: string
  name: BrowserCommandName
  params?: Record<string, unknown>
}

export type BrowserCommandResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }

export type BrowserEventName = 'console' | 'network' | 'domChanged' | 'tabUpdated' | 'status'

export interface BrowserEvent {
  name: BrowserEventName
  data: unknown
}

export interface PairingInfo {
  code: string
  expiresAt: number
}

export interface PairMessage { type: 'pair'; code: string }
export interface PairResultMessage { type: 'pair_result'; ok: boolean; error?: string }
export interface HelloMessage { type: 'hello'; extensionId: string; version?: string }
export interface HelloResultMessage {
  type: 'hello_result'
  ok: boolean
  paired: boolean
  pending?: boolean
  error?: string
}
export interface PingMessage { type: 'ping' }
export interface PongMessage { type: 'pong' }
export interface CmdMessage extends BrowserCommand { type: 'cmd' }
export type ResultMessage = { type: 'result'; id: string } & BrowserCommandResult
export interface EventMessage extends BrowserEvent { type: 'event' }

export type ExtensionToBridge = PairMessage | HelloMessage | ResultMessage | EventMessage | PingMessage
export type BridgeToExtension = PairResultMessage | HelloResultMessage | CmdMessage | PongMessage
